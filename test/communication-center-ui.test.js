"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Communication Center uses a clear permission-aware sidebar submenu", () => {
  const sidebar = read("views/partials/sidebar.ejs");
  const scripts = read("views/partials/scripts.ejs");
  const context = read("views/communication/_navigation.ejs");
  const css = read("public/css/app.css");

  for (const label of [
    "Overview",
    "Message logs",
    "Send message",
    "Manage templates",
    "Manage rules",
    "Channel management",
    "OTP activity",
  ]) {
    assert.match(sidebar, new RegExp(label));
  }
  assert.match(sidebar, /communicationMenuOpen/);
  assert.match(sidebar, /aria-controls="communicationCenterSubmenu"/);
  assert.match(sidebar, /communications\.send/);
  assert.match(sidebar, /communications\.manage/);
  assert.match(scripts, /communicationMenuOpen:\s*location\.pathname/);
  assert.match(context, /crm-communication-breadcrumb/);
  assert.match(context, /Communication Center/);
  assert.doesNotMatch(context, /crm-communication-nav-link/);
  assert.match(css, /\.crm-sidebar-submenu/);
  assert.match(css, /\.crm-communication-context/);
});

test("Communication lists provide consistent search filters and pagination", () => {
  const pages = {
    "views/communication/logs.ejs": ["Recipient type", "Purpose", "Rows"],
    "views/communication/templates.ejs": ["Category", "Language", "Active", "Rows"],
    "views/communication/rules.ejs": ["Recipient", "Channel", "Status", "Rows"],
    "views/communication/otp.ejs": ["Purpose", "From", "To", "Rows"],
  };
  for (const [file, labels] of Object.entries(pages)) {
    const source = read(file);
    assert.match(source, /crm-filter-bar/, `${file} must use shared filter bar`);
    assert.match(source, /crm-filter-actions/, `${file} must group actions`);
    assert.match(source, /crm-filter-page-size/, `${file} must expose rows selector`);
    assert.match(source, /createCursorPagination/, `${file} must paginate`);
    assert.match(source, /crm-table/, `${file} must use CRM table styling`);
    assert.match(source, /crm-table-footer/, `${file} must have pagination footer`);
    for (const label of labels) assert.match(source, new RegExp(label));
  }
});

test("Communication APIs expose filtered cursor pagination", () => {
  const templateService = read("services/communication/template-service.js");
  const ruleService = read("services/communication/rule-service.js");
  const otpService = read("services/communication/otp-service.js");
  const communicationService = read("services/communication/communication-service.js");
  const controller = read("controllers/communicationController.js");

  for (const source of [templateService, ruleService, otpService]) {
    assert.match(source, /cursorPaginate/);
    assert.match(source, /getPagination/);
  }
  assert.match(templateService, /source\.category/);
  assert.match(templateService, /source\.language/);
  assert.match(ruleService, /source\.recipientSource/);
  assert.match(ruleService, /source\.channel/);
  assert.match(otpService, /source\.purpose/);
  assert.match(otpService, /applyDateRange/);
  assert.match(communicationService, /source\.accountType/);
  assert.match(communicationService, /source\.purpose/);
  assert.match(controller, /pagination:\s*result\.pagination/);
});

test("Communication Center separates channel and automation management", () => {
  const overview = read("views/communication/index.ejs");
  const settings = read("views/communication/settings.ejs");
  const templates = read("views/communication/templates.ejs");
  const templateForm = read("views/communication/template-form.ejs");
  const rules = read("views/communication/rules.ejs");

  assert.match(overview, /crm-communication-start/);
  assert.match(overview, /id="slack-tools"/);
  for (const channel of ["WhatsApp", "Email", "Slack", "OTP", "Delivery &amp; retention"]) {
    assert.match(settings, new RegExp(channel));
  }
  assert.match(settings, /activeChannel/);
  assert.match(settings, /crm-channel-picker-card/);
  assert.match(templates, /WhatsApp templates/);
  assert.match(templates, /Email templates/);
  assert.match(templates, /queryValue\('channel'\)/);
  assert.match(templateForm, /selectChannel\('whatsapp'\)/);
  assert.match(templateForm, /selectChannel\('email'\)/);
  assert.match(rules, /Create automation rule/);
  assert.match(rules, /crm-rule-channel-grid/);
  assert.match(rules, /method:\s*this\.mode === 'create' \? 'POST' : 'PUT'/);
  assert.match(rules, /Enable only the channels needed/);
});
