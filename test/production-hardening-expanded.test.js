"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return value; },
  };
}

test("safe local redirects reject browser backslash and external-origin tricks", () => {
  const { safeLocalPath } = require("../utils/safe-redirect");
  assert.equal(safeLocalPath("/dashboard"), "/dashboard");
  assert.equal(safeLocalPath("/providers?q=one#top"), "/providers?q=one#top");
  assert.equal(safeLocalPath("//evil.example"), "/dashboard");
  assert.equal(safeLocalPath("/\\evil.example"), "/dashboard");
  assert.equal(safeLocalPath("https://evil.example"), "/dashboard");
  assert.equal(safeLocalPath("/providers\nSet-Cookie:x"), "/dashboard");
});

test("authenticated admin mutations require the configured same origin", () => {
  const { sameOriginAdminMutation } = require("../middleware/same-origin");
  const old = { ...process.env };
  process.env.NODE_ENV = "production";
  process.env.CRM_ADMIN_ORIGIN = "https://admin.findoly.com";
  try {
    let continued = false;
    const allowedReq = {
      method: "POST",
      admin: { employeeId: "employee-1" },
      get(name) {
        return {
          origin: "https://admin.findoly.com",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json; charset=utf-8",
        }[String(name).toLowerCase()] || "";
      },
    };
    sameOriginAdminMutation(allowedReq, fakeResponse(), () => { continued = true; });
    assert.equal(continued, true);

    const denied = fakeResponse();
    sameOriginAdminMutation({
      ...allowedReq,
      get(name) {
        return {
          origin: "https://provider.findoly.com",
          "sec-fetch-site": "same-site",
          "content-type": "application/json",
        }[String(name).toLowerCase()] || "";
      },
    }, denied, () => assert.fail("cross-origin request must not continue"));
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.code, "ADMIN_ORIGIN_REQUIRED");
  } finally {
    process.env = old;
  }
});

test("production configuration requires an explicit database and protected public intake", () => {
  const { validateRuntimeConfig, databaseNameFromMongoUri } = require("../utils/runtime-config");
  assert.equal(databaseNameFromMongoUri("mongodb://localhost/findoly_prod"), "findoly_prod");
  assert.equal(databaseNameFromMongoUri("mongodb+srv://cluster.example.net/findoly_prod?retryWrites=true"), "findoly_prod");
  assert.equal(databaseNameFromMongoUri("mongodb://localhost/"), "");

  const result = validateRuntimeConfig({
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost/",
    AUTH_COOKIE_SECRET: "x".repeat(40),
    CORS_ORIGINS: "https://admin.findoly.com",
    CRM_ADMIN_ORIGIN: "https://admin.findoly.com",
  });
  assert.ok(result.errors.some((message) => /database name/i.test(message)));
  assert.ok(result.errors.some((message) => /PUBLIC_INTAKE_API_TOKEN/.test(message)));
});

test("large-collection search uses exact contacts and anchored text prefixes", () => {
  const {
    buildSearchAlternatives,
    prefixRegex,
  } = require("../utils/search-query");
  assert.deepEqual(
    buildSearchAlternatives("9876543210", { phoneFields: ["normalizedMobile", "mobile"] }),
    [{ normalizedMobile: "9876543210" }, { mobile: "9876543210" }],
  );
  assert.deepEqual(
    buildSearchAlternatives("USER@EXAMPLE.COM", { emailFields: ["normalizedEmail"] }),
    [{ normalizedEmail: "user@example.com" }],
  );
  assert.equal(prefixRegex("Painter").source, "^Painter");
  assert.equal(prefixRegex("Painter").flags, "i");
  assert.doesNotMatch(source("services/communication/communication-service.js"), /\{ message: search \}/);
  assert.doesNotMatch(source("services/communication/template-service.js"), /\{ body: search \}/);
});

test("CloudWatch reuses a stream for one UTC quarter hour and never republishes a confirmed batch", async () => {
  const { createCloudWatchLogger } = require("../services/logging/cloudwatch-logger");
  let instant = new Date("2026-08-01T08:01:00.000Z");
  const requests = [];
  const logger = createCloudWatchLogger({
    service: "crm",
    credentialPrefix: "CRM_SECRETS_",
    defaultLogGroup: "/findoly/crm/production",
    env: {
      NODE_ENV: "production",
      CLOUDWATCH_LOGS_ENABLED: "true",
      CLOUDWATCH_LOG_GROUP: "/findoly/crm/production",
      CLOUDWATCH_LOG_FLUSH_MS: "60000",
      CRM_SECRETS_REGION: "ap-south-1",
      CRM_SECRETS_ACCESS_KEY_ID: "AKIAEXAMPLE000000000",
      CRM_SECRETS_SECRET_ACCESS_KEY: "example-secret",
    },
    hostname: "crm-host",
    now: () => instant,
    consoleObject: { log() {}, warn() {}, error() {} },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, status: 200, async text() { return "{}"; } };
    },
  });
  logger.configureFromEnv();
  assert.equal(logger.streamNameFor(instant.getTime()), "crm/2026-08-01/08-00/crm-host");
  instant = new Date("2026-08-01T08:14:59.999Z");
  assert.equal(logger.streamNameFor(instant.getTime()), "crm/2026-08-01/08-00/crm-host");
  instant = new Date("2026-08-01T08:15:00.000Z");
  assert.equal(logger.streamNameFor(instant.getTime()), "crm/2026-08-01/08-15/crm-host");

  logger.capture("info", ["one"]);
  await logger.flush();
  const putCountAfterFirst = requests.filter((request) => request.logEvents).length;
  await logger.flush();
  assert.equal(requests.filter((request) => request.logEvents).length, putCountAfterFirst);
  assert.equal(logger.diagnostics().queueLength, 0);
});

