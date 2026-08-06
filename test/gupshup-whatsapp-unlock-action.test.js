"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const tokenService = require("../services/communication/whatsapp-action-token");
const renderer = require("../services/communication/template-renderer");

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

test("signed WhatsApp unlock tokens round-trip and reject tampering", () => {
  const previous = process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET;
  process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET = "a".repeat(64);
  try {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const token = tokenService.createUnlockAction({
      communicationId: "communication-1",
      now,
    });
    const decoded = tokenService.verifyUnlockAction(token, { now: new Date(now.getTime() + 1000) });
    assert.equal(decoded.communicationId, "communication-1");
    assert.ok(token.length < 256, "postback token should fit common button payload limits");
    assert.throws(() => tokenService.verifyUnlockAction(`${token.slice(0, -1)}x`, { now }), /signature/i);
  } finally {
    if (previous === undefined) delete process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET;
    else process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET = previous;
  }
});

test("template parameter override preserves the approved five-value order", () => {
  const values = renderer.templateParameterValues(
    { body: "Hello {{1}} Service {{2}} Location {{3}} Requirement {{4}}" },
    { 1: "Provider", 2: "Painter", 3: "Mumbai", 4: "Paint walls", 5: "https://provider.findoly.com/lead/1" },
    { override: ["Provider", "Painter", "Mumbai", "Paint walls", "https://provider.findoly.com/lead/1"] },
  );
  assert.deepEqual(values, ["Provider", "Painter", "Mumbai", "Paint walls", "https://provider.findoly.com/lead/1"]);
});

test("Gupshup delivery supports postbacks and session text replies", () => {
  const whatsapp = source("services/communication/whatsapp-service.js");
  assert.match(whatsapp, /postbackTexts/);
  assert.match(whatsapp, /\/wa\/api\/v1\/template\/msg/);
  assert.match(whatsapp, /\/wa\/api\/v1\/msg/);
  assert.match(whatsapp, /previewUrl/);
});

test("nearby lead alert keeps the 20 km boundary and attaches the unlock action", () => {
  const nearby = source("services/communication/nearby-lead-alert-service.js");
  const notification = source("services/communication/notification-service.js");
  assert.match(nearby, /MAX_ALERT_DISTANCE_KM = 20/);
  assert.match(nearby, /distanceKm > MAX_ALERT_DISTANCE_KM/);
  assert.match(nearby, /providerLeadUrl\(lead\.enquiryId\)/);
  assert.match(notification, /whatsappParameterMappings/);
  assert.match(notification, /templateParamsOverride:\s*rule\.whatsappParameterMappings\.map/);
  assert.match(notification, /type:\s*"unlock_lead"/);
});

test("webhook routes quick replies through the provider unlock processor", () => {
  const webhook = source("services/communication/webhook-service.js");
  const action = source("services/communication/provider-whatsapp-action-service.js");
  assert.match(webhook, /providerWhatsappActionService\.processInbound/);
  assert.match(action, /providerActionService\.unlockLead/);
  assert.match(action, /sendWhatsappSession/);
  assert.match(action, /phoneMatches/);
  assert.match(action, /tokenHash/);
});

test("production runtime requires all WhatsApp unlock integration secrets", () => {
  const runtime = source("utils/runtime-config.js");
  for (const key of [
    "CRM_PROVIDER_ACTION_API_URL",
    "CRM_PROVIDER_ACTION_API_TOKEN",
    "CRM_WHATSAPP_ACTION_SIGNING_SECRET",
    "CRM_GUPSHUP_API_KEY",
    "CRM_GUPSHUP_APP_ID",
    "CRM_GUPSHUP_APP_NAME",
    "CRM_GUPSHUP_SOURCE_NUMBER",
    "CRM_GUPSHUP_WEBHOOK_TOKEN",
  ]) assert.match(runtime, new RegExp(key));
});

