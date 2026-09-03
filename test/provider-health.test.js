"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const servicePath = path.join(root, "services/provider/provider-health-service.js");

function loadService({
  providerRows = [],
  idleRows = [],
  metricsRows = [],
  frequentRows = [],
  activeCount = 0,
  lowCount = 0,
  recentCount = 0,
} = {}) {
  const Provider = {
    collection: { collectionName: "providers" },
    find(query) {
      Provider.lastFindQuery = query;
      return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        maxTimeMS() { return this; },
        async lean() { return providerRows; },
      };
    },
    countDocuments(query) {
      const isLow = Array.isArray(query?.$or);
      return {
        async maxTimeMS() {
          return isLow ? lowCount : activeCount;
        },
      };
    },
    aggregate(pipeline) {
      Provider.lastAggregate = pipeline;
      return { async option() { return idleRows; } };
    },
  };

  const ProviderLeadUnlock = {
    collection: { collectionName: "providerleadunlocks" },
    aggregate(pipeline) {
      const hasCount = pipeline.some((stage) => stage.$count);
      const isMetrics = Boolean(pipeline[0]?.$match?.providerId?.$in);
      return {
        async option() {
          if (hasCount) return recentCount ? [{ count: recentCount }] : [];
          if (isMetrics) return metricsRows;
          return frequentRows;
        },
      };
    },
  };

  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "../../models/Provider") return Provider;
    if (request === "../../models/ProviderLeadUnlock") return ProviderLeadUnlock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("provider health keeps the approved 300-credit and 30-day boundaries", () => {
  const service = loadService();
  assert.equal(service.LOW_CREDIT_THRESHOLD_CREDITS, 300);
  assert.equal(service.LOW_CREDIT_THRESHOLD_PAISE, 30000);
  assert.equal(service.ACTIVITY_WINDOW_DAYS, 30);
  assert.equal(service.lowCreditMatch().$or[0].walletBalancePaise.$lt, 30000);
  assert.equal(service.lowCreditMatch().$or[1].walletBalancePaise, null);
  const cutoff = service.activityCutoff(new Date("2026-09-03T00:00:00.000Z"));
  assert.equal(cutoff.toISOString(), "2026-08-04T00:00:00.000Z");
});

test("provider health input defaults stay bounded and fail closed to low-credit view", () => {
  const service = loadService();
  assert.equal(service.normalizeView("frequent_unlockers"), "frequent_unlockers");
  assert.equal(service.normalizeView("idle"), "idle");
  assert.equal(service.normalizeView("unknown"), "low_credits");
  assert.equal(service.normalizeLimit(undefined), 50);
  assert.equal(service.normalizeLimit(1), 10);
  assert.equal(service.normalizeLimit(500), 100);
});

test("low-credit view shows active providers below 300 credits with unlock context", async () => {
  const service = loadService({
    providerRows: [{ providerId: "p-low", name: "Low Provider", walletBalancePaise: 29999 }],
    metricsRows: [{
      _id: "p-low",
      unlockCount30d: 4,
      lastUnlockAt: new Date("2026-09-02T10:00:00.000Z"),
    }],
    activeCount: 5,
    lowCount: 2,
    recentCount: 3,
  });
  const result = await service.list(
    { view: "low_credits", limit: 20 },
    { now: new Date("2026-09-03T00:00:00.000Z") },
  );
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].walletBalanceCredits, 299.99);
  assert.equal(result.data[0].unlockCount30d, 4);
  assert.equal(result.summary.lowCreditCount, 2);
  assert.equal(result.summary.frequentUnlockerCount, 3);
  assert.equal(result.summary.idleProviderCount, 2);
});

test("frequent unlockers are returned with provider details and recent counts", async () => {
  const service = loadService({
    frequentRows: [{
      _id: "p-active",
      unlockCount30d: 9,
      lastUnlockAt: new Date("2026-09-03T01:00:00.000Z"),
      provider: {
        providerId: "p-active",
        name: "Active Provider",
        walletBalancePaise: 85000,
      },
    }],
    activeCount: 4,
    lowCount: 1,
    recentCount: 2,
  });
  const result = await service.list(
    { view: "frequent_unlockers" },
    { now: new Date("2026-09-03T00:00:00.000Z") },
  );
  assert.equal(result.data[0].providerId, "p-active");
  assert.equal(result.data[0].unlockCount30d, 9);
  assert.equal(result.data[0].walletBalanceCredits, 850);
  assert.equal(result.summary.idleProviderCount, 2);
});

test("idle view preserves never-unlocked providers and last known unlock", async () => {
  const service = loadService({
    idleRows: [
      {
        providerId: "p-never",
        name: "Never",
        walletBalancePaise: 10000,
        unlockCount30d: 0,
        lastUnlockAt: null,
      },
      {
        providerId: "p-old",
        name: "Old",
        walletBalancePaise: 40000,
        unlockCount30d: 0,
        lastUnlockAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    activeCount: 5,
    lowCount: 2,
    recentCount: 3,
  });
  const result = await service.list(
    { view: "idle" },
    { now: new Date("2026-09-03T00:00:00.000Z") },
  );
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].lastUnlockAt, null);
  assert.equal(result.data[1].walletBalanceCredits, 400);
  assert.equal(result.summary.idleProviderCount, 2);
});
