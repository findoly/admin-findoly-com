"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function compile(relativePath, mocks) {
  const filename = path.join(__dirname, "..", relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => (
    Object.prototype.hasOwnProperty.call(mocks, request)
      ? mocks[request]
      : Module.createRequire(filename)(request)
  );
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports;
}

test("CRM communication idempotency uses the provider outbox event ID", async () => {
  const sent = [];
  const queryResult = (value) => ({ async lean() { return value; } });
  const service = compile("services/communication/system-event-service.js", {
    "../../models/CommunicationTemplate": {
      async updateOne() {},
      findOne() { return queryResult({ templateId: "template-1" }); },
    },
    "../../models/Enquiry": {
      findOne() { return queryResult({ enquiryId: "lead-1", requirementTitle: "Paint", category: "Painting" }); },
    },
    "../../models/ProviderLeadUnlock": {
      findOne() { return queryResult({ providerLeadUnlockId: "unlock-1", enquiryId: "lead-1", providerId: "provider-1" }); },
    },
    "../../models/Provider": {
      findOne() { return queryResult({ providerId: "provider-1", name: "Provider", email: "provider@example.com" }); },
    },
    "./communication-service": {
      async send(input) { sent.push(input); return { communicationId: `communication-${sent.length}` }; },
    },
  });

  const base = {
    providerLeadUnlockId: "unlock-1",
    enquiryId: "lead-1",
    providerId: "provider-1",
    eventAt: "2026-08-02T10:00:00.000Z",
  };
  await service.dispatch("provider_lead_unlocked", { ...base, integrationEventId: "outbox-event-a" });
  await service.dispatch("provider_lead_unlocked", { ...base, integrationEventId: "outbox-event-b" });

  assert.equal(sent.length, 4);
  assert.match(sent[0].idempotencyKey, /outbox-event-a$/);
  assert.match(sent[1].idempotencyKey, /outbox-event-a$/);
  assert.match(sent[2].idempotencyKey, /outbox-event-b$/);
  assert.match(sent[3].idempotencyKey, /outbox-event-b$/);
  assert.notEqual(sent[0].idempotencyKey, sent[2].idempotencyKey);
});

function statusServiceFor({
  currentEventId = "current-event",
  appliedSequence = 2,
  committedSequence = null,
  currentOutcome = "confirmed",
  currentActivity = "contacted",
} = {}) {
  let unlockSaves = 0;
  let leadSaves = 0;
  const unlock = {
    providerLeadUnlockId: "unlock-1",
    enquiryId: "lead-1",
    providerId: "provider-1",
    providerName: "Provider",
    providerSaleOutcome: currentOutcome,
    providerSaleOutcomeNote: "current outcome",
    providerLeadStatus: currentActivity,
    providerLeadReason: "",
    providerLeadNote: "current activity",
    providerSaleOutcomeUpdatedAt: new Date("2026-08-02T10:00:00.000Z"),
    crmSyncStatus: "pending",
    crmSyncCurrentEventId: currentEventId,
    crmSyncSequence: committedSequence === null ? appliedSequence : committedSequence,
    crmSyncAppliedSequence: appliedSequence,
    crmSyncError: "waiting",
    toObject() { return { ...this, toObject: undefined, save: undefined }; },
    async save() { unlockSaves += 1; },
  };
  const lead = {
    enquiryId: "lead-1",
    providerConfirmedCount: currentOutcome === "confirmed" ? 1 : 0,
    providerSaleConversionStatus: currentOutcome === "confirmed" ? "converted" : "not_converted",
    providerSaleConvertedAt: currentOutcome === "confirmed"
      ? new Date("2026-08-02T10:00:00.000Z")
      : null,
    toObject() { return { ...this, toObject: undefined, save: undefined }; },
    async save() { leadSaves += 1; },
  };
  const sessionQuery = (value) => ({ session() { return Promise.resolve(value); } });
  const service = compile("services/provider-unlock/provider-status-service.js", {
    "../../models/Enquiry": { findOne() { return sessionQuery(lead); } },
    "../../models/ProviderLeadUnlock": { findOne() { return sessionQuery(unlock); } },
    "../../utils/transaction": { async withTransaction(callback) { return callback({ id: "session" }); } },
    "../../utils/provider-lead-status": {
      PROVIDER_LEAD_STATUSES: ["contacted"],
      PROVIDER_SALE_OUTCOMES: ["confirmed", "not_confirmed"],
      providerStatusFromEvent: () => "",
      providerOutcomeFromEvent: () => "",
    },
    "../../utils/validation": {
      identifierValue: (value) => String(value || "").trim(),
      enumValue: (value, allowed, options = {}) => {
        const normalized = String(value || options.fallback || "").trim();
        if (!allowed.includes(normalized)) throw new Error("invalid enum");
        return normalized;
      },
      textValue: (value) => String(value || "").trim(),
      validationError: (message) => Object.assign(new Error(message), { status: 400 }),
    },
    "../communication/notification-service": { async triggerSafe() {} },
  });
  return {
    service,
    unlock,
    lead,
    counts: () => ({ unlockSaves, leadSaves }),
  };
}