test("Hostinger listener binds before Secrets Manager, database and Express imports", () => {
  const server = source("bin/www");
  const listenAt = server.indexOf("await listen(server, port)");
  const secretsAt = server.indexOf("await loadSecrets()");
  const appAt = server.indexOf("const app = loadApp()");
  assert.ok(listenAt >= 0 && secretsAt >= 0 && appAt >= 0);
  assert.ok(listenAt < secretsAt);
  assert.ok(secretsAt < appAt);
  assert.match(server, /CRM_STARTING/);
});

test("production index provisioning covers every CRM model", () => {
  const modelFiles = fs.readdirSync(path.join(__dirname, "..", "models"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => name.replace(/\.js$/, ""))
    .sort();
  const indexSource = source("scripts/ensure-indexes.js");
  const omitted = modelFiles.filter((name) => !indexSource.includes(`require("../models/${name}")`));
  assert.deepEqual(omitted, []);
  assert.match(indexSource, /verifyDeclaredIndexes/);
  assert.match(indexSource, /--verify-only/);
});

test("date fields use BSON Date and have explicit online-safe migrations", () => {
  assert.match(source("models/FollowUp.js"), /dueAt:\s*\{\s*type:\s*Date/);
  assert.match(source("models/Invoice.js"), /issueDate:\s*\{\s*type:\s*Date/);
  assert.match(source("models/Invoice.js"), /dueDate:\s*\{\s*type:\s*Date/);
  const scripts = JSON.parse(source("package.json")).scripts;
  assert.match(scripts["migrate:follow-up-dates"], /migrate-follow-up-dates/);
  assert.match(scripts["migrate:invoice-dates"], /migrate-invoice-dates/);
});

test("partner withdrawal and payout state changes are transaction protected", () => {
  const service = source("services/partner-payout/partner-payout-service.js");
  for (const functionName of ["submitWithdrawal", "transitionWithdrawal", "markPaid", "markPayoutFailed", "markEligibilityChangedForRequirement"]) {
    const start = service.indexOf(`async function ${functionName}`);
    assert.ok(start >= 0, `${functionName} is missing`);
    assert.match(service.slice(start, start + 4500), /withTransaction\(/, `${functionName} must use a transaction`);
  }
  assert.match(source("models/AgentWithdrawal.js"), /agent_active_withdrawal_unique/);
  assert.match(service, /WITHDRAWAL_CONCURRENT_UPDATE/);
  assert.match(service, /PAYOUT_CONCURRENT_UPDATE/);
});

test("growing history arrays are bounded at write time", () => {
  assert.match(source("services/communication/communication-service.js"), /\$slice:\s*-COMMUNICATION_HISTORY_LIMIT/);
  assert.match(source("services/communication/webhook-service.js"), /\$slice:\s*-COMMUNICATION_HISTORY_LIMIT/);
  assert.match(source("services/customer-portal/customer-portal-service.js"), /\$slice:\s*-ENQUIRY_TIMELINE_LIMIT/);
  assert.match(source("services/enquiry/enquiry-service.js"), /\$slice:\s*-TIMELINE_LIMIT/);
  assert.match(source("services/partner-payout/partner-payout-service.js"), /\$slice:\s*-APPROVAL_HISTORY_LIMIT/);
});

test("dashboard counts do not read thousands of IDs and subscription search has no 500-provider correctness cap", () => {
  const dashboard = source("services/dashboard/dashboard-service.js");
  assert.match(dashboard, /\{ \$limit: cap \+ 1 \}/);
  assert.match(dashboard, /\{ \$count: "value" \}/);
  assert.doesNotMatch(dashboard, /\.select\(\{ _id: 1 \}\)\s*\.limit\(cap \+ 1\)/);
  const subscriptions = source("services/billing/provider-subscription-service.js");
  assert.doesNotMatch(subscriptions, /\.limit\(500\)/);
  assert.match(subscriptions, /\$lookup/);
});

test("provider mobile and email uniqueness is enforced by database indexes", () => {
  const model = source("models/Provider.js");
  assert.match(model, /provider_mobile_unique/);
  assert.match(model, /provider_email_unique/);
  assert.match(model, /unique:\s*true/);
  assert.match(source("scripts/backfill-provider-contacts.js"), /providerDuplicateReport/);
});

test("contact identity migration streams through a unique staging collection and records completion", () => {
  const migration = source("scripts/backfill-contact-identities.js");
  assert.match(migration, /STAGING_COLLECTION/);
  assert.match(migration, /insertMany\(documents, \{ ordered: false \}\)/);
  assert.match(migration, /rename\(CONTACT_COLLECTION, \{ dropTarget: true \}\)/);
  assert.match(migration, /SystemMigration\.updateOne/);
  assert.match(migration, /uniqueContactKeyIndexPresent/);
  assert.doesNotMatch(migration, /const owners = new Map\(\)/);
  assert.doesNotMatch(migration, /key: \{ \$in: plan\.identities/);
  assert.match(source("models/SystemMigration.js"), /collection: "system_migrations"/);
});

test("contact and date migrations reject malformed legacy values instead of erasing them", () => {
  const contacts = source("scripts/backfill-provider-contacts.js");
  assert.match(contacts, /if \(mobileRaw && !normalizedMobile\)/);
  assert.match(contacts, /if \(emailRaw && !normalizedEmail\)/);
  assert.match(contacts, /if \(whatsappRaw && !normalizedWhatsappNumber\)/);
  const followUps = source("services/follow-up/follow-up-service.js");
  assert.match(followUps, /if \(value instanceof Date\)/);
  assert.match(followUps, /new Date\(value\.getTime\(\)\)/);
});

test("managed category reads avoid million-record legacy distinct scans by default", () => {
  const catalog = source("services/catalog/catalog-service.js");
  assert.match(catalog, /includeLegacy/);
  assert.match(catalog, /if \(!includeInactive && includeLegacy\)/);
  assert.match(source("services/provider/provider-service.js"), /includeLegacy: false/);
  assert.match(source("services/customer-portal/customer-portal-service.js"), /includeLegacy: false/);
});

test("communication dashboard uses bounded queries and a single-flight cache", () => {
  const communication = source("services/communication/communication-service.js");
  assert.match(communication, /COMMUNICATION_DASHBOARD_CACHE_TTL_MS/);
  assert.match(communication, /communicationDashboardBuildPromise/);
  assert.match(communication, /maxTimeMS: COMMUNICATION_QUERY_MAX_TIME_MS/);
  assert.match(source("models/Communication.js"), /\{ channel: 1, status: 1 \}/);
});

test("payout terminal API responses and referral edits are recorded transactionally", () => {
  const payout = source("services/partner-payout/partner-payout-service.js");
  assert.match(payout, /\["failed", "cancelled", "rejected"\][\s\S]{0,250}markPayoutFailed/);
  assert.match(payout, /async function updateReferralValidation[\s\S]{0,900}withTransaction\(/);
  assert.match(payout, /async function updateSaleConversion[\s\S]{0,700}withTransaction\(/);
  assert.match(payout, /payoutStatusDetails\(payout\.status_details\)/);
});

test("representative cursor sorts have compound indexes including the _id tie-breaker", () => {
  assert.match(source("models/Employee.js"), /status: 1, roleId: 1, createdAt: -1, _id: -1/);
  assert.match(source("models/Enquiry.js"), /partnerPayoutStatus: 1, createdAt: 1, _id: 1/);
  assert.match(source("models/CommunicationTemplate.js"), /channel: 1, status: 1, updatedAt: -1, _id: -1/);
  assert.match(source("models/CommunicationRule.js"), /enabled: 1, event: 1, _id: 1/);
  assert.match(source("models/OtpRequest.js"), /recipient: 1, purpose: 1, createdAt: -1, _id: -1/);
  assert.match(source("models/OtpRequest.js"), /status: 1, createdAt: -1, _id: -1/);
});

test("cross-entity duplicate checks use normalized indexed contact fields", () => {
  const service = source("services/contact-identity/contact-identity-service.js");
  assert.doesNotMatch(service, /phoneFields: \["normalizedMobile", "mobile"\]/);
  assert.doesNotMatch(service, /emailFields: \["normalizedEmail", "email"\]/);
  assert.match(service, /phoneFields: \["normalizedMobile", "normalizedWhatsappNumber"\]/);
});

test("production preflight includes index and query-plan verification", () => {
  const scripts = JSON.parse(source("package.json")).scripts;
  assert.match(scripts["verify:query-plans"], /verify-query-plans/);
  assert.match(scripts["preflight:production"], /verify:indexes/);
  assert.match(scripts["preflight:production"], /verify:query-plans/);
  const verifier = source("scripts/verify-query-plans.js");
  assert.match(verifier, /explain\("executionStats"\)/);
  assert.match(verifier, /COLLSCAN/);
  assert.match(verifier, /QUERY_PLAN_VERIFICATION_FAILED/);
});
