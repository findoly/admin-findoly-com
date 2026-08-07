"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

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

function baseStubs(overrides = {}) {
  return {
    "../../models/Communication": {},
    "./communication-service": {
      async createInbound(input) { return { communicationId: "inbound-1", ...input, channel: "whatsapp", direction: "inbound", status: "received" }; },
      async updateDeliveryStatus() { return { matched: 0 }; },
      async recordUnmatchedWhatsAppEvent() { return { communicationId: "audit-1" }; },
    },
    "./whatsapp-service": { verifyWebhookToken() { return true; } },
    "./provider-whatsapp-action-service": { async processInbound() { return { handled: false }; } },
    "./template-service": { async processProviderEvent() { return {}; } },
    "./whatsapp-inbox-service": {
      normalizeMessageType(value) { return String(value || "text").toLowerCase(); },
      validateInboundMedia(value) { return value; },
      async recordInbound() {},
      async syncDeliveryStatus() { return { matched: 0 }; },
    },
    ...overrides,
  };
}

test("normal inbound Gupshup messages are stored in the shared inbox", async () => {
  let recorded = null;
  const stubs = baseStubs();
  stubs["./whatsapp-inbox-service"] = {
    normalizeMessageType(value) { return String(value || "text").toLowerCase(); },
    validateInboundMedia(value) { return value; },
    async recordInbound(input) { recorded = input; },
    async syncDeliveryStatus() {},
  };
  const webhook = loadWithStubs("services/communication/webhook-service.js", stubs);
  const event = {
    type: "message",
    timestamp: 1786032732,
    payload: {
      id: "wamid-customer-1",
      source: "919876543210",
      type: "text",
      payload: { text: "Need a painter" },
      sender: { name: "Customer", phone: "919876543210" },
    },
  };
  const result = await webhook.processWhatsApp(Buffer.from(JSON.stringify(event)), {});
  assert.equal(result.inboxConversation, true);
  assert.equal(recorded.communication.communicationId, "inbound-1");
  assert.equal(recorded.communication.metadata.accountType, "customer");
  assert.equal(recorded.messageType, "text");
  assert.equal(recorded.communication.message, "Need a painter");
});

test("provider View Enquiry actions never enter the customer inbox", async () => {
  let recorded = false;
  const stubs = baseStubs({
    "./provider-whatsapp-action-service": { async processInbound() { return { handled: true, status: "unlocked" }; } },
  });
  stubs["./whatsapp-inbox-service"] = {
    normalizeMessageType() { return "interactive"; },
    validateInboundMedia(value) { return value; },
    async recordInbound() { recorded = true; },
    async syncDeliveryStatus() {},
  };
  const webhook = loadWithStubs("services/communication/webhook-service.js", stubs);
  const result = await webhook.processWhatsApp(Buffer.from(JSON.stringify({
    type: "message",
    payload: { id: "action-1", source: "919876543210", type: "quick_reply" },
  })), {});
  assert.equal(result.action.status, "unlocked");
  assert.equal(recorded, false);
});

test("matched Gupshup delivery callbacks synchronize inbox message status", async () => {
  let synced = null;
  const stubs = baseStubs({
    "./communication-service": {
      async updateDeliveryStatus() { return { matched: 1, communicationId: "communication-1" }; },
      async recordUnmatchedWhatsAppEvent() { throw new Error("must not be called"); },
    },
  });
  stubs["./whatsapp-inbox-service"] = {
    normalizeMessageType() { return "text"; },
    validateInboundMedia(value) { return value; },
    async recordInbound() {},
    async syncDeliveryStatus(input) { synced = input; return { matched: 1 }; },
  };
  const webhook = loadWithStubs("services/communication/webhook-service.js", stubs);
  await webhook.processWhatsApp(Buffer.from(JSON.stringify({
    type: "message-event",
    timestamp: 1786032732,
    payload: { id: "meta-1", gsId: "gs-1", type: "delivered", destination: "919876543210", payload: {} },
  })), {});
  assert.equal(synced.communicationId, "communication-1");
  assert.deepEqual(synced.messageIds, ["gs-1", "meta-1"]);
  assert.equal(synced.status, "delivered");
});


test("inbound Gupshup media is passed to private inbox storage without exposing the URL in safe metadata", async () => {
  let inboundInput = null;
  let communicationInput = null;
  const stubs = baseStubs({
    "./communication-service": {
      async createInbound(input) {
        communicationInput = input;
        return { communicationId: "media-inbound-1", ...input, channel: "whatsapp", direction: "inbound", status: "received" };
      },
      async updateDeliveryStatus() { return { matched: 0 }; },
      async recordUnmatchedWhatsAppEvent() { return { communicationId: "audit-1" }; },
    },
  });
  stubs["./whatsapp-inbox-service"] = {
    normalizeMessageType(value) { return String(value || "text").toLowerCase(); },
    validateInboundMedia(value) { return { ...value, sourceUrl: value.sourceUrl }; },
    async recordInbound(input) { inboundInput = input; },
    async syncDeliveryStatus() {},
  };
  const webhook = loadWithStubs("services/communication/webhook-service.js", stubs);
  await webhook.processWhatsApp(Buffer.from(JSON.stringify({
    type: "message",
    payload: {
      id: "wamid-media-1",
      source: "919876543210",
      type: "document",
      payload: {
        url: "https://filemanager.gupshup.io/fm/wamedia/app/file-1",
        name: "quotation.pdf",
        "content-type": "application/pdf",
        caption: "Quotation",
      },
      sender: { name: "Customer", phone: "919876543210" },
    },
  })), {});
  assert.equal(inboundInput.messageType, "document");
  assert.equal(inboundInput.media.sourceUrl, "https://filemanager.gupshup.io/fm/wamedia/app/file-1");
  assert.equal(inboundInput.media.fileName, "quotation.pdf");
  assert.equal(communicationInput.metadata.whatsappMedia.fileName, "quotation.pdf");
  assert.equal(Object.hasOwn(communicationInput.metadata.whatsappMedia, "sourceUrl"), false);
});
