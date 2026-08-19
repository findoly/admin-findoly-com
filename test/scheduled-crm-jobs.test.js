"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("scheduled job API is isolated behind a dedicated bearer secret", () => {
  const main = read("routes/main.js");
  const routes = read("routes/scheduled-jobs.js");
  const auth = read("middleware/scheduled-job-auth.js");
  assert.ok(main.indexOf('router.use("/internal/jobs", require("./scheduled-jobs"))') < main.indexOf("router.use(apiAuth)"));
  assert.match(routes, /router\.use\(scheduledJobAuth\)/);
  assert.match(auth, /CRM_SCHEDULED_JOB_SECRET/);
  assert.match(auth, /timingSafeEqual/);
  assert.doesNotMatch(auth, /console\.(?:log|info|error).*SECRET/i);
});

test("scheduled job API exposes follow-up processing and five separate daily reports", () => {
  const routes = read("routes/scheduled-jobs.js");
  for (const pathValue of [
    "/follow-ups/due",
    "/reports/leads",
    "/reports/lead-unlocks",
    "/reports/providers",
    "/reports/follow-ups",
    "/reports/crm-health",
    "/reports/testing-providers",
  ]) {
    assert.match(routes, new RegExp(pathValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("follow-ups track completion and idempotent due alert processing state", () => {
  const model = read("models/FollowUp.js");
  const service = read("services/follow-up/follow-up-service.js");
  const dueService = read("services/scheduled-jobs/follow-up-alert-service.js");
  for (const field of ["completedAt", "dueAlertStatus", "dueAlertSentAt", "dueAlertAttemptedAt", "dueAlertAttempts", "dueAlertLastError"]) {
    assert.match(model, new RegExp(field));
  }
  assert.match(model, /\["pending", "processing", "sent", "failed"\]/);
  assert.match(service, /dueChanged \|\| reopened/);
  assert.match(service, /alertResetFields\(\)/);
  assert.match(dueService, /scheduled-follow-up-due:/);
  assert.match(dueService, /PROCESSING_STALE_MS/);
  assert.match(dueService, /status: \{ \$in: \["open", "pending"\] \}/);
});

test("daily report emails stay overview-only and use independent event keys", () => {
  const alerts = read("services/scheduled-jobs/scheduled-alert-service.js");
  const reports = read("services/scheduled-jobs/report-service.js");
  for (const event of [
    "daily_lead_report",
    "daily_lead_unlock_report",
    "daily_provider_report",
    "daily_follow_up_report",
    "daily_crm_health_report",
  ]) {
    assert.match(alerts, new RegExp(event));
  }
  assert.match(reports, /scheduled-report:daily-lead:/);
  assert.match(reports, /scheduled-report:daily-lead-unlock:/);
  assert.match(reports, /scheduled-report:daily-provider:/);
  assert.match(reports, /scheduled-report:daily-follow-up:/);
  assert.match(reports, /scheduled-report:daily-crm-health:/);
  assert.doesNotMatch(alerts, /provider_mobile|provider_phone|provider_list|lead_list/);
});

test("testing provider alert skips zero count and supports provider ID exclusions", () => {
  const reports = read("services/scheduled-jobs/report-service.js");
  assert.match(reports, /TESTING_PROVIDER_CATEGORY_SLUG/);
  assert.match(reports, /TESTING_PROVIDER_REPORT_EXCLUDED_IDS/);
  assert.match(reports, /query\.providerId = \{ \$nin: excludedIds \}/);
  assert.match(reports, /if \(!count\)/);
  assert.match(reports, /No non-excluded providers are assigned to the Testing category/);
  assert.match(reports, /scheduled-alert:testing-providers:/);
  assert.match(reports, /indiaHourKey/);
});

test("scheduled emails are managed from the existing internal email alert screen", () => {
  const communicationRoutes = read("routes/communication.js");
  const view = read("views/communication/internal-alerts.ejs");
  assert.match(communicationRoutes, /scheduled-alerts\/ensure/);
  assert.match(communicationRoutes, /scheduled-alerts\/:event/);
  for (const event of [
    "follow_up_due",
    "daily_lead_report",
    "daily_lead_unlock_report",
    "daily_provider_report",
    "daily_follow_up_report",
    "daily_crm_health_report",
    "testing_provider_alert",
  ]) {
    assert.match(view, new RegExp(event));
  }
  assert.match(view, /scheduled_internal_email/);
  assert.match(view, /scheduled-alerts\/.*\/test/);
});
