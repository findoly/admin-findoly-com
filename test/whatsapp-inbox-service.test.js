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

function service() {
  return loadWithStubs("services/communication/whatsapp-inbox-service.js", {
    "../../models/WhatsAppConversation": {},
    "../../models/WhatsAppMessage": {},
    "../../models/Communication": {},
    "../../models/Enquiry": {},
    "./communication-service": {},
    "../../utils/uuid": () => "generated-id",
    "../../utils/pagination": { cursorPaginate() {}, getPagination() { return { limit: 20, cursor: "" }; } },
  });
}

test("WhatsApp inbox normalizes supported message types and safe previews", () => {
  const inbox = service();
  assert.equal(inbox.normalizeMessageType("quick_reply"), "interactive");
  assert.equal(inbox.normalizeMessageType("PDF"), "document");
  assert.equal(inbox.normalizeMessageType("unexpected"), "unknown");
  assert.equal(inbox.previewFor("image", "  kitchen photo  "), "[Image] kitchen photo");
  assert.equal(inbox.previewFor("text", "hello\nthere"), "hello there");
});

test("WhatsApp inbox excludes provider action traffic and keeps customer traffic", () => {
  const inbox = service();
  assert.equal(inbox.isCustomerCommunication({
    channel: "whatsapp",
    direction: "inbound",
    purpose: "inbound_message",
    recipientContact: "919876543210",
    metadata: { accountType: "customer" },
  }), true);
  assert.equal(inbox.isCustomerCommunication({
    channel: "whatsapp",
    purpose: "nearby_lead_available",
    recipientContact: "9876543210",
    metadata: { accountType: "provider" },
  }), false);
  assert.equal(inbox.isCustomerCommunication({
    channel: "whatsapp",
    purpose: "whatsapp_unlock_result",
    recipientContact: "9876543210",
  }), false);
  assert.equal(inbox.isCustomerCommunication({
    channel: "whatsapp",
    purpose: "provider_created",
    providerId: "provider-1",
    recipientContact: "9876543210",
  }), false);
  assert.equal(inbox.isCustomerCommunication({
    channel: "email",
    recipientContact: "customer@example.com",
  }), false);
});

test("delivery status cannot regress after delivered or read", () => {
  const inbox = service();
  assert.equal(inbox.resolvedStatus("delivered", "sent"), "delivered");
  assert.equal(inbox.resolvedStatus("read", "delivered"), "read");
  assert.equal(inbox.resolvedStatus("accepted", "delivered"), "delivered");
  assert.equal(inbox.resolvedStatus("delivered", "failed"), "failed");
});

test("contact normalization accepts Indian Gupshup formats only", () => {
  const inbox = service();
  assert.equal(inbox.safeContact("+91 98765 43210"), "9876543210");
  assert.equal(inbox.safeContact("09876543210"), "9876543210");
  assert.equal(inbox.safeContact("123"), "");
});

function chainResult(value) {
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    maxTimeMS() { return this; },
    lean: async () => value,
  };
}

test("outbound WhatsApp traffic does not create an inbox until the customer has messaged", async () => {
  let updateOptions = null;
  const inbox = loadWithStubs("services/communication/whatsapp-inbox-service.js", {
    "../../models/WhatsAppConversation": {
      findOne() { return chainResult(null); },
      findOneAndUpdate(_filter, _update, options) {
        updateOptions = options;
        return { lean: async () => null };
      },
    },
    "../../models/WhatsAppMessage": {},
    "../../models/Communication": {},
    "../../models/Enquiry": {
      find() { return chainResult([]); },
      countDocuments() { return { maxTimeMS: async () => 0 }; },
    },
    "./communication-service": {},
    "../../utils/uuid": () => "generated-id",
    "../../utils/pagination": { cursorPaginate() {}, getPagination() { return { limit: 20, cursor: "" }; } },
  });

  const result = await inbox.recordCommunication({
    communicationId: "outbound-only-1",
    channel: "whatsapp",
    direction: "outbound",
    purpose: "manual",
    recipientContact: "9876543210",
    status: "accepted",
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "conversation_not_started");
  assert.equal(updateOptions, null);
});

test("manual inbox replies enrich an existing message with the sending employee", async () => {
  const messageUpdates = [];
  let messageUpdateCount = 0;
  const inbox = loadWithStubs("services/communication/whatsapp-inbox-service.js", {
    "../../models/WhatsAppConversation": {
      findOne() { return chainResult({ conversationId: "conversation-1" }); },
      findOneAndUpdate() {
        return { lean: async () => ({ conversationId: "conversation-1", contactNumber: "9876543210" }) };
      },
    },
    "../../models/WhatsAppMessage": {
      async updateOne(filter, update) {
        messageUpdateCount += 1;
        messageUpdates.push({ filter, update });
        return messageUpdateCount === 1 ? { upsertedCount: 0 } : { modifiedCount: 1 };
      },
      findOne() {
        return {
          lean: async () => ({
            messageId: "message-1",
            conversationId: "conversation-1",
            employeeId: "",
            employeeName: "",
          }),
        };
      },
    },
    "../../models/Communication": {
      findOne() { return { lean: async () => null }; },
    },
    "../../models/Enquiry": {
      find() { return chainResult([]); },
      countDocuments() { return { maxTimeMS: async () => 0 }; },
    },
    "./communication-service": {},
    "../../utils/uuid": () => "generated-id",
    "../../utils/pagination": { cursorPaginate() {}, getPagination() { return { limit: 20, cursor: "" }; } },
  });

  const result = await inbox.recordOutbound({
    communicationId: "reply-1",
    providerMessageId: "provider-message-1",
    channel: "whatsapp",
    direction: "outbound",
    purpose: "whatsapp_inbox_reply",
    recipientContact: "9876543210",
    status: "accepted",
  }, { employeeId: "employee-1", name: "Dhiraj" });

  assert.equal(result.skipped, false);
  assert.deepEqual(messageUpdates[1].filter, { messageId: "message-1" });
  assert.equal(messageUpdates[1].update.$set.employeeId, "employee-1");
  assert.equal(messageUpdates[1].update.$set.employeeName, "Dhiraj");
});

test("WhatsApp inbox log errors redact phone numbers and credentials", () => {
  const inbox = service();
  const safe = inbox.safeLogMessage("duplicate +91 98765 43210 token=top-secret");
  assert.equal(safe.includes("98765"), false);
  assert.equal(safe.includes("top-secret"), false);
  assert.match(safe, /\[redacted-number\]/);
});