test("nearby alert batching carries the exact computed distance into the notification", async () => {
  let deliveredContext = null;
  const provider = {
    providerId: "provider-1",
    name: "Nearby Provider",
    normalizedWhatsappNumber: "9876543210",
    serviceLatitude: 19.186,
    serviceLongitude: 72.849,
  };
  const service = loadWithStubs("services/communication/nearby-lead-alert-service.js", {
    "../../models/Provider": {
      find() {
        return {
          select() { return this; },
          lean() { return this; },
          cursor() {
            return {
              async *[Symbol.asyncIterator]() { yield provider; },
            };
          },
        };
      },
    },
    "./notification-service": {
      async triggerSafe(_event, context) {
        deliveredContext = context;
        return [{ communicationId: "communication-1" }];
      },
    },
  });
  const result = await service.dispatchNearbyLeadAlerts({
    enquiryId: "lead-1",
    categorySlug: "painter",
    remainingUnlocks: 3,
    locationLatitude: 19.186,
    locationLongitude: 72.849,
  });
  assert.equal(result.eligible, 1);
  assert.equal(result.alerted, 1);
  assert.equal(deliveredContext.distanceKm, 0);
  assert.equal(deliveredContext.leadUrl, "https://provider.findoly.com/lead/lead-1");
});

test("Gupshup v2 button payload variants are recognized without weakening signed-action validation", async () => {
  let rejectedInbound = null;
  const actionService = loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": {},
    "./communication-service": {
      async createInbound(input) { rejectedInbound = input; },
    },
    "../integration/provider-action-service": {},
  });
  const signedAction = "findoly_unlock_v1.payload.signature";
  const variants = [
    {
      label: "quick_reply",
      event: {
        type: "message",
        payload: {
          id: "inbound-1",
          source: "919867079691",
          type: "quick_reply",
          payload: { text: "Unlock Lead", postbackText: signedAction },
        },
      },
    },
    {
      label: "button_reply",
      event: {
        type: "message",
        payload: {
          id: "inbound-2",
          source: "919867079691",
          type: "button_reply",
          payload: { title: "Unlock Lead", postbackText: signedAction },
        },
      },
    },
    {
      label: "text with nested button type",
      event: {
        type: "message",
        payload: {
          id: "inbound-3",
          source: "919867079691",
          type: "text",
          payload: { text: "Unlock Lead", type: "button", postbackText: signedAction },
        },
      },
    },
    {
      label: "button",
      event: {
        type: "message",
        payload: {
          id: "inbound-4",
          source: "919867079691",
          type: "button",
          payload: { text: "Unlock Lead", postback_text: signedAction },
        },
      },
    },
  ];

  variants.forEach(({ label, event }) => {
    const details = actionService.quickReplyDetails(event);
    assert.equal(details.isQuickReply, true, `${label} should be recognized as a button reply`);
    assert.equal(details.postbackText, signedAction, `${label} should expose the signed postback`);
    assert.equal(details.visibleText, "Unlock Lead", `${label} should preserve the visible label`);
  });

  const unsigned = await actionService.processInbound({
    type: "message",
    payload: {
      id: "unsigned-button",
      source: "919867079691",
      type: "button_reply",
      payload: { title: "Unlock Lead" },
    },
  });
  assert.deepEqual(unsigned, { handled: true, status: "logged", reason: "missing_postback_action" });
  assert.equal(rejectedInbound.purpose, "whatsapp_button_reply");
  assert.equal(rejectedInbound.metadata.actionReason, "missing_postback_action");
});

test("unsigned Gupshup button replies are logged as inbound messages and never unlock", async () => {
  let inbound = null;
  const communicationStub = {
    async createInbound(input) { inbound = input; },
    async updateDeliveryStatus() { return { matched: 0 }; },
    async recordUnmatchedWhatsAppEvent() { return { communicationId: "audit-1" }; },
  };
  const actionService = loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": {},
    "./communication-service": communicationStub,
    "../integration/provider-action-service": {
      async unlockLead() {
        throw new Error("unsigned button must not reach unlock service");
      },
    },
  });
  const webhookService = loadWithStubs("services/communication/webhook-service.js", {
    "../../models/Communication": {},
    "./communication-service": communicationStub,
    "./whatsapp-service": {
      verifyWebhookToken() { return true; },
    },
    "./provider-whatsapp-action-service": actionService,
    "./template-service": {
      async processProviderEvent() { return { matched: 0, updated: 0 }; },
    },
  });
  const event = {
    app: "FindolyWhatsapp",
    version: 2,
    type: "message",
    payload: {
      id: "unsigned-button-logged",
      source: "919867079691",
      type: "button_reply",
      payload: { title: "Unlock Lead" },
      sender: { phone: "919867079691", name: "Test Provider" },
    },
  };
  const result = await webhookService.processWhatsApp(Buffer.from(JSON.stringify(event)), {});
  assert.equal(result.inboundMessages, 1);
  assert.equal(result.statusUpdates, 0);
  assert.equal(inbound.message, "Unlock Lead");
  assert.equal(inbound.providerMessageId, "unsigned-button-logged");
  assert.equal(inbound.purpose, "whatsapp_button_reply");
  assert.equal(inbound.metadata.actionReason, "missing_postback_action");
});

