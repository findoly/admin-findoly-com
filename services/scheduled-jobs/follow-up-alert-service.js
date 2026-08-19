"use strict";

const FollowUp = require("../../models/FollowUp");
const { INDIA_OFFSET_MINUTES } = require("../../utils/india-datetime");
const scheduledAlertService = require("./scheduled-alert-service");

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
const PROCESSING_STALE_MS = 15 * 60 * 1000;

function batchSize(value) {
  const parsed = Number(value || DEFAULT_BATCH_SIZE);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
}

function displayIndiaDateTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function crmBaseUrl() {
  return String(process.env.CRM_PUBLIC_URL || process.env.APP_URL || "https://admin.findoly.com").replace(/\/+$/, "");
}

function variablesFor(followUp) {
  return {
    follow_up_title: String(followUp.title || "Follow-up"),
    follow_up_id: String(followUp.followUpId || ""),
    lead_id: String(followUp.enquiryId || "Not linked"),
    customer_name: String(followUp.customerName || "Not specified"),
    due_at: followUp.dueAt ? displayIndiaDateTime(followUp.dueAt) : "Not specified",
    channel: String(followUp.channel || "call"),
    notes: String(followUp.notes || "Not provided"),
    crm_url: `${crmBaseUrl()}/follow-ups/${encodeURIComponent(String(followUp.followUpId || ""))}/edit`,
  };
}

function claimQuery(now) {
  const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);
  return {
    status: { $in: ["open", "pending"] },
    dueAt: { $ne: null, $lte: now },
    $or: [
      { dueAlertStatus: { $exists: false } },
      { dueAlertStatus: "" },
      { dueAlertStatus: "pending" },
      { dueAlertStatus: "failed" },
      { dueAlertStatus: "processing", dueAlertAttemptedAt: { $lte: staleBefore } },
    ],
  };
}

async function claimNext(now) {
  return FollowUp.findOneAndUpdate(
    claimQuery(now),
    {
      $set: {
        dueAlertStatus: "processing",
        dueAlertAttemptedAt: now,
        dueAlertLastError: "",
        updatedAt: now,
      },
      $inc: { dueAlertAttempts: 1 },
    },
    { sort: { dueAt: 1, _id: 1 }, new: true },
  ).lean();
}

async function processDueFollowUps(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const limit = batchSize(input.limit);
  const enabled = await scheduledAlertService.isEventEnabled("follow_up_due");
  if (!enabled) {
    return { skipped: true, reason: "Follow-up due email alert is disabled", processed: 0, sent: 0, failed: 0 };
  }

  const result = { processed: 0, sent: 0, failed: 0, limit };
  for (let index = 0; index < limit; index += 1) {
    const followUp = await claimNext(now);
    if (!followUp) break;
    result.processed += 1;
    const dueIdentity = followUp.dueAt ? new Date(followUp.dueAt).toISOString() : "no-due-date";
    try {
      const communication = await scheduledAlertService.sendInternalEvent(
        "follow_up_due",
        variablesFor(followUp),
        {
          idempotencyKey: `scheduled-follow-up-due:${followUp.followUpId}:${dueIdentity}`,
          metadata: { followUpId: followUp.followUpId, dueAt: dueIdentity },
        },
      );
      if (communication?.skipped) {
        await FollowUp.updateOne(
          { followUpId: followUp.followUpId, dueAlertStatus: "processing" },
          { $set: { dueAlertStatus: "pending", dueAlertLastError: String(communication.reason || "Alert skipped").slice(0, 1000), updatedAt: new Date() } },
        );
        continue;
      }
      await FollowUp.updateOne(
        { followUpId: followUp.followUpId, dueAlertStatus: "processing" },
        {
          $set: {
            dueAlertStatus: "sent",
            dueAlertSentAt: new Date(),
            dueAlertLastError: "",
            updatedAt: new Date(),
          },
        },
      );
      result.sent += 1;
    } catch (error) {
      await FollowUp.updateOne(
        { followUpId: followUp.followUpId, dueAlertStatus: "processing" },
        {
          $set: {
            dueAlertStatus: "failed",
            dueAlertLastError: String(error.message || "Follow-up alert failed").slice(0, 1000),
            updatedAt: new Date(),
          },
        },
      );
      result.failed += 1;
    }
  }
  return result;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  PROCESSING_STALE_MS,
  batchSize,
  claimQuery,
  processDueFollowUps,
  variablesFor,
};
