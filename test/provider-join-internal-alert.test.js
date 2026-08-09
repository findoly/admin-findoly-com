"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Provider joining request is accepted as a protected integration event", () => {
  const controller = read("controllers/communicationController.js");
  assert.match(controller, /normalizedEvent === "provider_join_request_submitted"/);
  assert.match(controller, /providerJoinRequestId/);
  assert.match(controller, /provider_join_request_event_received/);
  assert.match(controller, /systemEventService\.dispatch/);
});

test("Provider joining request has a system-managed SES template and internal rule", () => {
  const defaults = read("services/communication/default-template-service.js");
  const system = read("services/communication/system-event-service.js");
  assert.match(defaults, /findoly_internal_provider_join_request_submitted/);
  assert.match(defaults, /Provider joining request submitted/);
  assert.match(system, /ProviderJoinRequest/);
  assert.match(system, /provider_join_request_submitted/);
  assert.match(system, /provider_join_request_id/);
});
