"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Communication Center sidebar exposes only WhatsApp, Email and OTP management", () => {
  const sidebar = read("views/partials/sidebar.ejs");
  assert.match(sidebar, /href="\/communications\/whatsapp"/);
  assert.match(sidebar, /href="\/communications\/email"/);
  assert.match(sidebar, /href="\/communications\/otp"/);
  assert.match(sidebar, />WhatsApp</);
  assert.match(sidebar, />Email</);
  assert.match(sidebar, />OTP activity</);
  assert.doesNotMatch(sidebar, /Channel management/);
  assert.doesNotMatch(sidebar, /Manage rules/);
});

test("WhatsApp and Email have separate focused navigation and pages", () => {
  const routes = read("routes/frontend.js");
  const navigation = read("views/communication/_navigation.ejs");
  const home = read("views/communication/channel-home.ejs");
  assert.match(routes, /\/communications\/whatsapp\/templates/);
  assert.match(routes, /\/communications\/whatsapp\/automations/);
  assert.match(routes, /\/communications\/whatsapp\/logs/);
  assert.match(routes, /\/communications\/email\/internal-alerts/);
  assert.match(routes, /\/communications\/email\/templates/);
  assert.match(routes, /\/communications\/email\/automations/);
  assert.match(routes, /\/communications\/email\/logs/);
  assert.match(navigation, /Internal alerts/);
  assert.match(navigation, /Open Inbox/);
  assert.match(home, /Amazon SES/);
  assert.match(home, /Gupshup/);
});

test("channel lists remain searchable and cursor paginated", () => {
  for (const file of ["views/communication/logs.ejs", "views/communication/templates.ejs", "views/communication/rules.ejs"]) {
    const page = read(file);
    assert.match(page, /crm-filter-bar/);
    assert.match(page, /createCursorPagination/);
    assert.match(page, /crm-table/);
    assert.match(page, /crm-table-footer/);
  }
});

test("internal email alert page exposes fixed recipient, templates, status, tests and logs", () => {
  const page = read("views/communication/internal-alerts.ejs");
  for (const label of ["CRM lead created", "Partner lead submitted", "Partner account created", "Provider joining request submitted", "Provider account created"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /alert@findoly\.com/);
  assert.match(page, /emailTemplateId/);
  assert.match(page, /Send test/);
  assert.match(page, /internal_email_alert/);
  assert.doesNotMatch(page, /Slack/);
});


test("legacy communication search redirects into the selected focused channel", () => {
  const routes = read("routes/frontend.js");
  assert.match(routes, /\/search\/communications/);
  assert.match(routes, /`\/communications\/\$\{channel\}\/logs\$\{suffix\}`/);
  assert.doesNotMatch(routes, /search\/communications[^\n]+page\.communicationLogs/);
});
