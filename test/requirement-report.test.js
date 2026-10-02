"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolvePeriod,
  fillTrend,
  MAX_RANGE_DAYS,
} = require("../services/report/requirement-report-service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("requirement report presets use India day boundaries", () => {
  const now = new Date("2026-08-27T21:15:00.000Z");

  assert.deepEqual(
    (({ startDate, endDate }) => ({ startDate, endDate }))(resolvePeriod({ preset: "today" }, now)),
    { startDate: "2026-08-28", endDate: "2026-08-28" },
  );
  assert.deepEqual(
    (({ startDate, endDate }) => ({ startDate, endDate }))(resolvePeriod({ preset: "yesterday" }, now)),
    { startDate: "2026-08-27", endDate: "2026-08-27" },
  );
  assert.deepEqual(
    (({ startDate, endDate }) => ({ startDate, endDate }))(resolvePeriod({ preset: "7d" }, now)),
    { startDate: "2026-08-22", endDate: "2026-08-28" },
  );
  assert.deepEqual(
    (({ startDate, endDate }) => ({ startDate, endDate }))(resolvePeriod({ preset: "30d" }, now)),
    { startDate: "2026-07-30", endDate: "2026-08-28" },
  );
});

test("custom requirement report range is limited to six months", () => {
  assert.equal(MAX_RANGE_DAYS, 184);
  assert.doesNotThrow(() => resolvePeriod({
    preset: "custom",
    from: "2026-03-01",
    to: "2026-08-31",
  }));
  assert.throws(
    () => resolvePeriod({ preset: "custom", from: "2026-01-01", to: "2026-08-01" }),
    /cannot exceed 6 months/i,
  );
  assert.throws(
    () => resolvePeriod({ preset: "custom", from: "2026-02-31", to: "2026-03-01" }),
    /valid From and To dates/i,
  );
});

test("trend fills days with zero requirements", () => {
  const trend = fillTrend([
    { _id: "2026-08-26", requirements: 4 },
    { _id: "2026-08-28", requirements: 2 },
  ], "2026-08-26", "2026-08-28");

  assert.deepEqual(trend.map((row) => row.requirements), [4, 0, 2]);
  assert.deepEqual(trend.map((row) => row.date), ["2026-08-26", "2026-08-27", "2026-08-28"]);
});

test("report aggregation excludes Testing category and preserves gross unlock value compatibility", () => {
  const service = source("services/report/requirement-report-service.js");
  assert.match(service, /categorySlug:\s*\/\^testing\$\/i/);
  assert.match(service, /category:\s*\/\^testing\$\/i/);
  assert.match(service, /chargedCredits/);
  assert.match(service, /unlockCredits:\s*grossUnlockCredits/);
  assert.match(service, /unlockValueRupees:\s*grossUnlockCredits/);
  assert.match(service, /estimatedMissedOpportunityRupees/);
  assert.match(service, /marketplaceExpiresAt/);
  assert.match(service, /marketplaceClosureReason/);
});

