"use strict";

const Provider = require("../../models/Provider");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { identifierValue } = require("../../utils/validation");

const MIN_RESOLVED_OUTCOMES = 3;
const WARNING_PENALTY_POINTS = 20;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function scoreLabel(score) {
  if (score === null || score === undefined || score === "" || !Number.isFinite(Number(score))) {
    return "Not enough data";
  }
  if (score >= 80) return "Strong";
  if (score >= 60) return "Good";
  return "Needs attention";
}

async function getProviderPerformance(providerId) {
  const value = identifierValue(providerId, { label: "Provider ID" });
  const provider = await Provider.findOne({ $or: [{ providerId: value }, { id: value }] })
    .select({ providerId: 1, id: 1, outcomeWarningCount: 1 })
    .lean();
  if (!provider) {
    throw Object.assign(new Error("Provider not found"), { status: 404 });
  }

  const resolvedProviderId = String(provider.providerId || provider.id || value);
  const rows = await ProviderLeadUnlock.aggregate([
    { $match: { providerId: resolvedProviderId } },
    {
      $group: {
        _id: null,
        totalUnlocks: { $sum: 1 },
        confirmed: {
          $sum: { $cond: [{ $eq: ["$providerSaleOutcome", "confirmed"] }, 1, 0] },
        },
        notConfirmed: {
          $sum: { $cond: [{ $eq: ["$providerSaleOutcome", "not_confirmed"] }, 1, 0] },
        },
      },
    },
  ]).option({ maxTimeMS: 5000 });

  const totals = rows[0] || {};
  const totalUnlocks = Math.max(0, Number(totals.totalUnlocks || 0));
  const confirmed = Math.max(0, Number(totals.confirmed || 0));
  const notConfirmed = Math.max(0, Number(totals.notConfirmed || 0));
  const resolvedOutcomes = confirmed + notConfirmed;
  const pendingOutcomes = Math.max(0, totalUnlocks - resolvedOutcomes);
  const conversionRate = resolvedOutcomes > 0
    ? Math.round((confirmed / resolvedOutcomes) * 1000) / 10
    : null;
  const outcomeWarningCount = Math.max(0, Number(provider.outcomeWarningCount || 0));
  const reliabilityScore = clampPercent(100 - outcomeWarningCount * WARNING_PENALTY_POINTS);
  const enoughData = resolvedOutcomes >= MIN_RESOLVED_OUTCOMES;
  const performanceScore = enoughData
    ? Math.round(clampPercent(Number(conversionRate || 0) * 0.8 + reliabilityScore * 0.2))
    : null;

  return {
    providerId: resolvedProviderId,
    totalUnlocks,
    resolvedOutcomes,
    confirmed,
    notConfirmed,
    pendingOutcomes,
    conversionRate,
    outcomeWarningCount,
    reliabilityScore,
    performanceScore,
    enoughData,
    minimumResolvedOutcomes: MIN_RESOLVED_OUTCOMES,
    label: scoreLabel(performanceScore),
  };
}

module.exports = {
  MIN_RESOLVED_OUTCOMES,
  WARNING_PENALTY_POINTS,
  clampPercent,
  scoreLabel,
  getProviderPerformance,
};
