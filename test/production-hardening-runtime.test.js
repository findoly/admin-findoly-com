"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("India date helpers reject calendar overflow and preserve IST date-only values", () => {
  const {
    parseIndiaDateOnly,
    parseIndiaDateTime,
    formatIndiaDateOnly,
  } = require("../utils/india-datetime");
  assert.equal(parseIndiaDateOnly("2026-02-29"), null);
  assert.equal(parseIndiaDateTime("2026-02-31T10:30"), null);
  assert.equal(parseIndiaDateTime("2026-08-01T14:30").toISOString(), "2026-08-01T09:00:00.000Z");
  assert.equal(formatIndiaDateOnly(parseIndiaDateOnly("2026-08-01")), "2026-08-01");
});

test("contact normalization uses one phone namespace for mobile and WhatsApp", () => {
  const { contactEntries, normalizeEmail, normalizePhone } = require("../utils/contact-normalization");
  assert.equal(normalizePhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizeEmail(" USER@Example.COM "), "user@example.com");
  assert.deepEqual(contactEntries({
    mobile: "9876543210",
    whatsappNumber: "+91 98765 43210",
    email: "USER@example.com",
  }), [
    { key: "phone:9876543210", kind: "phone", value: "9876543210", field: "mobile" },
    { key: "email:user@example.com", kind: "email", value: "user@example.com", field: "email" },
  ]);
});

test("request IDs accept bounded safe values and replace malformed input", () => {
  const { requestIdMiddleware } = require("../middleware/request-id");
  const response = { headers: {}, set(name, value) { this.headers[name] = value; } };
  const accepted = { get: () => "crm-request_123" };
  requestIdMiddleware(accepted, response, () => {});
  assert.equal(accepted.requestId, "crm-request_123");
  assert.equal(response.headers["X-Request-Id"], "crm-request_123");

  const rejected = { get: () => "bad request\nheader" };
  requestIdMiddleware(rejected, response, () => {});
  assert.match(rejected.requestId, /^[0-9a-f-]{36}$/);
});

test("runtime configuration rejects invalid pool and rate-limit settings", () => {
  const { validateRuntimeConfig } = require("../utils/runtime-config");
  const result = validateRuntimeConfig({
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost/findoly_prod",
    AUTH_COOKIE_SECRET: "x".repeat(40),
    CORS_ORIGINS: "https://admin.findoly.com",
    CRM_ADMIN_ORIGIN: "https://admin.findoly.com",
    PUBLIC_INTAKE_API_TOKEN: "p".repeat(40),
    MONGO_MIN_POOL_SIZE: "40",
    MONGO_MAX_POOL_SIZE: "20",
    CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR: "0",
  });
  assert.ok(result.errors.some((message) => /MONGO_MIN_POOL_SIZE cannot be greater/.test(message)));
  assert.ok(result.errors.some((message) => /CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR/.test(message)));
});

test("OTP verification is protected by a separate network rate-limit bucket", () => {
  const controller = read("controllers/authController.js");
  const rateLimit = read("services/access/otp-rate-limit-service.js");
  assert.match(controller, /claimIpVerifySlot\(requestAddress\(req\)\)/);
  assert.match(rateLimit, /scope:\s*"verify"/);
  assert.match(rateLimit, /CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR/);
});

test("cross-entity contact ownership excludes a provider's converted source request", () => {
  const service = read("services/contact-identity/contact-identity-service.js");
  assert.match(service, /status:\s*"converted", convertedProviderId: entityId/);
  assert.match(service, /CONTACT_ALREADY_EXISTS/);
  assert.match(read("models/ContactIdentity.js"), /unique:\s*true/);
  assert.match(read("scripts/backfill-contact-identities.js"), /maintenance window/);
});

test("payout processing locks referrals and eligibility changes close the old withdrawal", () => {
  const service = read("services/partner-payout/partner-payout-service.js");
  assert.match(service, /partnerPayoutLockWithdrawalId:\s*row\.withdrawalId/);
  assert.match(service, /PAYOUT_REQUIREMENT_LOCK_FAILED/);
  assert.match(service, /REFERRAL_PAYOUT_LOCKED/);
  assert.match(service, /status:\s*"eligibility_changed"[\s\S]{0,250}activeSlot:\s*""/);
  const activeList = service.match(/ACTIVE_WITHDRAWAL_STATUSES = \[([^\]]+)\]/)?.[1] || "";
  assert.doesNotMatch(activeList, /eligibility_changed/);
});

test("all cursor lists use bounded MongoDB execution time", () => {
  const pagination = read("utils/pagination.js");
  assert.match(pagination, /CRM_QUERY_MAX_TIME_MS/);
  assert.match(pagination, /\.maxTimeMS\(boundedMaxTimeMS\)/);
});

test("server errors log a safe request ID and sanitized error shape", () => {
  const errorMiddleware = read("middleware/error.js");
  assert.match(read("app.js"), /requestIdMiddleware/);
  assert.match(errorMiddleware, /safeErrorForLog\(error\)/);
  assert.doesNotMatch(errorMiddleware, /\n\s+error,\n/);
});

test("external communication payloads are bounded before being stored", () => {
  const { boundedJsonValue } = require("../utils/bounded-json");
  const large = { status: "failed", message: "x".repeat(50_000), nested: { values: Array.from({ length: 200 }, (_, index) => ({ index, text: "y".repeat(1000) })) } };
  const bounded = boundedJsonValue(large, { maxBytes: 5000 });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= 5000);
  assert.equal(bounded.truncated, true);
  const communication = read("services/communication/communication-service.js");
  const webhook = read("services/communication/webhook-service.js");
  assert.match(communication, /externalResponse: boundedJsonValue/);
  assert.match(webhook, /details: boundedJsonValue\(body\)/);
});

test("partner payout revalidation uses the transaction session before executing its query", () => {
  const service = read("services/partner-payout/partner-payout-service.js");
  const start = service.indexOf("async function revalidateWithdrawal");
  const block = service.slice(start, start + 1200);
  assert.match(block, /let eligible = Enquiry\.find/);
  assert.match(block, /eligible = eligible\.session\(session\)/);
  assert.match(block, /await eligible\.lean\(\)/);
  assert.ok(block.indexOf("eligible.session") < block.indexOf("await eligible.lean"));
});

test("payout reversal releases paid or reserved referral rows and terminal webhooks are idempotent", () => {
  const service = read("services/partner-payout/partner-payout-service.js");
  assert.match(service, /partnerPayoutStatus: \{ \$in: \["paid", "reserved"\] \}/);
  assert.match(service, /if \(row\.status === nextStatus\) return row/);
  assert.match(service, /PAYOUT_STATUS_NOT_COMPLETABLE/);
});
