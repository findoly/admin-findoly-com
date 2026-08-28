"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

function loadService(updateOne) {
  const servicePath = path.resolve(__dirname, "../services/enquiry/provider-alert-state-service.js");
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "../../models/Enquiry") {
      return { updateOne };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("provider messaging summary keeps manual sending available after unlock", () => {
  const service = loadService(async () => ({ modifiedCount: 0 }));
  const base = {
    marketplaceAvailable: true,
    marketplaceStatus: "published",
    remainingUnlocks: 3,
    unlockedCount: 0,
  };

  assert.deepEqual(
    service.providerAlertSummary(base),
    {
      code: "automatic_enabled",
      label: "Automatic WhatsApp active",
      count: 0,
      canSend: true,
      automatic: true,
    },
  );

  const sent = service.providerAlertSummary({
    ...base,
    providerWhatsappAlerts: [{
      providerId: "provider-1",
      alertedAt: new Date("2026-08-28T10:00:00.000Z"),
      mode: "manual",
    }],
  });
  assert.equal(sent.code, "automatic_enabled");
  assert.equal(sent.label, "Automatic WhatsApp active · 1 provider sent");
  assert.equal(sent.count, 1);
  assert.equal(sent.canSend, true);

  const automatic = service.providerAlertSummary({
    ...base,
    providerWhatsappAlerts: [
      { providerId: "provider-1", alertedAt: new Date(), mode: "automatic" },
      { providerId: "provider-2", alertedAt: new Date(), mode: "automatic" },
    ],
  });
  assert.equal(automatic.code, "automatic_enabled");
  assert.equal(automatic.label, "Automatic WhatsApp active · 2 providers sent");
  assert.equal(automatic.count, 2);

  const unlocked = service.providerAlertSummary({
    ...base,
    unlockedCount: 1,
    providerWhatsappAlerts: [{ providerId: "provider-1", alertedAt: new Date(), mode: "manual" }],
  });
  assert.equal(unlocked.code, "automatic_enabled");
  assert.equal(unlocked.label, "Automatic WhatsApp active · 1 provider sent");
  assert.equal(unlocked.canSend, true);
});

test("provider alert normalization keeps one durable record per provider", () => {
  const service = loadService(async () => ({ modifiedCount: 0 }));
  const alerts = service.normalizedProviderAlerts({
    providerWhatsappAlerts: [
      { providerId: " provider-1 ", alertedAt: "2026-08-28T10:00:00.000Z", mode: "manual", actor: "a" },
      { providerId: "provider-1", alertedAt: "2026-08-28T11:00:00.000Z", mode: "automatic", actor: "b" },
      { providerId: "provider-2", alertedAt: "2026-08-28T12:00:00.000Z", mode: "automatic", actor: "c" },
      { providerId: "", alertedAt: "2026-08-28T13:00:00.000Z" },
    ],
  });

  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((entry) => entry.providerId), ["provider-1", "provider-2"]);
  assert.equal(service.providerAlertFor({ providerWhatsappAlerts: alerts }, "provider-2").mode, "automatic");
});

test("successful provider alerts are persisted once per provider", async () => {
  const stored = new Set();
  const calls = [];
  const service = loadService(async (query, update) => {
    const providerId = update.$push.providerWhatsappAlerts.providerId;
    calls.push({ query, update, providerId });
    if (stored.has(providerId)) return { modifiedCount: 0 };
    stored.add(providerId);
    return { modifiedCount: 1 };
  });

  const first = await service.recordSuccessfulProviderAlerts(
    "lead-1",
    ["provider-1", "provider-1", "provider-2"],
    {
      mode: "manual",
      actor: "employee@findoly.com",
      alertedAt: new Date("2026-08-28T10:00:00.000Z"),
    },
  );
  assert.deepEqual(first.addedProviderIds, ["provider-1", "provider-2"]);
  assert.equal(first.count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].update.$push.providerWhatsappAlerts.mode, "manual");
  assert.equal(calls[0].update.$push.providerWhatsappAlerts.actor, "employee@findoly.com");

  const second = await service.recordSuccessfulProviderAlerts(
    "lead-1",
    ["provider-1"],
    { mode: "automatic", actor: "system" },
  );
  assert.deepEqual(second.addedProviderIds, []);
  assert.equal(second.count, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].query["providerWhatsappAlerts.providerId"], { $ne: "provider-1" });
});
