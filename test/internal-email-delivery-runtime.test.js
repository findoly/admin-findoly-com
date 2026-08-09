"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function loadService({ sendResult, retryResult, sendError } = {}) {
  const absolute = require.resolve(path.join(root, "services/communication/system-event-service.js"));
  delete require.cache[absolute];
  const communicationService = {
    async send() {
      if (sendError) throw sendError;
      return sendResult || { communicationId: "comm-1", status: "accepted" };
    },
    async retry() {
      return retryResult || { communicationId: "comm-2", status: "accepted" };
    },
  };
  const stubs = {
    "../../models/CommunicationRule": {
      findOne() {
        return { lean: async () => ({ ruleId: "rule-1", enabled: true, emailEnabled: true, emailTemplateId: "template-1" }) };
      },
    },
    "../../models/CommunicationTemplate": {},
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
    return require(absolute);
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