test("an older sequence is accepted as stale without overwriting newer CRM state", async () => {
  const { service, unlock, lead, counts } = statusServiceFor({
    currentEventId: "newer-event",
    appliedSequence: 2,
  });
  const result = await service.updateProviderLeadFeedback({
    providerLeadUnlockId: "unlock-1",
    integrationEventId: "older-event",
    integrationEventSequence: 1,
    outcome: "not_confirmed",
    activityStatus: "contacted",
    outcomeNote: "obsolete",
  });

  assert.equal(result.stale, true);
  assert.equal(result.duplicate, false);
  assert.equal(unlock.providerSaleOutcome, "confirmed");
  assert.equal(unlock.providerSaleOutcomeNote, "current outcome");
  assert.equal(unlock.crmSyncStatus, "pending");
  assert.equal(unlock.crmSyncError, "waiting");
  assert.equal(lead.providerConfirmedCount, 1);
  assert.deepEqual(counts(), { unlockSaves: 0, leadSaves: 0 });
});

test("a delayed event cannot overwrite a newer committed provider update", async () => {
  const { service, unlock, lead, counts } = statusServiceFor({
    currentEventId: "latest-event",
    appliedSequence: 0,
    committedSequence: 3,
  });
  const result = await service.updateProviderLeadFeedback({
    providerLeadUnlockId: "unlock-1",
    integrationEventId: "delayed-event",
    integrationEventSequence: 2,
    outcome: "not_confirmed",
    activityStatus: "contacted",
  });

  assert.equal(result.stale, true);
  assert.equal(unlock.providerSaleOutcome, "confirmed");
  assert.equal(lead.providerConfirmedCount, 1);
  assert.deepEqual(counts(), { unlockSaves: 0, leadSaves: 0 });
});

test("a duplicate sequence is a business-state no-op but remains distinguishable from stale", async () => {
  const { service, unlock, lead, counts } = statusServiceFor({
    currentEventId: "matching-event",
    appliedSequence: 2,
  });
  const result = await service.updateProviderLeadFeedback({
    providerLeadUnlockId: "unlock-1",
    integrationEventId: "matching-event",
    integrationEventSequence: 2,
    outcome: "not_confirmed",
    activityStatus: "contacted",
  });

  assert.equal(result.stale, false);
  assert.equal(result.duplicate, true);
  assert.equal(unlock.providerSaleOutcome, "confirmed");
  assert.equal(lead.providerConfirmedCount, 1);
  assert.deepEqual(counts(), { unlockSaves: 0, leadSaves: 0 });
});

