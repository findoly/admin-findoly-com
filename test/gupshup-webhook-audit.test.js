"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function loadWithStubs(relativePath, stubs) {
  const absolute = require.resolve(path.join(root, relativePath));
  delete require.cache[absolute];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolute);
  } finally {
    Module._load = originalLoad;
    delete require.cache[absolute];
  }
}

test("Gupshup status events match using both gsId and Meta id", async () => {
  let updateInput = null;
  let unmatchedCalled = false;
  const webhook = loadWithStubs("services/communication/webhook-service.js", {
    "../../models/Communication": {},
    "./communication-service": {
      async updateDeliveryStatus(ids, status, details) {
        updateInput = { ids, status, details };
        return { matched: 1, communicationId: "communication-1", duplicate: false };
      },
      async recordUnmatchedWhatsAppEvent() {
        unmatchedCalled = true;
        return { communicationId: "audit-1" };
      },
    },
    "./whatsapp-service": { verifyWebhookToken() { return true; } },
    "./provider-whatsapp-action-service": { async processInbound() { return { handled: false }; } },
    "./template-service": { async processProviderEvent() { return { matched: 0, updated: 0 }; } },
  });

  const event = {
    app: "FindolyWhatsapp",
    timestamp: 1785835186660,
    version: 2,
    type: "message-event",
    payload: {
      id: "meta-message-log-1",
      gsId: "gupshup-message-log-1",
      type: "sent",
      destination: "919876543210",
      payload: { ts: 1785835185 },
    },
  };

  const result = await webhook.processWhatsApp(Buffer.from(JSON.stringify(event)), {});
  assert.deepEqual(updateInput.ids, [
    "gupshup-message-log-1",
    "meta-message-log-1",
  ]);
  assert.equal(updateInput.status, "sent");
  assert.equal(updateInput.details.gupshupMessageId, "gupshup-message-log-1");
  assert.equal(updateInput.details.metaMessageId, "meta-message-log-1");
  assert.equal(result.statusUpdates, 1);
  assert.equal(result.webhookAuditUpdates, 0);
  assert.equal(unmatchedCalled, false);
});

test("unmatched Gupshup status events create a visible webhook audit record", async () => {
  let auditInput = null;
  const webhook = loadWithStubs("services/communication/webhook-service.js", {
    "../../models/Communication": {},
    "./communication-service": {
      async updateDeliveryStatus() { return { matched: 0 }; },
      async recordUnmatchedWhatsAppEvent(input) {
        auditInput = input;
        return { communicationId: "audit-1", duplicate: false };
      },
    },
    "./whatsapp-service": { verifyWebhookToken() { return true; } },
    "./provider-whatsapp-action-service": { async processInbound() { return { handled: false }; } },
    "./template-service": { async processProviderEvent() { return { matched: 0, updated: 0 }; } },
  });

  const event = {
    app: "FindolyWhatsapp",
    timestamp: 1785835188240,
    version: 2,
    type: "message-event",
    payload: {
      id: "meta-message-1",
      gsId: "gupshup-message-1",
      type: "delivered",
      destination: "919876543210",
      payload: { ts: 1785835186 },
    },
  };

  const result = await webhook.processWhatsApp(Buffer.from(JSON.stringify(event)), {});
  assert.equal(result.statusUpdates, 0);
  assert.equal(result.webhookAuditUpdates, 1);
  assert.equal(result.unmatched, true);
  assert.equal(result.communicationId, "audit-1");
  assert.deepEqual(auditInput.messageIds, ["gupshup-message-1", "meta-message-1"]);
  assert.equal(auditInput.status, "delivered");
});