test("quick-reply webhook snapshots redact the signed postback action", () => {
  const actionService = loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": {},
    "./communication-service": {},
    "../integration/provider-action-service": {},
  });
  const token = "findoly_unlock_v1.payload.signature";
  const redacted = actionService.redactedEvent({
    type: "message",
    payload: { payload: { postbackText: token, nested: { copy: token } } },
  }, token);
  assert.equal(redacted.payload.payload.postbackText, "[REDACTED]");
  assert.equal(redacted.payload.payload.nested.copy, "[REDACTED]");
});

test("successful unlock state is preserved when only the WhatsApp response delivery fails", () => {
  const action = source("services/communication/provider-whatsapp-action-service.js");
  assert.match(action, /responseDeliveryFailed:\s*true/);
  assert.match(action, /_response_failed/);
  assert.doesNotMatch(action, /catch \(error\)[\s\S]{0,250}fallbackResult[\s\S]{0,800}providerActionService\.unlockLead/);
});

test("Gupshup HTTP requests use the approved template contract and session endpoint", async () => {
  const keys = [
    "CRM_GUPSHUP_API_KEY",
    "CRM_GUPSHUP_APP_NAME",
    "CRM_GUPSHUP_SOURCE_NUMBER",
    "CRM_GUPSHUP_API_BASE_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, {
    CRM_GUPSHUP_API_KEY: "test-api-key",
    CRM_GUPSHUP_APP_NAME: "FindolyWhatsapp",
    CRM_GUPSHUP_SOURCE_NUMBER: "917058313770",
    CRM_GUPSHUP_API_BASE_URL: "https://api.gupshup.io",
  });
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options, form: new URLSearchParams(options.body) });
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ status: "submitted", messageId: `message-${requests.length}` }); },
    };
  };
  try {
    const whatsapp = require("../services/communication/whatsapp-service");
    await whatsapp.sendTemplate({
      to: "9867079691",
      externalTemplateId: "836bbf22-3a63-4340-a98d-2fffdc7f3b32",
      templateParams: ["Dhiraj", "Painter", "Mumbai", "Paint walls", "https://provider.findoly.com/lead/lead-1"],
      postbackTexts: [{ index: 0, text: "findoly_unlock_v1.payload.signature" }],
    });
    await whatsapp.sendText({ to: "9867079691", text: "Lead unlocked successfully.", previewUrl: false });

    assert.equal(requests[0].url, "https://api.gupshup.io/wa/api/v1/template/msg");
    assert.equal(requests[0].options.headers.apikey, "test-api-key");
    assert.equal(requests[0].form.get("destination"), "919867079691");
    assert.deepEqual(JSON.parse(requests[0].form.get("template")).params, [
      "Dhiraj",
      "Painter",
      "Mumbai",
      "Paint walls",
      "https://provider.findoly.com/lead/lead-1",
    ]);
    assert.deepEqual(JSON.parse(requests[0].form.get("postbackTexts")), [
      { index: 0, text: "findoly_unlock_v1.payload.signature" },
    ]);
    assert.equal(requests[1].url, "https://api.gupshup.io/wa/api/v1/msg");
    assert.deepEqual(JSON.parse(requests[1].form.get("message")), {
      type: "text",
      text: "Lead unlocked successfully.",
      previewUrl: false,
    });
  } finally {
    global.fetch = previousFetch;
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});

