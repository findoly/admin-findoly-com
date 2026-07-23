const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("manual provider credits use a dedicated permission and API action", () => {
  const permissions = source("utils/permissions.js");
  const routes = source("routes/provider.js");
  const controller = source("controllers/providerController.js");

  assert.match(permissions, /provider_credits\.add/);
  assert.match(routes, /\/:providerId\/credits/);
  assert.match(routes, /requirePermission\("provider_credits\.add"\)/);
  assert.match(controller, /module\.exports\.addCredits\s*=\s*async function/);
});

test("manual credits are atomic, idempotent and allocation-backed", () => {
  const service = source("services/provider/provider-credit-service.js");
  const allocationModel = source("models/CreditAllocation.js");

  assert.match(service, /withTransaction/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /crm_manual_credit/);
  assert.match(service, /CreditAllocation\.create/);
  assert.match(service, /WalletTransaction\.create/);
  assert.match(service, /\$inc:\s*\{\s*walletBalancePaise/);
  assert.match(allocationModel, /collection:\s*"creditallocations"/);
});

test("provider CRM page has the add-credit form and credit-based display", () => {
  const view = source("views/provider/show.ejs");
  const list = source("views/provider/index.ejs");

  assert.match(view, /Add provider credits/);
  assert.match(view, /Goodwill gesture/);
  assert.match(view, /Internal note/);
  assert.match(view, /Confirm and add credits/);
  assert.match(view, /credits\(provider\.walletBalancePaise\)/);
  assert.match(list, /Available balance/);
  assert.doesNotMatch(list, /INR balance/);
});

test("credit conversion keeps two decimal credit precision", () => {
  const { creditsFromPaise, paiseFromCredits } = require("../utils/credits");
  assert.equal(paiseFromCredits(10), 1000);
  assert.equal(paiseFromCredits(10.25), 1025);
  assert.equal(creditsFromPaise(1025), 10.25);
});
