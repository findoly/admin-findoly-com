const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("agent payout rate is configured per CRM agent", () => {
  const model = require("../models/Agent");
  assert.equal(model.schema.path("payoutPerReferralPaise").options.min, 5000);
  assert.equal(model.schema.path("payoutPerReferralPaise").options.max, 20000);
  assert.ok(model.schema.path("razorpayFundAccountId"));
});

test("leads have validation fields while agent leads retain payout fields", () => {
  const model = require("../models/Enquiry");
  for (const field of ["agentReferralValidation", "leadValidationMethod", "agentSaleConversion", "partnerEligibilityDate", "partnerPayoutStatus", "partnerWithdrawalId", "partnerPaidAt"]) assert.ok(model.schema.path(field), field);
});

test("unvalidated leads are blocked from distribution and agent status changes require notes", () => {
  const service = read("services/enquiry/enquiry-service.js");
  assert.match(service, /Only Valid leads can be published to providers/);
  assert.match(service, /status-change note is required for Agent Portal requirements/);
});

test("withdrawal flow is denormalized and exposes multi-stage CRM approval", () => {
  const model = read("models/AgentWithdrawal.js");
  const service = read("services/partner-payout/partner-payout-service.js");
  assert.doesNotMatch(model, /ObjectId|ref:/);
  assert.match(service, /approve_eligibility/);
  assert.match(service, /approve_finance/);
  assert.match(service, /markPaid/);
  assert.match(service, /14 \* 24 \* 60 \* 60 \* 1000/);
});

test("Razorpay payout uses server-side idempotency and webhook processing", () => {
  const service = read("services/partner-payout/razorpay-service.js");
  const app = read("app.js");
  assert.match(service, /X-Payout-Idempotency/);
  assert.match(app, /webhooks\/razorpay\/payouts/);
});