test("actual Gupshup Quick Reply payload is logged and never unlocks without signed postback", async () => {
  let inbound = null;
  let unlockCalled = false;
  const communicationStub = {
    async createInbound(input) { inbound = input; return { communicationId: "inbound-1" }; },
  };
  const action = loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": {
      findOne() {
        return {
          async lean() {
            return {
              communicationId: "outbound-1",
              enquiryId: "lead-1",
              providerId: "provider-1",
              recipientName: "Dhiraj",
              recipientContact: "919876543210",
            };
          },
        };
      },
    },
    "./communication-service": communicationStub,
    "../integration/provider-action-service": {
      async unlockLead() { unlockCalled = true; },
    },
  });

  const event = {
    app: "FindolyWhatsapp",
    timestamp: 1785835243114,
    version: 2,
    type: "message",
    payload: {
      id: "wamid.synthetic-button-reply-1",
      source: "919876543210",
      type: "quick_reply",
      payload: {
        text: "Quick Reply",
        type: "button",
        postbackText: "Quick Reply",
      },
      sender: {
        phone: "919876543210",
        name: "Dhiraj",
        country_code: "91",
        dial_code: "9876543210",
      },
      context: {
        id: "meta-message-log-1",
        gsId: "gupshup-message-log-1",
      },
    },
  };

  const result = await action.processInbound(event);
  assert.equal(result.handled, true);
  assert.equal(result.status, "logged");
  assert.equal(result.reason, "unsigned_action");
  assert.equal(unlockCalled, false);
  assert.equal(inbound.purpose, "whatsapp_button_reply");
  assert.equal(inbound.message, "Quick Reply");
  assert.equal(inbound.recipientName, "Dhiraj");
  assert.equal(inbound.enquiryId, "lead-1");
  assert.equal(inbound.providerId, "provider-1");
  assert.equal(inbound.metadata.originalCommunicationId, "outbound-1");
  assert.deepEqual(inbound.metadata.contextMessageIds, [
    "gupshup-message-log-1",
    "meta-message-log-1",
  ]);
  assert.equal(inbound.metadata.actionReason, "unsigned_action");
});

test("Communication Center exposes webhook audits, both message IDs and full event timeline", () => {
  const logs = source("views/communication/logs.ejs");
  const show = source("views/communication/show.ejs");
  const routes = source("routes/frontend.js");
  const service = source("services/communication/communication-service.js");
  assert.match(logs, /Unmatched webhook audit/);
  assert.match(logs, /metadata\?\.gupshupMessageId/);
  assert.match(logs, /metadata\?\.metaMessageId/);
  assert.match(logs, /statusHistory/);
  assert.match(show, /Event timeline/);
  assert.match(show, /Webhook and provider response/);
  assert.match(routes, /communications\/:communicationId/);
  assert.match(service, /whatsapp_delivery_event_unmatched/);
  assert.match(service, /metadata\.whatsappMessageIds/);
});

function communicationServiceWithModel(Communication) {
  const identity = (value) => value;
  return loadWithStubs("services/communication/communication-service.js", {
    "../../models/Communication": Communication,
    "../../models/CommunicationTemplate": {},
    "./message-gateway": {},
    "./whatsapp-service": {},
    "./whatsapp-action-token": {
      createUnlockAction() { return "signed"; },
      tokenHash() { return "hash"; },
      actionExpiryMinutes() { return 60; },
    },
    "./slack-service": { normalizeChannelId: identity },
    "./template-renderer": {
      renderText: identity,
      normalizeVariables: identity,
      templateParameterValues() { return []; },
    },
    "../../utils/mobile": { validateMobile: identity },
    "../../utils/pagination": {
      getPagination() { return { limit: 20, cursor: "" }; },
      cursorPaginate() { return { data: [], pagination: {} }; },
    },
    "../../utils/date-query": { applyDateRange() {}, dateSort() { return { createdAt: -1 }; } },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
    "../../utils/bounded-json": { boundedJsonValue: identity },
    "../../utils/validation": {
      textValue(value, options = {}) {
        const output = String(value ?? options.fallback ?? "").trim();
        if (options.required && !output) throw new Error(`${options.label || "Value"} is required`);
        return output;
      },
      emailValue: identity,
      enumValue(value, allowed, options = {}) { return value || options.fallback || allowed[0]; },
      identifierValue: identity,
      queryTextValue: identity,
      plainObjectValue(value) { return value || {}; },
      booleanValue(value, options = {}) { return value === undefined ? Boolean(options.fallback) : Boolean(value); },
      validationError(message, status = 400) { return Object.assign(new Error(message), { status }); },
    },
  });
}

