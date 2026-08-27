"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  effectiveStatus,
  presentPurchase,
  STATUSES,
  PURCHASE_PURPOSES,
} = require("../services/billing/provider-subscription-service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("new non-expiring credit purchases are presented as completed Lead Credit Packs", () => {
  const row = presentPurchase({
    paymentOrderId: "PAY-NEW-1",
    providerId: "PROVIDER-1",
    purpose: "credit_purchase",
    planCode: "growth-plus",
    planName: "Growth",
    totalCredits: 3300,
    baseCredits: 3300,
    bonusCredits: 0,
    totalAmountPaise: 299900,
    fulfilledAt: new Date("2026-08-28T10:00:00.000Z"),
    allocation: {
      creditAllocationId: "ALLOC-1",
      remainingMinorCredits: 285000,
      status: "active",
      expiresAt: null,
    },
  });

  assert.equal(row.recordId, "PAY-NEW-1");
  assert.equal(row.recordType, "credit_package");
  assert.equal(row.status, "completed");
  assert.equal(row.planName, "Growth");
  assert.equal(row.totalCredits, 3300);
  assert.equal(row.remainingCredits, 2850);
  assert.equal(row.startsAt, null);
  assert.equal(row.expiresAt, null);
});

test("legacy plan purchases retain subscription validity and status", () => {
  const row = presentPurchase({
    paymentOrderId: "PAY-LEGACY-1",
    providerId: "PROVIDER-1",
    purpose: "plan_purchase",
    planCode: "growth",
    planName: "Growth",
    subscription: {
      providerSubscriptionId: "SUB-1",
      planCode: "growth",
      planName: "Growth",
      billingCycle: "monthly",
      status: "active",
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: new Date("2099-09-01T00:00:00.000Z"),
      totalCredits: 3000,
      baseCredits: 3000,
      bonusCredits: 0,
      totalAmountPaise: 299900,
    },
  });

  assert.equal(row.recordId, "SUB-1");
  assert.equal(row.recordType, "legacy_subscription");
  assert.equal(row.billingCycle, "monthly");
  assert.equal(row.status, "active");
  assert.equal(row.expiresAt.toISOString(), "2099-09-01T00:00:00.000Z");
});

test("legacy effective status still handles scheduled and expired subscriptions", () => {
  const now = new Date("2026-08-28T00:00:00.000Z");
  assert.equal(effectiveStatus({
    purpose: "plan_purchase",
    subscription: {
      status: "active",
      startsAt: new Date("2026-08-29T00:00:00.000Z"),
      expiresAt: new Date("2026-09-29T00:00:00.000Z"),
    },
  }, now), "scheduled");
  assert.equal(effectiveStatus({
    purpose: "plan_purchase",
    subscription: {
      status: "active",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2026-08-27T23:59:59.000Z"),
    },
  }, now), "expired");
});

test("purchase history reads successful payment orders instead of subscription-only rows", () => {
  const service = source("services/billing/provider-subscription-service.js");
  assert.deepEqual(PURCHASE_PURPOSES, ["credit_purchase", "plan_purchase"]);
  assert.match(service, /const PaymentOrder = require/);
  assert.match(service, /status:\s*"paid"/);
  assert.match(service, /fulfilled:\s*true/);
  assert.match(service, /PaymentOrder\.aggregate/);
  assert.match(service, /CreditAllocation\.collection\.collectionName/);
  assert.doesNotMatch(service, /cursorPaginate\(ProviderSubscription/);
});

test("latest purchase sorting uses fulfilled purchase time with paid and created fallbacks", () => {
  const service = source("services/billing/provider-subscription-service.js");
  assert.match(service, /purchasedAt:\s*\{\s*\$ifNull:\s*\["\$fulfilledAt"/);
  assert.match(service, /defaultField:\s*"purchasedAt"/);
  assert.match(service, /fields:\s*\["purchasedAt", "startsAt", "expiresAt", "updatedAt"\]/);
});

test("CRM purchase view shows non-expiring package semantics and keeps legacy subscriptions", () => {
  const view = source("views/billing/provider-subscriptions.ejs");
  assert.match(view, /Provider purchases/);
  assert.match(view, /Lead Credit Pack/);
  assert.match(view, /Never expires/);
  assert.match(view, /Legacy subscription/);
  assert.match(view, /Completed/);
  assert.match(view, /remaining/);
  assert.match(view, /Provider subscriptions/i);
});

test("new completed status is supported without removing legacy statuses", () => {
  assert.deepEqual(STATUSES, ["completed", "active", "scheduled", "expired", "cancelled", "failed"]);
});
