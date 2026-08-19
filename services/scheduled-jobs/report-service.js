"use strict";

const Communication = require("../../models/Communication");
const Enquiry = require("../../models/Enquiry");
const FollowUp = require("../../models/FollowUp");
const Provider = require("../../models/Provider");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { formatIndiaDateOnly, parseIndiaDateOnly, INDIA_OFFSET_MINUTES } = require("../../utils/india-datetime");
const scheduledAlertService = require("./scheduled-alert-service");

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_FAILURE_STATUSES = ["failed", "bounced", "complained", "rejected"];

function indiaShift(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + INDIA_OFFSET_MINUTES * 60 * 1000);
}

function displayIndiaDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
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

function reportDateValue(value, now = new Date()) {
  const raw = String(value || "").trim();
  if (raw) {
    const parsed = parseIndiaDateOnly(raw);
    if (!parsed) throw Object.assign(new Error("Report date must use YYYY-MM-DD"), { status: 400 });
    return raw;
  }
  return formatIndiaDateOnly(new Date(now.getTime() - DAY_MS));
}

function reportWindow(reportDate) {
  const start = parseIndiaDateOnly(reportDate);
  if (!start) throw Object.assign(new Error("Report date must use YYYY-MM-DD"), { status: 400 });
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function number(value) {
  return String(Number(value || 0));
}

async function aggregateSingle(Model, pipeline) {
  const rows = await Model.aggregate(pipeline).option({ maxTimeMS: 10000 });
  return Number(rows[0]?.value || 0);
}

async function sendDailyLeadReport(input = {}) {
  const reportDate = reportDateValue(input.reportDate, input.now || new Date());
  const { start, end } = reportWindow(reportDate);
  const created = { createdAt: { $gte: start, $lt: end } };
  const [leadsCreated, approved, rejected, published, pendingVerification] = await Promise.all([
    Enquiry.countDocuments(created),
    Enquiry.countDocuments({ ...created, status: "approved" }),
    Enquiry.countDocuments({ ...created, status: "rejected" }),
    Enquiry.countDocuments({ ...created, marketplaceAvailable: true, marketplaceStatus: "published" }),
    Enquiry.countDocuments({ ...created, status: "verification" }),
  ]);
  return scheduledAlertService.sendInternalEvent(
    "daily_lead_report",
    {
      report_date: displayIndiaDate(start),
      leads_created: number(leadsCreated),
      approved: number(approved),
      rejected: number(rejected),
      published: number(published),
      pending_verification: number(pendingVerification),
    },
    { idempotencyKey: `scheduled-report:daily-lead:${reportDate}`, metadata: { reportDate } },
  );
}

async function sendDailyLeadUnlockReport(input = {}) {
  const reportDate = reportDateValue(input.reportDate, input.now || new Date());
  const { start, end } = reportWindow(reportDate);
  const match = { unlockedAt: { $gte: start, $lt: end } };
  const [totalUnlocks, uniqueLeadsUnlocked, methodRows] = await Promise.all([
    ProviderLeadUnlock.countDocuments(match),
    aggregateSingle(ProviderLeadUnlock, [
      { $match: match },
      { $group: { _id: "$enquiryId" } },
      { $count: "value" },
    ]),
    ProviderLeadUnlock.aggregate([
      { $match: match },
      { $group: { _id: "$unlockMethod", count: { $sum: 1 }, credits: { $sum: "$chargedCredits" } } },
    ]).option({ maxTimeMS: 10000 }),
  ]);
  const methods = Object.fromEntries(methodRows.map((row) => [String(row._id || ""), row]));
  const creditsConsumed = methodRows.reduce((sum, row) => sum + Number(row.credits || 0), 0);
  return scheduledAlertService.sendInternalEvent(
    "daily_lead_unlock_report",
    {
      report_date: displayIndiaDate(start),
      total_unlocks: number(totalUnlocks),
      unique_leads_unlocked: number(uniqueLeadsUnlocked),
      credit_unlocks: number(methods.credits?.count),
      direct_payment_unlocks: number(methods.direct_payment?.count),
      admin_unlocks: number(methods.admin?.count),
      credits_consumed: number(creditsConsumed),
    },
    { idempotencyKey: `scheduled-report:daily-lead-unlock:${reportDate}`, metadata: { reportDate } },
  );
}

async function sendDailyProviderReport(input = {}) {
  const reportDate = reportDateValue(input.reportDate, input.now || new Date());
  const { start, end } = reportWindow(reportDate);
  const created = { createdAt: { $gte: start, $lt: end } };
  const [providersAdded, activeAdded, totalActiveProviders] = await Promise.all([
    Provider.countDocuments(created),
    Provider.countDocuments({ ...created, status: "active" }),
    Provider.countDocuments({ status: "active", portalAccessEnabled: { $ne: false } }),
  ]);
  return scheduledAlertService.sendInternalEvent(
    "daily_provider_report",
    {
      report_date: displayIndiaDate(start),
      providers_added: number(providersAdded),
      active_added: number(activeAdded),
      inactive_added: number(Math.max(0, providersAdded - activeAdded)),
      total_active_providers: number(totalActiveProviders),
    },
    { idempotencyKey: `scheduled-report:daily-provider:${reportDate}`, metadata: { reportDate } },
  );
}

async function sendDailyFollowUpReport(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const reportDate = reportDateValue(input.reportDate, now);
  const { start, end } = reportWindow(reportDate);
  const openStatuses = { $in: ["open", "pending"] };
  const [created, completed, openPending, dueOnReportDate, overdue] = await Promise.all([
    FollowUp.countDocuments({ createdAt: { $gte: start, $lt: end } }),
    FollowUp.countDocuments({ completedAt: { $gte: start, $lt: end } }),
    FollowUp.countDocuments({ status: openStatuses }),
    FollowUp.countDocuments({ status: openStatuses, dueAt: { $gte: start, $lt: end } }),
    FollowUp.countDocuments({ status: openStatuses, dueAt: { $ne: null, $lt: now } }),
  ]);
  return scheduledAlertService.sendInternalEvent(
    "daily_follow_up_report",
    {
      report_date: displayIndiaDate(start),
      follow_ups_created: number(created),
      completed: number(completed),
      open_pending: number(openPending),
      due_on_report_date: number(dueOnReportDate),
      overdue: number(overdue),
    },
    { idempotencyKey: `scheduled-report:daily-follow-up:${reportDate}`, metadata: { reportDate } },
  );
}

async function sendDailyCrmHealthReport(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const reportDate = reportDateValue(input.reportDate, now);
  const { start, end } = reportWindow(reportDate);
  const failureWindow = { status: { $in: TERMINAL_FAILURE_STATUSES }, failedAt: { $gte: start, $lt: end } };
  const [failedEmail, failedWhatsapp, failedCrmSyncs, providersMissingLocation, overdueFollowUps] = await Promise.all([
    Communication.countDocuments({ ...failureWindow, channel: "email" }),
    Communication.countDocuments({ ...failureWindow, channel: "whatsapp" }),
    ProviderLeadUnlock.countDocuments({ crmSyncStatus: "failed" }),
    Provider.countDocuments({
      status: "active",
      portalAccessEnabled: { $ne: false },
      $or: [
        { serviceLatitude: null },
        { serviceLongitude: null },
        { serviceLatitude: { $exists: false } },
        { serviceLongitude: { $exists: false } },
      ],
    }),
    FollowUp.countDocuments({ status: { $in: ["open", "pending"] }, dueAt: { $ne: null, $lt: now } }),
  ]);
  const attention = failedEmail + failedWhatsapp + failedCrmSyncs + providersMissingLocation + overdueFollowUps;
  return scheduledAlertService.sendInternalEvent(
    "daily_crm_health_report",
    {
      report_date: displayIndiaDate(start),
      failed_email_deliveries: number(failedEmail),
      failed_whatsapp_deliveries: number(failedWhatsapp),
      failed_crm_syncs: number(failedCrmSyncs),
      providers_missing_location: number(providersMissingLocation),
      overdue_follow_ups: number(overdueFollowUps),
      overall_status: attention > 0 ? "Attention required" : "Healthy",
    },
    { idempotencyKey: `scheduled-report:daily-crm-health:${reportDate}`, metadata: { reportDate } },
  );
}

function excludedTestingProviderIds() {
  return [...new Set(String(process.env.TESTING_PROVIDER_REPORT_EXCLUDED_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function indiaHourKey(now = new Date()) {
  return indiaShift(now).toISOString().slice(0, 13);
}

async function sendTestingProviderAlert(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const categorySlug = String(process.env.TESTING_PROVIDER_CATEGORY_SLUG || "").trim();
  if (!categorySlug) {
    throw Object.assign(new Error("TESTING_PROVIDER_CATEGORY_SLUG is not configured"), { status: 503 });
  }
  const excludedIds = excludedTestingProviderIds();
  const query = { categorySlugs: categorySlug };
  if (excludedIds.length) query.providerId = { $nin: excludedIds };
  const count = await Provider.countDocuments(query);
  if (!count) {
    return {
      skipped: true,
      reason: "No non-excluded providers are assigned to the Testing category",
      count: 0,
      categorySlug,
      excludedProviderIds: excludedIds.length,
    };
  }
  const hourKey = indiaHourKey(now);
  const communication = await scheduledAlertService.sendInternalEvent(
    "testing_provider_alert",
    {
      testing_category: categorySlug,
      testing_provider_count: number(count),
      checked_at: displayIndiaDateTime(now),
    },
    {
      idempotencyKey: `scheduled-alert:testing-providers:${hourKey}`,
      metadata: { categorySlug, count, excludedProviderIds: excludedIds.length, hourKey },
    },
  );
  return { communication, count, categorySlug, excludedProviderIds: excludedIds.length, hourKey };
}

module.exports = {
  reportDateValue,
  reportWindow,
  excludedTestingProviderIds,
  indiaHourKey,
  sendDailyLeadReport,
  sendDailyLeadUnlockReport,
  sendDailyProviderReport,
  sendDailyFollowUpReport,
  sendDailyCrmHealthReport,
  sendTestingProviderAlert,
};