test("requirement report API is read-only and protected by reports.view", () => {
  const mainRoutes = source("routes/main.js");
  const reportRoutes = source("routes/report.js");
  assert.match(mainRoutes, /router\.use\("\/reports", require\("\.\/report"\)\)/);
  assert.match(reportRoutes, /router\.get\("\/requirements", requirePermission\("reports\.view"\), controller\.requirements\)/);
  assert.doesNotMatch(reportRoutes, /router\.(post|put|patch|delete)\(/);
});

test("Reports UI stays requirement-only with approved filters and two charts", () => {
  const view = source("views/report/index.ejs");
  assert.match(view, /Requirement Report/);
  assert.match(view, /Today/);
  assert.match(view, /Yesterday/);
  assert.match(view, /Last 7 days/);
  assert.match(view, /Last 30 days/);
  assert.match(view, /Custom/);
  assert.match(view, /Testing category excluded/);
  assert.match(view, /Requirement trend/);
  assert.match(view, /Requirement status/);
  assert.match(view, /<polyline/);
  assert.match(view, /class="progress-bar"/);
  assert.match(view, /\/api\/reports\/requirements/);
  assert.doesNotMatch(view, /Follow-ups|Invoices/);
});

test("report cards cover the agreed requirement KPIs", () => {
  const view = source("views/report/index.ejs");
  for (const label of [
    "Requirements received",
    "New",
    "Approved",
    "Rejected",
    "Requirements unlocked",
    "Total provider unlocks",
    "Approved but not unlocked",
    "Estimated missed opportunity",
    "Taken / converted",
    "Gross unlock value",
    "Refunded value",
    "Net unlock value",
    "Direct payment value",
    "Refund rate",
  ]) {
    assert.ok(view.includes(label), "Missing report KPI: " + label);
  }
});


test("managed provider report outcomes use the 28 September cutover and canonical provider outcome", () => {
  const service = source("services/report/requirement-report-service.js");

  assert.match(service, /MANAGED_PROVIDER_OUTCOME_CUTOFF_DATE = "2026-09-28"/);
  assert.match(service, /managedProviderUnlocks/);
  assert.match(service, /managedProviderConfirmed/);
  assert.match(service, /managedProviderNotConfirmed/);
  assert.match(service, /managedProviderNoStatusUpdate/);
  assert.match(service, /\$ifNull: \["\$providerSaleOutcome", ""\]/);
  assert.match(service, /\$not: \[\{ \$in: \[/);
  assert.match(service, /noStatusUpdate: summary\.managedProviderNoStatusUpdate/);
});

test("managed provider report treats provider and CRM admin outcome writers identically", () => {
  const reportService = source("services/report/requirement-report-service.js");
  const providerStatusService = source("services/provider-unlock/provider-status-service.js");
  const providerAdminService = source("services/provider/provider-service.js");

  assert.match(reportService, /\$providerSaleOutcome/);
  assert.match(providerStatusService, /unlock\.providerSaleOutcome = feedback\.outcome/);
  assert.match(providerAdminService, /unlock\.providerSaleOutcome = effectiveOutcome/);
  assert.doesNotMatch(reportService, /providerSaleOutcomeUpdatedBy/);
});

test("Reports UI shows the three managed provider outcome states", () => {
  const view = source("views/report/index.ejs");

  assert.match(view, /Managed provider outcomes/);
  assert.match(view, /Confirmed/);
  assert.match(view, /Not Confirmed/);
  assert.match(view, /No status update/);
  assert.match(view, /28 Sep 2026/);
  assert.match(view, /managedProviderOutcomes/);
});


test("requirement report subtracts only completed credit refunds from net unlock credits", () => {
  const service = source("services/report/requirement-report-service.js");

  assert.match(service, /creditRefundStatus", "refunded"/);
  assert.match(service, /creditRefundedCredits/);
  assert.match(service, /refundedUnlockCredits/);
  assert.match(service, /Math\.max\(0, grossUnlockCredits - refundedUnlockCredits\)/);
  assert.match(service, /netUnlockValueRupees: netUnlockCredits/);
});

test("requirement report falls back to charged credits for historical refunded rows", () => {
  const service = source("services/report/requirement-report-service.js");

  assert.match(service, /\$gt: \[\{ \$ifNull: \["\$creditRefundedCredits", 0\] \}, 0\]/);
  assert.match(service, /\$ifNull: \["\$creditRefundedCredits", 0\]/);
  assert.match(service, /\$ifNull: \["\$chargedCredits", 0\]/);
});

test("Reports UI promotes gross, refund and net values to mobile-visible cards", () => {
  const view = source("views/report/index.ejs");

  assert.match(view, /Credit & revenue/);
  assert.match(view, /Gross unlock value/);
  assert.match(view, /Refunded value/);
  assert.match(view, /Net unlock value/);
  assert.match(view, /Direct payment value/);
  assert.match(view, /Refund rate/);
  assert.match(view, /col-12 col-sm-6 col-lg-3/);
  assert.match(view, /formatMoney\(s\.refundedUnlockValueRupees\)/);
  assert.match(view, /formatMoney\(s\.netUnlockValueRupees\)/);
  assert.match(view, /formatMoney\(s\.directPaymentRupees\)/);
  assert.match(view, /refundedUnlockCredits/);
  assert.match(view, /grossUnlockCredits/);
});

test("refund rate is calculated from refunded credits over gross charged credits", () => {
  const view = source("views/report/index.ejs");

  assert.match(view, /const gross = Number\(s\.grossUnlockCredits \|\| 0\)/);
  assert.match(view, /if \(gross <= 0\) return 0/);
  assert.match(view, /Number\(s\.refundedUnlockCredits \|\| 0\) \/ gross/);
  assert.match(view, /Math\.max\(0, Math\.min\(100,/);
});

test("missed opportunity uses actual marketplace expiry and excludes deliberate terminal closures", () => {
  const service = source("services/report/requirement-report-service.js");

  assert.match(service, /\$lte: \["\$marketplaceExpiresAt", now\]/);
  assert.match(service, /\$ne: \["\$isActive", false\]/);
  assert.match(service, /\$gt: \[\{ \$ifNull: \["\$remainingUnlocks", 0\] \}, 0\]/);
  for (const reason of ["invalid", "deactivated", "status_change"]) {
    assert.ok(service.includes(`"${reason}"`), "Missing missed-opportunity exclusion: " + reason);
  }
  assert.doesNotMatch(
    service,
    /estimatedMissedOpportunityRupees:[\s\S]{0,900}\$in: \["\$marketplaceStatus", \["closed", "expired"\]\]/,
  );
});

test("missed opportunity value remains remaining unlocks multiplied by lead price", () => {
  const service = source("services/report/requirement-report-service.js");

  assert.match(service, /\$multiply: \[/);
  assert.match(service, /\$ifNull: \["\$remainingUnlocks", 0\]/);
  assert.match(service, /\$divide: \[\{ \$ifNull: \["\$leadPricePaise", 0\] \}, 100\]/);
});
