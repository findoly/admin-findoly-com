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

function controllerHarness() {
  let dispatchCalls = 0;
  let notificationCalls = 0;
  const controller = compile("controllers/communicationController.js", {
    "../models/Communication": {},
    "../models/CommunicationTemplate": {},
    "../models/CommunicationRule": {},
    "../models/OtpRequest": {},
    "../models/Enquiry": { findOne() { return { async lean() { return null; } }; } },
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
    "../services/communication/communication-config": { configurationStatus: () => ({}) },
    "../services/provider-unlock/provider-status-service": {
      providerStatusFromEvent: () => "",
      providerOutcomeFromEvent: () => "",
    },
  });
  return { controller, counts: () => ({ dispatchCalls, notificationCalls }) };
}

test("CRM returns a schema-valid acknowledgement for Provider outbox events", async () => {
  const { controller } = controllerHarness();
  let body;
  await controller.integrationEvent({
    params: { event: "provider_lead_unlocked" },
    body: {
      integrationEventId: "event-1",
      integrationEventSequence: 1,
      providerLeadUnlockId: "unlock-1",
      lead: { enquiryId: "lead-1" },
    },
  }, { json(value) { body = value; return value; } }, (error) => { throw error; });

  assert.equal(body.success, true);
  assert.deepEqual(body.data.acknowledgement, {
    accepted: true,
    eventName: "provider_lead_unlocked",
    integrationEventId: "event-1",
    providerLeadUnlockId: "unlock-1",
    integrationEventSequence: 1,
    stale: false,
  });
});

test("CRM rejects malformed Provider event identity before side effects", async () => {
  const { controller, counts } = controllerHarness();
  let captured;
  await controller.integrationEvent({
    params: { event: "provider_lead_unlocked" },
    body: {
      integrationEventId: "event-1",
      integrationEventSequence: "1",
      providerLeadUnlockId: "unlock-1",
      lead: { enquiryId: "lead-1" },
    },
  }, { json() { assert.fail("must not respond success"); } }, (error) => { captured = error; });
  assert.equal(captured?.status, 400);
  assert.deepEqual(counts(), { dispatchCalls: 0, notificationCalls: 0 });
});

test("Non-Provider integration events keep their existing no-outbox-ID contract", async () => {
  const { controller } = controllerHarness();
  let body;
  await controller.integrationEvent(
    { params: { event: "agent_created" }, body: {} },
    { json(value) { body = value; return value; } },
    (error) => { throw error; },
  );
  assert.equal(body.success, true);
  assert.equal(Object.hasOwn(body.data, "acknowledgement"), false);
});

test("CRM production startup requires the shared Provider communication token", () => {
  const { validateRuntimeConfig } = require("../utils/runtime-config");
  const baseline = {
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost/findoly_prod",
    AUTH_COOKIE_SECRET: "s".repeat(40),
    CORS_ORIGINS: "https://admin.findoly.com",
    CRM_ADMIN_ORIGIN: "https://admin.findoly.com",
    PUBLIC_INTAKE_API_TOKEN: "p".repeat(40),
  };
  const missing = validateRuntimeConfig(baseline);
  assert.ok(missing.errors.some((message) => /COMMUNICATION_EVENT_API_TOKEN is required/.test(message)));
  const configured = validateRuntimeConfig({ ...baseline, COMMUNICATION_EVENT_API_TOKEN: "e".repeat(40) });
  assert.equal(configured.errors.some((message) => /COMMUNICATION_EVENT_API_TOKEN/.test(message)), false);
});
