"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const runtime = source("public/js/crm-ui-runtime.js");
const help = source("public/js/crm-context-help.js");

test("global CRM runtime loads contextual employee help", () => {
  assert.match(runtime, /crm-context-help\.js/);
  assert.match(runtime, /data-crm-context-help/);
});

test("context help covers the approved high-risk CRM actions", () => {
  const expectedLabels = [
    "Automatic nearby WhatsApp alerts",
    "Unlock capacity",
    "Marketplace",
    "Confirmed",
    "Sale conversion",
    "Send WhatsApp to selected",
    "WhatsApp",
    "Credits",
    "Copy lead link",
    "Credit balance",
    "Add credits",
    "Provider alert distance (km)",
    "Alert radius",
    "Default provider unlocks",
    "Unlock limit",
  ];
  expectedLabels.forEach((label) => assert.ok(help.includes(label), `Missing contextual help for ${label}`));
});

test("copy-link and WhatsApp guidance preserve the important business distinctions", () => {
  assert.match(help, /secure link for this provider and this lead only/);
  assert.match(help, /even after the normal provider unlock limit is reached/);
  assert.match(help, /Normal lead charges still apply/);
  assert.match(help, /does not reopen the marketplace for other providers/);
  assert.match(help, /Sending an alert does not count as a lead unlock/);
  assert.match(help, /does not deduct provider credits/);
});

test("credit and radius help explain side effects before employees act", () => {
  assert.match(help, /Immediately adds usable credits to this provider/);
  assert.match(help, /records the adjustment permanently/);
  assert.match(help, /Controls how far Findoly looks for eligible nearby providers/);
  assert.match(help, /can be overridden on an individual requirement/);
});

test("context help is keyboard accessible and supports Alpine-rendered content", () => {
  assert.match(help, /aria-expanded/);
  assert.match(help, /aria-controls/);
  assert.match(help, /event\.key === 'Escape'/);
  assert.match(help, /new MutationObserver\(scheduleScan\)/);
  assert.match(help, /requestAnimationFrame\(scan\)/);
});
