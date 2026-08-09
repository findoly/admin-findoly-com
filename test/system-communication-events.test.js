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
  try { return require(absolute); } finally { Module._load = originalLoad; delete require.cache[absolute]; }
}

function service() {
  return loadWithStubs("services/communication/system-event-service.js", {
    "../../models/CommunicationRule": {},
    "../../models/CommunicationTemplate": {},
    "../../models/Enquiry": {},
    "../../models/ProviderLeadUnlock": {},
    "../../models/Provider": {},
    "../../models/Agent": {},
    "../../models/ProviderJoinRequest": {},
    "./communication-service": {},
    "./default-template-service": {},
  });
}

test("automatic internal events use email while provider confirmations remain email-only", () => {
  const systemEventService = service();
  for (const event of ["lead_created", "partner_lead_submitted", "agent_created", "provider_join_request_submitted", "provider_created"]) {
    assert.equal(systemEventService.INTERNAL_EMAIL_EVENTS.has(event), true);
  }
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("provider_lead_unlocked"), true);
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("provider_feedback_updated"), true);
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("lead_created"), false);
});

test("internal email variables include operational details without customer contact data", () => {
  const systemEventService = service();
  const variables = systemEventService.variablesFor({
    event: "partner_lead_submitted",
    eventAt: "2026-08-08T10:00:00.000Z",
    lead: {
      enquiryId: "lead-1",
      name: "Customer One",
      mobile: "9999999999",
      email: "customer@example.com",
      requirementTitle: "Paint a front door",
      category: "Painting",
      serviceTypes: [{ name: "Interior Painting" }],
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400064",
    },
    agent: { agentId: "partner-1", name: "Partner One", referralId: "REF123" },
  });
  assert.equal(variables.lead_id, "lead-1");
  assert.equal(variables.customer_name, "Customer One");
  assert.equal(variables.agent_name, "Partner One");
  assert.equal(variables.lead_location, "Mumbai, Maharashtra, 400064");
  assert.equal(Object.prototype.hasOwnProperty.call(variables, "customer_mobile"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(variables, "customer_email"), false);
});
