"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function loadService({ sendResult, retryResult, sendError, retryError } = {}) {
  const absolute = require.resolve(path.join(root, "services/communication/system-event-service.js"));
  delete require.cache[absolute];
  const calls = { send: 0, retry: 0 };
  const communicationService = {
    async send() {
      calls.send += 1;
      if (sendError) throw sendError;
      return sendResult || { communicationId: "comm-1", status: "accepted" };
    },
    async retry() {
      calls.retry += 1;
      if (retryError) throw retryError;
      return retryResult || { communicationId: "comm-2", status: "accepted" };
    },
  };
  const stubs = {
    "../../models/CommunicationRule": {
      findOne() {
        return { lean: async () => ({ ruleId: "rule-1", enabled: true, emailEnabled: true, emailTemplateId: "template-1" }) };
      },
    },
    "../../models/CommunicationTemplate": {
      async updateOne() { return { acknowledged: true }; },
      findOne() {
        return { lean: async () => ({ templateId: "provider-email-template" }) };
      },
    },
    "../../models/Enquiry": {},
    "../../models/ProviderLeadUnlock": {},
    "../../models/Provider": {},
    "../../models/Agent": {},
    "../../models/ProviderJoinRequest": {},
    "./communication-service": communicationService,
    "./default-template-service": { ensureInternalAlertTemplatesAndRules: async () => [] },
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const service = require(absolute);
    service.__testCalls = calls;
    return service;
  } finally {
    Module._load = originalLoad;
    delete require.cache[absolute];
  }
}

function context() {
  return {
    event: "partner_lead_submitted",
    enquiryId: "lead-1",
    source: "partner-portal",
    eventAt: "2026-08-09T00:00:00.000Z",
    lead: { enquiryId: "lead-1", name: "Customer", requirementTitle: "Requirement" },
    agent: { agentId: "partner-1", name: "Partner" },
  };
}

test("internal SES alert returns an accepted communication", async () => {
  const previous = process.env.INTERNAL_ALERT_EMAIL;
  process.env.INTERNAL_ALERT_EMAIL = "alert@findoly.com";
  try {
    const service = loadService();
    const result = await service.sendInternalEmail(
      "partner_lead_submitted",
      context(),
      service.variablesFor(context()),
      "integration-api",
    );
    assert.equal(result.status, "accepted");
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_ALERT_EMAIL;
    else process.env.INTERNAL_ALERT_EMAIL = previous;
  }
});

test("internal SES alert throws after both immediate attempts remain failed", async () => {
  const service = loadService({
    sendResult: { communicationId: "comm-1", status: "failed", failureReason: "SES unavailable" },
    retryResult: { communicationId: "comm-2", status: "failed", failureReason: "SES unavailable" },
  });
  await assert.rejects(
    () => service.sendInternalEmail(
      "partner_lead_submitted",
      context(),
      service.variablesFor(context()),
      "integration-api",
    ),
    (error) => error && error.code === "INTERNAL_EMAIL_DELIVERY_FAILED" && error.status === 503,
  );
});


function providerAssignmentContext(email = "provider@example.com") {
  return {
    event: "provider_lead_assigned",
    providerLeadUnlockId: "unlock-1",
    enquiryId: "lead-1",
    providerId: "provider-1",
    eventAt: "2026-10-03T00:00:00.000Z",
    source: "crm_manual_assignment",
    leadUrl: "https://provider.findoly.com/leads/lead-1",
    creditsUsed: 10,
    unlock: {
      providerLeadUnlockId: "unlock-1",
      enquiryId: "lead-1",
      providerId: "provider-1",
      unlockedAt: "2026-10-03T00:00:00.000Z",
      chargedCredits: 10,
    },
    lead: {
      enquiryId: "lead-1",
      requirementTitle: "AC repair",
      category: "AC Repair",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    },
    provider: {
      providerId: "provider-1",
      name: "Provider",
      businessName: "Provider Business",
      email,
    },
  };
}

test("provider assignment email reports sent without retry when SES succeeds", async () => {
  const service = loadService({
    sendResult: { communicationId: "comm-1", status: "sent" },
  });
  const result = await service.dispatch(
    "provider_lead_assigned",
    providerAssignmentContext(),
    "ops@findoly.com",
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].deliveryState, "sent");
  assert.equal(result[0].success, true);
  assert.equal(service.__testCalls.send, 1);
  assert.equal(service.__testCalls.retry, 0);
});

test("provider assignment email reports skipped separately when provider email is unavailable", async () => {
  const service = loadService();
  const result = await service.dispatch(
    "provider_lead_assigned",
    providerAssignmentContext(""),
    "ops@findoly.com",
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].deliveryState, "skipped");
  assert.equal(result[0].skipped, true);
  assert.equal(result[0].success, false);
  assert.match(result[0].reason, /email is not available/i);
  assert.equal(service.__testCalls.send, 0);
  assert.equal(service.__testCalls.retry, 0);
});

test("provider assignment email retries a persisted immediate failure exactly once", async () => {
  const sendError = Object.assign(new Error("SES unavailable"), {
    communicationId: "failed-comm-1",
  });
  const service = loadService({
    sendError,
    retryResult: { communicationId: "retry-comm-1", status: "sent" },
  });
  const result = await service.dispatch(
    "provider_lead_assigned",
    providerAssignmentContext(),
    "ops@findoly.com",
  );

  assert.equal(result[0].deliveryState, "sent");
  assert.equal(result[0].communicationId, "retry-comm-1");
  assert.equal(service.__testCalls.send, 1);
  assert.equal(service.__testCalls.retry, 1);
});

test("provider assignment email retries a returned failed communication exactly once", async () => {
  const service = loadService({
    sendResult: { communicationId: "failed-comm-1", status: "failed", failureReason: "SES unavailable" },
    retryResult: { communicationId: "retry-comm-1", status: "sent" },
  });
  const result = await service.dispatch(
    "provider_lead_assigned",
    providerAssignmentContext(),
    "ops@findoly.com",
  );

  assert.equal(result[0].deliveryState, "sent");
  assert.equal(result[0].communicationId, "retry-comm-1");
  assert.equal(service.__testCalls.retry, 1);
});

test("provider assignment remains a delivery failure after one unsuccessful automatic retry", async () => {
  const service = loadService({
    sendResult: { communicationId: "failed-comm-1", status: "failed", failureReason: "SES unavailable" },
    retryResult: { communicationId: "failed-comm-2", status: "failed", failureReason: "SES unavailable" },
  });
  const result = await service.dispatch(
    "provider_lead_assigned",
    providerAssignmentContext(),
    "ops@findoly.com",
  );

  assert.equal(result[0].deliveryState, "failed");
  assert.equal(result[0].success, false);
  assert.equal(result[0].communicationId, "failed-comm-2");
  assert.match(result[0].error, /SES unavailable/);
  assert.equal(service.__testCalls.retry, 1);
});
