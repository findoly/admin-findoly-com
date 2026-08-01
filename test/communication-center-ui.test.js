"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Communication Center uses one accessible active navigation", () => {
  const navigation = read("views/communication/_navigation.ejs");
  const css = read("public/css/app.css");
  for (const label of ["Overview", "Message logs", "Templates", "Automation rules", "OTP activity", "Settings"]) {
    assert.match(navigation, new RegExp(label));
  }
  assert.match(navigation, /aria-current="page"/);
  assert.match(navigation, /crm-communication-nav-link/);
  assert.match(css, /\.crm-communication-nav-link\.is-active/);
  assert.match(css, /\.crm-communication-nav-link:focus-visible/);
  assert.match(css, /overflow-x:\s*auto/);

  const pages = [
    "index.ejs",
    "logs.ejs",
    "templates.ejs",
    "rules.ejs",
    "otp.ejs",
    "settings.ejs",
    "send.ejs",
    "template-form.ejs",
    "form.ejs",
  ];
  for (const page of pages) {
    assert.match(read(`views/communication/${page}`), /include\('_navigation'/, `${page} must use shared navigation`);
  }
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

test("Overview quick search and settings issue filter are available", () => {
  const overview = read("views/communication/index.ejs");
  const settings = read("views/communication/settings.ejs");
  assert.match(overview, /crm-communication-quick-search/);
  assert.match(overview, /openLogs\(\)/);
  assert.match(overview, /filteredRecent/);
  assert.match(settings, /Configuration issues only/);
  assert.match(settings, /showIssuesOnly/);
  assert.match(settings, /issueCount/);
});
