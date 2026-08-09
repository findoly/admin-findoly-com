"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Partner lead is an automatic internal SES email event", () => {
  const system = source("services/communication/system-event-service.js");
  const defaults = source("services/communication/default-template-service.js");
  assert.match(system, /"partner_lead_submitted"/);
  assert.match(system, /INTERNAL_EMAIL_EVENTS/);
  assert.match(system, /INTERNAL_ALERT_EMAIL \|\| "alert@findoly\.com"/);
  assert.match(defaults, /findoly_internal_partner_lead_submitted/);
  assert.match(defaults, /\[Findoly Alert\] New Partner lead/);
});

test("Partner integration event returns a stable acknowledgement and dispatches through system email", () => {
  const controller = source("controllers/communicationController.js");
  assert.match(controller, /normalizedIntegrationEvent === "partner_lead_submitted"/);
  assert.match(controller, /partner_lead_event_received/);
  assert.match(controller, /const channelDeliveries = await systemEventService\.dispatch/);
  assert.match(controller, /integrationEventId/);
  assert.match(controller, /enquiryId/);
  assert.doesNotMatch(controller, /suppressRuleSlack/);
});

test("Communication Center separates internal Partner alert from customer automations", () => {
  const internalAlerts = source("views/communication/internal-alerts.ejs");
  const rules = source("views/communication/rules.ejs");
  assert.match(internalAlerts, /Partner lead submitted/);
  assert.match(internalAlerts, /alert@findoly\.com/);
  assert.match(internalAlerts, /partner_lead_submitted/);
  assert.match(rules, /!\['partner_lead_submitted','provider_join_request_submitted'\]\.includes/);
  assert.doesNotMatch(rules, /Slack/);
});
