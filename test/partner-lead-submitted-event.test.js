"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

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


function notificationService() {
  return loadWithStubs("services/communication/notification-service.js", {
    "../../models/CommunicationRule": {},
    "../../models/CommunicationTemplate": {},
    "./communication-service": {},
    "./system-event-service": {},
    "./template-renderer": { renderText(value) { return value; } },
    "./default-template-service": {},
  });
}

test("Partner lead event is available as a Communication Center rule", () => {
  const notification = notificationService();
  const ruleService = loadWithStubs("services/communication/rule-service.js", {
    "../../models/CommunicationRule": {},
    "../../models/CommunicationTemplate": {},
    "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, cursorPaginate: async () => ({ data: [], pagination: {} }) },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
    "./slack-service": { normalizeChannelId(value) { return String(value || ""); } },
  });
  assert.ok(ruleService.EVENTS.includes("partner_lead_submitted"));
  const row = notification.DEFAULT_RULES.find((item) => item[1] === "partner_lead_submitted");
  assert.ok(row);
  assert.equal(row[3], "manual");
  assert.match(row[4], /New Partner Lead Submitted/);
});

test("Partner lead event exposes Slack message variables", () => {
  const notification = notificationService();
  const variables = notification.variablesFor({
    trigger: "partner_lead_submitted",
    lead: {
      enquiryId: "lead-1",
      name: "Customer One",
      category: "Painting",
      serviceType: "Interior Painting",
      serviceTypes: [{ name: "Interior Painting" }],
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400064",
      requirementTitle: "Paint a two bedroom flat",
      agentId: "agent-1",
      agentName: "Partner One",
      referralId: "REF123",
    },
    agent: { agentId: "agent-1", name: "Partner One", referralId: "REF123" },
  });
  assert.equal(variables.agent_name, "Partner One");
  assert.equal(variables.lead_id, "lead-1");
  assert.equal(variables.customer_name, "Customer One");
  assert.equal(variables.service_types, "Interior Painting");
  assert.equal(variables.lead_location, "Mumbai, Maharashtra, 400064");
  assert.equal(variables.referral_id, "REF123");
});

test("Partner lead rule is enforced as internal Slack only", async () => {
  const ruleService = loadWithStubs("services/communication/rule-service.js", {
    "../../models/CommunicationRule": {},
    "../../models/CommunicationTemplate": {},
    "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, cursorPaginate: async () => ({ data: [], pagination: {} }) },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
    "./slack-service": { normalizeChannelId(value) { return String(value || ""); } },
  });
  const normalized = await ruleService.normalizeInput({
    name: "Partner lead submitted",
    event: "partner_lead_submitted",
    enabled: true,
    whatsappEnabled: true,
    emailEnabled: true,
    slackEnabled: true,
    slackChannelId: "C123456789",
    slackChannelName: "sales-alerts",
    slackMessage: "Lead {{lead_id}} from {{agent_name}}",
    recipientSource: "agent",
  }, {});
  assert.equal(normalized.whatsappEnabled, false);
  assert.equal(normalized.emailEnabled, false);
  assert.equal(normalized.slackEnabled, true);
  assert.equal(normalized.recipientSource, "manual");
});

test("Integration endpoint treats Partner lead events as rule-managed and idempotent", () => {
  const controller = source("controllers/communicationController.js");
  assert.match(controller, /normalizedIntegrationEvent === "partner_lead_submitted"/);
  assert.match(controller, /const channelDeliveries = normalizedIntegrationEvent === "partner_lead_submitted"\s*\? \[\]/);
  assert.match(controller, /sourcePortal = normalizedIntegrationEvent === "partner_lead_submitted" \? "partner-portal"/);
  assert.match(controller, /integrationEventId/);
  assert.match(controller, /enquiryId/);
  const rulesView = source("views/communication/rules.ejs");
  assert.match(rulesView, /internal Slack-only event/);
  assert.match(rulesView, /partner_lead_submitted/);
});


test("Partner integration event returns acknowledgement and triggers only the configured rule", async () => {
  let systemDispatches = 0;
  const notifications = [];
  const controller = loadWithStubs("controllers/communicationController.js", {
    "../models/Communication": {},
    "../models/CommunicationTemplate": {},
    "../models/CommunicationRule": {},
    "../models/OtpRequest": {},
    "../models/Enquiry": {
      findOne() {
        return {
          async lean() {
            return {
              enquiryId: "lead-1",
              name: "Customer One",
              agentId: "agent-1",
              agentName: "Partner One",
              referralId: "REF123",
              sourceChannel: "agent",
              sourceWebsite: "agent-portal",
            };
          },
        };
      },
    },
    "../services/communication/communication-service": {},
    "../services/communication/template-service": {},
    "../services/communication/rule-service": {},
    "../services/communication/otp-service": {},
    "../services/communication/notification-service": {
      async trigger(event, context) {
        notifications.push({ event, context });
        return [{ channel: "slack", status: "sent" }];
      },
    },
    "../services/communication/system-event-service": {
      async dispatch() { systemDispatches += 1; return []; },
    },
    "../services/communication/webhook-service": {},
    "../services/communication/slack-service": {},
    "../services/communication/communication-config": { configurationStatus() { return {}; } },
    "../services/provider-unlock/provider-status-service": {
      providerStatusFromEvent() { return ""; },
      providerOutcomeFromEvent() { return ""; },
    },
  });

  const req = {
    params: { event: "partner_lead_submitted" },
    body: {
      integrationEventId: "event-1",
      enquiryId: "lead-1",
      agent: { agentId: "agent-1", name: "Partner One", referralId: "REF123" },
    },
  };
  let responseBody = null;
  const res = { json(value) { responseBody = value; return value; } };
  await controller.integrationEvent(req, res, (error) => { throw error; });

  assert.equal(systemDispatches, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].event, "partner_lead_submitted");
  assert.equal(notifications[0].context.source, "partner-portal");
  assert.equal(responseBody.data.acknowledgement.accepted, true);
  assert.equal(responseBody.data.acknowledgement.integrationEventId, "event-1");
  assert.equal(responseBody.data.acknowledgement.enquiryId, "lead-1");
});
