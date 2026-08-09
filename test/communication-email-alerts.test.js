"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("active Slack integration is removed while historical Slack records remain readable", () => {
  assert.equal(fs.existsSync(path.join(root, "services/communication/slack-service.js")), false);
  const routes = read("routes/communication.js");
  const gateway = read("services/communication/message-gateway.js");
  const config = read("services/communication/communication-config.js");
  const communicationModel = read("models/Communication.js");
  assert.doesNotMatch(routes, /slack/);
  assert.doesNotMatch(gateway, /slack/i);
  assert.doesNotMatch(config, /slack/i);
  assert.match(communicationModel, /"slack"/); // historical audit rows are preserved
});

test("internal alert templates and rules cover all approved operational events", () => {
  const defaults = read("services/communication/default-template-service.js");
  const system = read("services/communication/system-event-service.js");
  for (const event of ["lead_created", "partner_lead_submitted", "agent_created", "provider_join_request_submitted", "provider_created"]) {
    assert.match(defaults, new RegExp(event));
    assert.match(system, new RegExp(event));
  }
  assert.match(system, /purpose: options\.test \? "internal_email_alert_test" : "internal_email_alert"/);
  assert.match(system, /idempotencyKey/);
});

test("Slack rule cleanup migration preserves rules and clears only legacy Slack fields", () => {
  const migration = read("scripts/remove-slack-rules.js");
  assert.match(migration, /--dry-run/);
  assert.match(migration, /LEGACY_FIELDS/);
  assert.match(migration, /"slackEnabled"/);
  assert.match(migration, /"slackChannelId"/);
  assert.match(migration, /"slackChannelName"/);
  assert.match(migration, /"slackMessage"/);
  assert.match(migration, /\$unset: unset/);
  assert.doesNotMatch(migration, /deleteMany/);
});


test("new manual communication records are restricted to WhatsApp and email", () => {
  const service = read("services/communication/communication-service.js");
  const form = read("views/communication/form.ejs");
  assert.match(service, /ACTIVE_COMMUNICATION_CHANNELS = Object\.freeze\(\["whatsapp", "email"\]\)/);
  assert.match(service, /enumValue\(requestedChannel, ACTIVE_COMMUNICATION_CHANNELS/);
  assert.doesNotMatch(form, /<option>call<\/option>/);
  assert.doesNotMatch(form, /<option>sms<\/option>/);
});