test("a newer sequence applies feedback and updates the matching shared sync summary", async () => {
  const { service, unlock, lead, counts } = statusServiceFor({
    currentEventId: "new-event",
    appliedSequence: 2,
    committedSequence: 3,
  });
  const result = await service.updateProviderLeadFeedback({
    providerLeadUnlockId: "unlock-1",
    integrationEventId: "new-event",
    integrationEventSequence: 3,
    outcome: "not_confirmed",
    activityStatus: "contacted",
    outcomeNote: "latest",
  });

  assert.equal(result.stale, false);
  assert.equal(result.duplicate, false);
  assert.equal(unlock.providerSaleOutcome, "not_confirmed");
  assert.equal(unlock.providerSaleOutcomeNote, "latest");
  assert.equal(unlock.crmSyncAppliedSequence, 3);
  assert.equal(unlock.crmSyncStatus, "synced");
  assert.equal(unlock.crmSyncError, "");
  assert.equal(lead.providerConfirmedCount, 0);
  assert.equal(lead.providerSaleConversionStatus, "not_converted");
  assert.deepEqual(counts(), { unlockSaves: 1, leadSaves: 1 });
});

test("an unsequenced integration replay cannot overwrite sequenced state", async () => {
  const { service, unlock, counts } = statusServiceFor({ appliedSequence: 4 });
  const result = await service.updateProviderLeadFeedback({
    providerLeadUnlockId: "unlock-1",
    integrationEventId: "legacy-event",
    outcome: "not_confirmed",
    activityStatus: "contacted",
  });
  assert.equal(result.stale, true);
  assert.equal(unlock.providerSaleOutcome, "confirmed");
  assert.deepEqual(counts(), { unlockSaves: 0, leadSaves: 0 });
});

test("malformed integration sequences fail validation", async () => {
  const { service } = statusServiceFor();
  await assert.rejects(
    service.updateProviderLeadFeedback({
      providerLeadUnlockId: "unlock-1",
      integrationEventId: "bad-event",
      integrationEventSequence: "2.5",
      outcome: "confirmed",
      activityStatus: "contacted",
    }),
    /positive integer number/,
  );
  await assert.rejects(
    service.updateProviderLeadFeedback({
      providerLeadUnlockId: "unlock-1",
      integrationEventId: "string-event",
      integrationEventSequence: "2",
      outcome: "confirmed",
      activityStatus: "contacted",
    }),
    /positive integer number/,
  );
});

test("the integration controller suppresses communications for stale events", async () => {
  let dispatchCalls = 0;
  let notificationCalls = 0;
  let responseBody;
  const controller = compile("controllers/communicationController.js", {
    "../models/Communication": {},
    "../models/CommunicationTemplate": {},
    "../models/CommunicationRule": {},
    "../models/OtpRequest": {},
    "../models/Enquiry": {},
    "../services/communication/communication-service": {},
    "../services/communication/template-service": {},
    "../services/communication/rule-service": {},
    "../services/communication/otp-service": {},
    "../services/communication/notification-service": {
      async trigger() { notificationCalls += 1; return []; },
    },
    "../services/communication/system-event-service": {
      async dispatch() { dispatchCalls += 1; return []; },
    },
    "../services/communication/webhook-service": {},
    "../services/communication/slack-service": {},
    "../services/communication/communication-config": { configurationStatus: () => ({}) },
    "../services/provider-unlock/provider-status-service": {
      providerStatusFromEvent: () => "contacted",
      providerOutcomeFromEvent: () => "confirmed",
      async updateProviderLeadFeedback() {
        return {
          stale: true,
          duplicate: false,
          unlock: {
            providerLeadUnlockId: "unlock-1",
            providerSaleOutcome: "confirmed",
            providerLeadStatus: "contacted",
          },
          lead: { enquiryId: "lead-1" },
        };
      },
    },
  });

  await controller.integrationEvent(
    {
      params: { event: "provider_feedback_updated" },
      body: {
        providerLeadUnlockId: "unlock-1",
        integrationEventId: "old-event",
        integrationEventSequence: 1,
      },
    },
    { json(body) { responseBody = body; return body; } },
    (error) => { throw error; },
  );

  assert.equal(dispatchCalls, 0);
  assert.equal(notificationCalls, 0);
  assert.deepEqual(responseBody.data.channelDeliveries, []);
  assert.deepEqual(responseBody.data.notificationEvents, []);
  assert.equal(responseBody.data.providerStatusUpdate.stale, true);
});
