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

test("report aggregation excludes Testing category and uses credits for unlock value", () => {
  const service = source("services/report/requirement-report-service.js");
  assert.match(service, /categorySlug:\s*\/\^testing\$\/i/);
  assert.match(service, /category:\s*\/\^testing\$\/i/);
  assert.match(service, /chargedCredits/);
  assert.match(service, /unlockValueRupees:\s*money\(rawSummary\.unlockCredits\)/);
  assert.match(service, /estimatedMissedOpportunityRupees/);
  assert.match(service, /"closed", "expired"/);
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
    "Unlock value",
    "Approved but not unlocked",
    "Estimated missed opportunity",
    "Taken / converted",
  ]) {
    assert.ok(view.includes(label), "Missing report KPI: " + label);
  }
});
