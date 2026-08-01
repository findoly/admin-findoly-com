"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("provider account creation has default email and WhatsApp templates", () => {
  const source = read("services/communication/default-template-service.js");
  assert.match(source, /findoly_provider_account_created_email/);
  assert.match(source, /findoly_provider_account_created/);
  assert.match(source, /Welcome to Findoly/);
  assert.match(source, /status:\s*"active"/);
  assert.match(source, /status:\s*"draft"/);
  assert.match(source, /support@findoly\.com/);
  assert.match(source, /provider_created/);
  assert.match(source, /emailTemplateId/);
  assert.match(source, /whatsappTemplateId/);
});

test("provider-created defaults are idempotently ensured before rules and templates are listed", () => {
  const notification = read("services/communication/notification-service.js");
  const controller = read("controllers/communicationController.js");
  assert.match(notification, /defaultTemplateService\.ensureDefaultProviderTemplates\(\)/);
  assert.match(notification, /Provider account created/);
  assert.match(controller, /listTemplates[\s\S]*ensureDefaultRules\(\)/);
  assert.match(controller, /listRules[\s\S]*ensureDefaultRules\(\)/);
});

test("provider creation dispatches once after successful persistence and maps template variables", () => {
  const provider = read("services/provider/provider-service.js");
  const notification = read("services/communication/notification-service.js");
  assert.match(provider, /Provider\.create\(data\)[\s\S]*dispatch\(\s*"provider_created"/);
  assert.match(notification, /values\["1"\]\s*=\s*provider\.name/);
  assert.match(notification, /values\["2"\]\s*=\s*provider\.providerId/);
  assert.match(notification, /values\["4"\][\s\S]*categorySlugs/);
  assert.match(notification, /values\["5"\]\s*=\s*values\.login_url/);
  assert.match(notification, /values\["6"\]\s*=\s*values\.support_email/);
});

test("Provider-created rule is visible and exposes provider variables", () => {
  const rules = read("views/communication/rules.ejs");
  assert.match(rules, /provider_created/);
  assert.match(rules, /Provider created rule/);
  for (const variable of ["provider_name", "provider_id", "business_name", "service_categories", "login_url", "support_email"]) {
    assert.match(rules, new RegExp(variable));
  }
});