test("delivery update stores both Gupshup and Meta IDs and appends webhook timeline", async () => {
  let findQuery = null;
  let updatePayload = null;
  const current = {
    communicationId: "communication-1",
    purpose: "nearby_lead_available",
    status: "accepted",
    providerMessageId: "gupshup-message-1",
    statusHistory: [],
    metadata: {},
  };
  const Communication = {
    findOne(query) {
      findQuery = query;
      return { async lean() { return current; } };
    },
    async updateOne(query, update) {
      assert.deepEqual(query, { communicationId: "communication-1" });
      updatePayload = update;
      return { modifiedCount: 1 };
    },
  };
  const service = communicationServiceWithModel(Communication);
  const result = await service.updateDeliveryStatus(
    ["gupshup-message-1", "meta-message-1"],
    "delivered",
    {
      eventAt: new Date("2026-08-04T09:19:48.240Z"),
      eventKey: "gupshup:delivered:gupshup-message-1:meta-message-1:2026-08-04T09:19:48.240Z",
      gupshupMessageId: "gupshup-message-1",
      metaMessageId: "meta-message-1",
    },
  );
  assert.equal(result.matched, 1);
  assert.equal(findQuery.purpose.$ne, "whatsapp_delivery_event_unmatched");
  assert.deepEqual(findQuery.$or[0], { providerMessageId: { $in: ["gupshup-message-1", "meta-message-1"] } });
  assert.equal(updatePayload.$set.status, "delivered");
  assert.equal(updatePayload.$set["metadata.gupshupMessageId"], "gupshup-message-1");
  assert.equal(updatePayload.$set["metadata.metaMessageId"], "meta-message-1");
  assert.deepEqual(updatePayload.$addToSet["metadata.whatsappMessageIds"].$each, ["gupshup-message-1", "meta-message-1"]);
  assert.equal(updatePayload.$push.statusHistory.$each[0].source, "gupshup_webhook");
});

test("unmatched delivery event becomes a searchable Communication Center audit row", async () => {
  let createdInput = null;
  const Communication = {
    findOne() { return { async lean() { return null; } }; },
    async create(input) {
      createdInput = input;
      return { communicationId: "audit-1" };
    },
  };
  const service = communicationServiceWithModel(Communication);
  const result = await service.recordUnmatchedWhatsAppEvent({
    messageIds: ["gupshup-message-1", "meta-message-1"],
    gupshupMessageId: "gupshup-message-1",
    metaMessageId: "meta-message-1",
    status: "read",
    destination: "919876543210",
    eventAt: new Date("2026-08-04T09:20:39.497Z"),
    eventKey: "read-event",
    event: { type: "message-event" },
  });
  assert.equal(result.created, true);
  assert.equal(createdInput.direction, "inbound");
  assert.equal(createdInput.purpose, "whatsapp_delivery_event_unmatched");
  assert.equal(createdInput.status, "read");
  assert.equal(createdInput.providerMessageId, "gupshup-message-1");
  assert.deepEqual(createdInput.metadata.whatsappMessageIds, ["gupshup-message-1", "meta-message-1"]);
  assert.equal(createdInput.metadata.webhookMatched, false);
  assert.equal(createdInput.statusHistory[0].source, "gupshup_webhook");
});

