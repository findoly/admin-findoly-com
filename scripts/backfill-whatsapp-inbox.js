#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Communication = require("../models/Communication");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const inboxService = require("../services/communication/whatsapp-inbox-service");

function dryRunEnabled(argv = process.argv.slice(2)) {
  return argv.includes("--dry-run");
}

async function alreadyImported(communication) {
  const communicationId = String(communication.communicationId || "");
  const providerMessageId = String(communication.providerMessageId || "");
  const clauses = [];
  if (communicationId) clauses.push({ communicationId });
  if (providerMessageId) clauses.push({ providerMessageId });
  if (!clauses.length) return false;
  return Boolean(await WhatsAppMessage.exists(clauses.length === 1 ? clauses[0] : { $or: clauses }));
}

async function processDirection(direction, { dryRun, summary }) {
  const cursor = Communication.find({ channel: "whatsapp", direction })
    .sort({ createdAt: 1, _id: 1 })
    .lean()
    .cursor();
  for await (const communication of cursor) {
    summary.scanned += 1;
    if (!inboxService.isCustomerCommunication(communication)) {
      summary.skipped += 1;
      continue;
    }
    summary.eligible += 1;
    if (await alreadyImported(communication)) {
      summary.alreadyImported += 1;
      continue;
    }
    if (dryRun) continue;
    try {
      const result = await inboxService.recordCommunication(communication, {
        imported: true,
        markUnread: false,
        allowCreateConversation: direction === "inbound",
      });
      if (result.inserted) summary.imported += 1;
      else if (result.reason === "conversation_not_started") summary.skipped += 1;
      else summary.alreadyImported += 1;
    } catch (error) {
      summary.failed += 1;
      console.error({
        event: "whatsapp_inbox_migration_record_failed",
        communicationId: communication.communicationId || "",
        code: String(error.code || "WHATSAPP_INBOX_MIGRATION_FAILED"),
        message: inboxService.safeLogMessage(error.message, "WhatsApp inbox migration failed"),
      });
    }
  }
}

async function run({ dryRun = dryRunEnabled() } = {}) {
  await connectDatabase();
  const summary = {
    dryRun,
    scanned: 0,
    eligible: 0,
    imported: 0,
    alreadyImported: 0,
    skipped: 0,
    failed: 0,
  };

  // Inbound records create the customer conversation first. Outbound records
  // are then attached only when that customer has actually messaged Findoly.
  await processDirection("inbound", { dryRun, summary });
  await processDirection("outbound", { dryRun, summary });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) {
    const error = new Error(`${summary.failed} WhatsApp communication records could not be imported`);
    error.code = "WHATSAPP_INBOX_MIGRATION_PARTIAL_FAILURE";
    error.report = summary;
    throw error;
  }
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      if (error.report) console.error(JSON.stringify(error.report, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = { dryRunEnabled, alreadyImported, run };
