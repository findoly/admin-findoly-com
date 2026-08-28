"use strict";

const Enquiry = require("../../models/Enquiry");

const MAX_TRACKED_PROVIDER_ALERTS = 1000;
const ALERT_MODES = Object.freeze(["manual", "automatic"]);

function normalizeProviderId(value) {
  return String(value || "").trim();
}

function normalizedProviderAlerts(lead = {}) {
  const output = [];
  const seen = new Set();
  for (const entry of Array.isArray(lead.providerWhatsappAlerts) ? lead.providerWhatsappAlerts : []) {
    const providerId = normalizeProviderId(entry?.providerId);
    if (!providerId || seen.has(providerId)) continue;
    seen.add(providerId);
    output.push({
      providerId,
      alertedAt: entry?.alertedAt || null,
      mode: ALERT_MODES.includes(String(entry?.mode || "").toLowerCase())
        ? String(entry.mode).toLowerCase()
        : "manual",
      actor: String(entry?.actor || ""),
    });
  }
  return output;
}

function providerAlertFor(lead = {}, providerId) {
  const normalizedId = normalizeProviderId(providerId);
  if (!normalizedId) return null;
  return normalizedProviderAlerts(lead).find((entry) => entry.providerId === normalizedId) || null;
}

function providerAlertSummary(lead = {}) {
  const alerts = normalizedProviderAlerts(lead);
  const count = alerts.length;
  const unlocked = Math.max(0, Number(lead.unlockedCount || 0)) > 0;
  const published = lead.marketplaceAvailable === true
    && String(lead.marketplaceStatus || "").toLowerCase() === "published"
    && Number(lead.remainingUnlocks || 0) > 0;

  if (unlocked) {
    return {
      code: "provider_unlocked",
      label: "Provider unlocked · Alerts stopped",
      count,
      canSend: false,
      automatic: true,
    };
  }
  if (published) {
    return {
      code: "automatic_enabled",
      label: count > 0
        ? `Automatic alerts active · ${count} provider${count === 1 ? "" : "s"} alerted`
        : "Automatic alerts active",
      count,
      canSend: true,
      automatic: true,
    };
  }
  return {
    code: "not_ready",
    label: "Provider alerts not ready",
    count,
    canSend: false,
    automatic: true,
  };
}

function canSendProviderAlerts(lead = {}) {
  return providerAlertSummary(lead).canSend === true;
}

async function recordSuccessfulProviderAlerts(enquiryId, providerIds, options = {}) {
  const ids = [...new Set((Array.isArray(providerIds) ? providerIds : [])
    .map(normalizeProviderId)
    .filter(Boolean))]
    .slice(0, MAX_TRACKED_PROVIDER_ALERTS);
  if (!ids.length) return { addedProviderIds: [], count: 0 };

  const mode = ALERT_MODES.includes(String(options.mode || "").toLowerCase())
    ? String(options.mode).toLowerCase()
    : "manual";
  const actor = String(options.actor || "system").slice(0, 254);
  const alertedAt = options.alertedAt instanceof Date && !Number.isNaN(options.alertedAt.getTime())
    ? options.alertedAt
    : new Date();
  const addedProviderIds = [];

  for (const providerId of ids) {
    const result = await Enquiry.updateOne(
      {
        $or: [{ enquiryId: String(enquiryId || "") }, { id: String(enquiryId || "") }],
        "providerWhatsappAlerts.providerId": { $ne: providerId },
      },
      {
        $push: {
          providerWhatsappAlerts: {
            providerId,
            alertedAt,
            mode,
            actor,
          },
        },
        $set: { updatedAt: alertedAt },
      },
    );
    if (Number(result.modifiedCount || 0) > 0) addedProviderIds.push(providerId);
  }

  return {
    addedProviderIds,
    count: addedProviderIds.length,
  };
}

module.exports = {
  MAX_TRACKED_PROVIDER_ALERTS,
  ALERT_MODES,
  normalizedProviderAlerts,
  providerAlertFor,
  providerAlertSummary,
  canSendProviderAlerts,
  recordSuccessfulProviderAlerts,
};