test("late delivery callbacks do not downgrade an already-read communication", async () => {
  let updatePayload = null;
  const Communication = {
    findOne() {
      return {
        async lean() {
          return {
            communicationId: "communication-read",
            purpose: "nearby_lead_available",
            status: "read",
            providerMessageId: "gupshup-read",
            statusHistory: [],
            metadata: {},
          };
        },
      };
    },
    async updateOne(_query, update) {
      updatePayload = update;
      return { modifiedCount: 1 };
    },
  };
  const service = communicationServiceWithModel(Communication);
  await service.updateDeliveryStatus("gupshup-read", "delivered", {
    eventAt: new Date("2026-08-04T09:20:00.000Z"),
    eventKey: "late-delivered",
  });
  assert.equal(updatePayload.$set.status, "read");
  assert.equal(updatePayload.$push.statusHistory.$each[0].status, "delivered");
});

test("valid opaque quick reply logs the click, calls Provider Portal once and records result timeline", async () => {
  const previousSecret = process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET;
  const previousApp = process.env.CRM_GUPSHUP_APP_NAME;
  process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET = "s".repeat(64);
  process.env.CRM_GUPSHUP_APP_NAME = "FindolyWhatsapp";
  const tokenModulePath = require.resolve(path.join(root, "services/communication/whatsapp-action-token.js"));
  delete require.cache[tokenModulePath];
  const tokens = require(tokenModulePath);
  const signed = tokens.createUnlockAction({ communicationId: "communication-1" });
  const updates = [];
  let unlockCalls = 0;
  let responseCalls = 0;
  const original = {
    communicationId: "communication-1",
    enquiryId: "lead-1",
    providerId: "provider-1",
    recipientName: "Provider One",
    recipientContact: "919876543210",
    providerMessageId: "gupshup-message-1",
    direction: "outbound",
    channel: "whatsapp",
    purpose: "nearby_lead_available",
    metadata: {
      whatsappMessageIds: ["gupshup-message-1", "meta-message-1"],
      whatsappUnlock: {
        type: "unlock_lead",
        status: "pending",
        tokenHash: tokens.tokenHash(signed),
        expiresAt: new Date(Date.now() + 60_000),
      },
    },
  };
  const Communication = {
    findOne() { return { async lean() { return original; } }; },
    findOneAndUpdate() { return { async lean() { return original; } }; },
    async updateOne(query, update) { updates.push({ query, update }); return { modifiedCount: 1 }; },
  };
  const action = loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": Communication,
    "./communication-service": {
      async createInbound() { return { communicationId: "inbound-1" }; },
      async sendWhatsappSession() { responseCalls += 1; return { communicationId: "response-1" }; },
    },
    "../integration/provider-action-service": {
      async unlockLead(input) {
        unlockCalls += 1;
        assert.equal(input.providerId, "provider-1");
        assert.equal(input.enquiryId, "lead-1");
        return {
          status: "unlocked",
          lead: { enquiryId: "lead-1", customerName: "Customer", customerMobile: "919999999999" },
          provider: { availableCredits: 90 },
        };
      },
    },
  });
  try {
    const result = await action.processInbound({
      app: "FindolyWhatsapp",
      type: "message",
      payload: {
        id: "inbound-message-1",
        source: "919876543210",
        type: "quick_reply",
        payload: { text: "Unlock Lead", type: "button", postbackText: signed },
        context: { gsId: "gupshup-message-1", id: "meta-message-1" },
      },
    });
    assert.equal(result.status, "unlocked");
    assert.equal(result.responseSent, true);
    assert.equal(unlockCalls, 1);
    assert.equal(responseCalls, 1);
    const historyStatuses = updates.flatMap(({ update }) => update.$push?.statusHistory?.$each?.map((entry) => entry.status) || []);
    assert.ok(historyStatuses.includes("whatsapp_unlock_requested"));
    assert.ok(historyStatuses.includes("whatsapp_unlock_unlocked"));
  } finally {
    if (previousSecret === undefined) delete process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET;
    else process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET = previousSecret;
    if (previousApp === undefined) delete process.env.CRM_GUPSHUP_APP_NAME;
    else process.env.CRM_GUPSHUP_APP_NAME = previousApp;
    delete require.cache[tokenModulePath];
  }
});
