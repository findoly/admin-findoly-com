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
  const enrichment = messageUpdates.find((entry) => entry.filter?.messageId === "message-1");
  assert.ok(enrichment);
  assert.equal(enrichment.update.$set.employeeId, "employee-1");
  assert.equal(enrichment.update.$set.employeeName, "Dhiraj");
});

test("message upserts do not place timestamp fields in setOnInsert", async () => {
  const updates = [];
  let messageExists = false;
  const inbox = loadWithStubs("services/communication/whatsapp-inbox-service.js", {
    "../../models/WhatsAppConversation": {
      findOne() { return chainResult({ conversationId: "conversation-1" }); },
      findOneAndUpdate() {
        return { lean: async () => ({ conversationId: "conversation-1", contactNumber: "9876543210" }) };
      },
      async updateOne() { return { modifiedCount: 1 }; },
    },
    "../../models/WhatsAppMessage": {
      findOne() {
        return { lean: async () => messageExists ? ({
          messageId: "message-1",
          conversationId: "conversation-1",
          communicationId: "communication-1",
          idempotencyKey: "outbound:provider:provider-1",
          direction: "outbound",
          messageType: "text",
          text: "Hello",
          status: "accepted",
          occurredAt: new Date(),
        }) : null };
      },
      async updateOne(filter, update, options) {
        updates.push({ filter, update, options });
        if (options?.upsert) messageExists = true;
        return options?.upsert ? { upsertedCount: 1 } : { modifiedCount: 1 };
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
    communicationId: "communication-1",
    providerMessageId: "provider-1",
    channel: "whatsapp",
    direction: "outbound",
    purpose: "whatsapp_inbox_reply",
    recipientContact: "9876543210",
    message: "Hello",
    status: "accepted",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.inserted, true);
  const upsert = updates.find((entry) => entry.options?.upsert);
  assert.ok(upsert);
  assert.equal(Object.hasOwn(upsert.update.$setOnInsert, "updatedAt"), false);
  assert.equal(Object.hasOwn(upsert.update.$setOnInsert, "createdAt"), false);
});

test("reply reports accepted delivery when inbox persistence needs retry", async () => {
  const now = new Date();
  const inbox = loadWithStubs("services/communication/whatsapp-inbox-service.js", {
    "../../models/WhatsAppConversation": {
      findOne() {
        return chainResult({
          conversationId: "conversation-1",
          contactNumber: "9876543210",
          displayName: "Customer",
          latestEnquiryId: "",
          status: "open",
        });
      },
      findOneAndUpdate() {
        return { lean: async () => ({ conversationId: "conversation-1", contactNumber: "9876543210" }) };
      },
      async updateOne() { return { modifiedCount: 1 }; },
    },
    "../../models/WhatsAppMessage": {
      findOne() { return { lean: async () => null }; },
      async updateOne() {
        const error = new Error("temporary MongoDB failure");
        error.code = "MONGO_TEMPORARY";
        throw error;
      },
    },
    "../../models/Communication": {
      findOne() { return { lean: async () => null }; },
    },
    "../../models/Enquiry": {
      find() { return chainResult([]); },
      countDocuments() { return { maxTimeMS: async () => 0 }; },
    },
    "./communication-service": {
      async sendWhatsappSession(input) {
        return {
          communicationId: "communication-1",
          providerMessageId: "provider-1",
          channel: "whatsapp",
          direction: "outbound",
          purpose: "whatsapp_inbox_reply",
          recipientContact: input.recipientContact,
          recipientName: input.recipientName,
          message: input.message,
          status: "accepted",
          sentAt: now,
          createdAt: now,
        };
      },
    },
    "../../utils/uuid": () => "generated-id",
    "../../utils/pagination": { cursorPaginate() {}, getPagination() { return { limit: 20, cursor: "" }; } },
  });

  const result = await inbox.reply("conversation-1", {
    message: "Hello",
    idempotencyKey: "client-key",
  }, { employeeId: "employee-1", name: "Dhiraj", email: "employee@example.com" });

  assert.equal(result.deliveryAccepted, true);
  assert.equal(result.inboxSyncStatus, "pending");
  assert.equal(result.message.text, "Hello");
  assert.equal(result.message.pendingPersistence, true);
  assert.equal(result.message.direction, "outbound");
});

test("WhatsApp inbox log errors redact phone numbers and credentials", () => {
  const inbox = service();
  const safe = inbox.safeLogMessage("duplicate +91 98765 43210 token=top-secret");
  assert.equal(safe.includes("98765"), false);
  assert.equal(safe.includes("top-secret"), false);
  assert.match(safe, /\[redacted-number\]/);
});

test("WhatsApp media uses a dedicated private S3 prefix without contact data", () => {
  const previousPrefix = process.env.AWS_S3_PRIVATE_PREFIX;
  process.env.AWS_S3_PRIVATE_PREFIX = "private/";
  try {
    const inbox = service();
    const fileName = inbox.safeMediaFileName("Customer quotation (final).pdf", "document", "application/pdf", "message-1");
    const key = inbox.privateMediaKey("conversation-1", "message-1", fileName);
    assert.equal(key, "private/whatsapp-inbox/conversation-1/message-1/Customer-quotation--final.pdf");
    assert.equal(key.includes("9876543210"), false);
  } finally {
    if (previousPrefix === undefined) delete process.env.AWS_S3_PRIVATE_PREFIX;
    else process.env.AWS_S3_PRIVATE_PREFIX = previousPrefix;
  }
});

test("WhatsApp media validation rejects unsafe browser content and accepts supported files", () => {
  const inbox = service();
  assert.equal(inbox.contentTypeAllowed("image", "image/jpeg", "photo.jpg"), true);
  assert.equal(inbox.contentTypeAllowed("document", "application/pdf", "quote.pdf"), true);
  assert.equal(inbox.contentTypeAllowed("document", "text/html", "page.html"), false);
  assert.equal(inbox.contentTypeAllowed("image", "image/svg+xml", "image.svg"), false);
});

test("WhatsApp media downloads enforce approved Gupshup hosts and size limits", async () => {
  const inbox = service();
  await assert.rejects(
    () => inbox.downloadMediaBuffer("https://example.com/file.pdf", 1024, async () => new Response("x")),
    (error) => error.code === "WHATSAPP_MEDIA_URL_NOT_ALLOWED",
  );
  const downloaded = await inbox.downloadMediaBuffer(
    "https://filemanager.gupshup.io/fm/wamedia/app/file-1",
    1024,
    async () => new Response(Buffer.from("pdf-data"), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": "8",
        "content-disposition": "attachment; filename=quotation.pdf",
      },
    }),
  );
  assert.equal(downloaded.contentType, "application/pdf");
  assert.equal(downloaded.fileName, "quotation.pdf");
  assert.equal(downloaded.buffer.toString(), "pdf-data");
});

test("WhatsApp message API presentation never exposes the private S3 key", () => {
  const inbox = service();
  const presented = inbox.presentMessage({
    messageId: "message-1",
    media: {
      storageStatus: "stored",
      s3Key: "private/whatsapp-inbox/conversation-1/message-1/file.pdf",
      fileName: "file.pdf",
    },
  });
  assert.equal(presented.media.available, true);
  assert.equal(Object.hasOwn(presented.media, "s3Key"), false);
});

test("S3 service uploads inbound WhatsApp media server-to-server under the private prefix", async () => {
  const names = ["AWS_REGION", "AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_S3_PRIVATE_PREFIX"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;
  let request = null;
  try {
    process.env.AWS_REGION = "ap-south-1";
    process.env.AWS_S3_BUCKET = "findoly-private-test";
    process.env.AWS_ACCESS_KEY_ID = "AKIATESTKEY";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.AWS_SESSION_TOKEN;
    process.env.AWS_S3_PRIVATE_PREFIX = "private/";
    global.fetch = async (url, options) => {
      request = { url: String(url), options };
      return new Response("", { status: 200, headers: { etag: '"etag-1"' } });
    };
    const modulePath = require.resolve(path.join(root, "services/storage/s3-service.js"));
    delete require.cache[modulePath];
    const storage = require(modulePath);
    const result = await storage.putObject({
      key: "private/whatsapp-inbox/conversation-1/message-1/quotation.pdf",
      body: Buffer.from("pdf-data"),
      contentType: "application/pdf",
    });
    assert.equal(result.sizeBytes, 8);
    assert.equal(result.etag, "etag-1");
    assert.equal(request.options.method, "PUT");
    assert.equal(request.options.headers["Content-Type"], "application/pdf");
    assert.match(request.options.headers.Authorization, /^AWS4-HMAC-SHA256 /);
    assert.equal(Buffer.from(request.options.body).toString(), "pdf-data");
  } finally {
    global.fetch = previousFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("inbound media storage downloads from Gupshup, uploads privately and marks the message stored", async () => {
  const previousFetch = global.fetch;
  const state = {
    messageId: "message-1",
    conversationId: "conversation-1",
    messageType: "document",
    media: { storageStatus: "pending", s3Key: "" },
  };
  let uploaded = null;
  try {
    global.fetch = async () => new Response(Buffer.from("pdf-data"), {
      status: 200,
      headers: { "content-type": "application/pdf", "content-length": "8" },
    });
    const inbox = loadWithStubs("services/communication/whatsapp-inbox-service.js", {
      "../../models/WhatsAppConversation": {},
      "../../models/WhatsAppMessage": {
        findOne() { return { lean: async () => ({ ...state, media: { ...state.media } }) }; },
        findOneAndUpdate(_query, update) {
          Object.entries(update.$set || {}).forEach(([key, value]) => {
            if (key.startsWith("media.")) state.media[key.slice(6)] = value;
            else state[key] = value;
          });
          return { lean: async () => ({ ...state, media: { ...state.media } }) };
        },
        async updateOne(_query, update) {
          Object.entries(update.$set || {}).forEach(([key, value]) => {
            if (key.startsWith("media.")) state.media[key.slice(6)] = value;
            else state[key] = value;
          });
          return { modifiedCount: 1 };
        },
      },
      "../../models/Communication": {},
      "../../models/Enquiry": {},
      "./communication-service": {},
      "../storage/s3-service": {
        config() { return { configured: true, privatePrefix: "private/", maxUploadBytes: 20 * 1024 * 1024 }; },
        async putObject(input) {
          uploaded = input;
          return { key: input.key, contentType: input.contentType, sizeBytes: input.body.length };
        },
      },
      "../../utils/uuid": () => "generated-id",
      "../../utils/pagination": { cursorPaginate() {}, getPagination() { return { limit: 20, cursor: "" }; } },
    });
    const result = await inbox.storeInboundMedia({
      messageId: "message-1",
      media: {
        messageType: "document",
        sourceUrl: "https://filemanager.gupshup.io/fm/wamedia/app/file-1",
        fileName: "quotation.pdf",
        contentType: "application/pdf",
        caption: "Quotation",
      },
    });
    assert.equal(result.stored, true);
    assert.equal(uploaded.key, "private/whatsapp-inbox/conversation-1/message-1/quotation.pdf");
    assert.equal(uploaded.body.toString(), "pdf-data");
    assert.equal(state.media.storageStatus, "stored");
    assert.equal(state.media.s3Key, uploaded.key);
  } finally {
    global.fetch = previousFetch;
  }
});
