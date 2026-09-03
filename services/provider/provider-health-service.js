"use strict";

const Provider = require("../../models/Provider");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { creditsFromPaise } = require("../../utils/credits");

const LOW_CREDIT_THRESHOLD_CREDITS = 300;
const LOW_CREDIT_THRESHOLD_PAISE = LOW_CREDIT_THRESHOLD_CREDITS * 100;
const ACTIVITY_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const VIEWS = Object.freeze(["low_credits", "frequent_unlockers", "idle"]);

function queryMaxTimeMS() {
  return Math.min(Math.max(Number(process.env.CRM_QUERY_MAX_TIME_MS || 10000), 1000), 60000);
}

function normalizeView(value) {
  const normalized = String(value || "low_credits").trim().toLowerCase();
  return VIEWS.includes(normalized) ? normalized : "low_credits";
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 10), MAX_LIMIT);
}

function activityCutoff(now = new Date()) {
  const reference = now instanceof Date ? now : new Date(now);
  return new Date(reference.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function activeProviderMatch() {
  return { status: "active", portalAccessEnabled: { $ne: false } };
}

function lowCreditMatch() {
  return {
    ...activeProviderMatch(),
    $or: [
      { walletBalancePaise: { $lt: LOW_CREDIT_THRESHOLD_PAISE } },
      { walletBalancePaise: { $exists: false } },
    ],
  };
}

function providerProjection() {
  return {
    providerId: 1,
    id: 1,
    name: 1,
    businessName: 1,
    mobile: 1,
    email: 1,
    city: 1,
    state: 1,
    walletBalancePaise: 1,
    currentPlanCode: 1,
    currentPlanName: 1,
    currentPlanExpiresAt: 1,
    lastLoginAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function presentProvider(provider = {}, metrics = {}) {
  const walletBalancePaise = Math.max(0, Number(provider.walletBalancePaise || 0));
  return {
    providerId: String(provider.providerId || provider.id || ""),
    name: String(provider.name || ""),
    businessName: String(provider.businessName || ""),
    mobile: String(provider.mobile || ""),
    email: String(provider.email || ""),
    city: String(provider.city || ""),
    state: String(provider.state || ""),
    walletBalancePaise,
    walletBalanceCredits: creditsFromPaise(walletBalancePaise),
    currentPlanCode: String(provider.currentPlanCode || ""),
    currentPlanName: String(provider.currentPlanName || ""),
    currentPlanExpiresAt: provider.currentPlanExpiresAt || null,
    lastLoginAt: provider.lastLoginAt || null,
    createdAt: provider.createdAt || null,
    unlockCount30d: Math.max(0, Number(metrics.unlockCount30d || 0)),
    lastUnlockAt: metrics.lastUnlockAt || null,
  };
}

async function unlockMetricsForProviders(providerIds, cutoff) {
  if (!providerIds.length) return new Map();
  const rows = await ProviderLeadUnlock.aggregate([
    { $match: { providerId: { $in: providerIds } } },
    {
      $group: {
        _id: "$providerId",
        unlockCount30d: {
          $sum: { $cond: [{ $gte: ["$unlockedAt", cutoff] }, 1, 0] },
        },
        lastUnlockAt: { $max: "$unlockedAt" },
      },
    },
  ]).option({ maxTimeMS: queryMaxTimeMS() });
  return new Map(rows.map((row) => [String(row._id || ""), row]));
}

async function lowCreditRows(limit, cutoff) {
  const rows = await Provider.find(lowCreditMatch())
    .select(providerProjection())
    .sort({ walletBalancePaise: 1, updatedAt: -1, _id: 1 })
    .limit(limit)
    .maxTimeMS(queryMaxTimeMS())
    .lean();
  const providerIds = rows.map((row) => String(row.providerId || row.id || "")).filter(Boolean);
  const metrics = await unlockMetricsForProviders(providerIds, cutoff);
  return rows.map((row) => {
    const providerId = String(row.providerId || row.id || "");
    return presentProvider(row, metrics.get(providerId) || {});
  });
}

async function frequentUnlockerRows(limit, cutoff) {
  const rows = await ProviderLeadUnlock.aggregate([
    { $match: { unlockedAt: { $gte: cutoff } } },
    {
      $group: {
        _id: "$providerId",
        unlockCount30d: { $sum: 1 },
        lastUnlockAt: { $max: "$unlockedAt" },
      },
    },
    { $sort: { unlockCount30d: -1, lastUnlockAt: -1, _id: 1 } },
    {
      $lookup: {
        from: Provider.collection.collectionName,
        localField: "_id",
        foreignField: "providerId",
        as: "providerRows",
      },
    },
    { $set: { provider: { $arrayElemAt: ["$providerRows", 0] } } },
    {
      $match: {
        "provider.status": "active",
        "provider.portalAccessEnabled": { $ne: false },
      },
    },
    { $limit: limit },
    { $unset: "providerRows" },
  ]).option({ maxTimeMS: queryMaxTimeMS() });
  return rows.map((row) => presentProvider(row.provider || {}, row));
}

async function idleRows(limit, cutoff) {
  const rows = await Provider.aggregate([
    { $match: activeProviderMatch() },
    {
      $lookup: {
        from: ProviderLeadUnlock.collection.collectionName,
        let: { providerId: "$providerId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$providerId", "$$providerId"] },
                  { $gte: ["$unlockedAt", cutoff] },
                ],
              },
            },
          },
          { $sort: { unlockedAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, unlockedAt: 1 } },
        ],
        as: "recentUnlockRows",
      },
    },
    { $match: { $expr: { $eq: [{ $size: "$recentUnlockRows" }, 0] } } },
    {
      $lookup: {
        from: ProviderLeadUnlock.collection.collectionName,
        let: { providerId: "$providerId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$providerId", "$$providerId"] } } },
          { $sort: { unlockedAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, unlockedAt: 1 } },
        ],
        as: "lastUnlockRows",
      },
    },
    {
      $set: {
        lastUnlockAt: { $arrayElemAt: ["$lastUnlockRows.unlockedAt", 0] },
        unlockCount30d: 0,
      },
    },
    { $sort: { lastUnlockAt: 1, createdAt: 1, _id: 1 } },
    { $limit: limit },
    { $project: { ...providerProjection(), lastUnlockAt: 1, unlockCount30d: 1 } },
  ]).option({ maxTimeMS: queryMaxTimeMS() });
  return rows.map((row) => presentProvider(row, row));
}

async function recentActiveProviderCount(cutoff) {
  const rows = await ProviderLeadUnlock.aggregate([
    { $match: { unlockedAt: { $gte: cutoff } } },
    { $group: { _id: "$providerId" } },
    {
      $lookup: {
        from: Provider.collection.collectionName,
        localField: "_id",
        foreignField: "providerId",
        as: "providerRows",
      },
    },
    { $set: { provider: { $arrayElemAt: ["$providerRows", 0] } } },
    {
      $match: {
        "provider.status": "active",
        "provider.portalAccessEnabled": { $ne: false },
      },
    },
    { $count: "count" },
  ]).option({ maxTimeMS: queryMaxTimeMS() });
  return Math.max(0, Number(rows[0]?.count || 0));
}

async function summary(cutoff) {
  const [lowCreditCount, activeProviderCount, frequentUnlockerCount] = await Promise.all([
    Provider.countDocuments(lowCreditMatch()).maxTimeMS(queryMaxTimeMS()),
    Provider.countDocuments(activeProviderMatch()).maxTimeMS(queryMaxTimeMS()),
    recentActiveProviderCount(cutoff),
  ]);
  return {
    lowCreditCount: Math.max(0, Number(lowCreditCount || 0)),
    frequentUnlockerCount,
    idleProviderCount: Math.max(0, Number(activeProviderCount || 0) - frequentUnlockerCount),
    activeProviderCount: Math.max(0, Number(activeProviderCount || 0)),
    thresholdCredits: LOW_CREDIT_THRESHOLD_CREDITS,
    windowDays: ACTIVITY_WINDOW_DAYS,
  };
}

async function list(filters = {}, options = {}) {
  const view = normalizeView(filters.view);
  const limit = normalizeLimit(filters.limit);
  const cutoff = activityCutoff(options.now || new Date());
  const [rows, counts] = await Promise.all([
    view === "frequent_unlockers"
      ? frequentUnlockerRows(limit, cutoff)
      : view === "idle"
        ? idleRows(limit, cutoff)
        : lowCreditRows(limit, cutoff),
    summary(cutoff),
  ]);
  return {
    data: rows,
    summary: counts,
    meta: {
      view,
      limit,
      cutoff,
      thresholdCredits: LOW_CREDIT_THRESHOLD_CREDITS,
      windowDays: ACTIVITY_WINDOW_DAYS,
    },
  };
}

module.exports = {
  LOW_CREDIT_THRESHOLD_CREDITS,
  LOW_CREDIT_THRESHOLD_PAISE,
  ACTIVITY_WINDOW_DAYS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VIEWS,
  normalizeView,
  normalizeLimit,
  activityCutoff,
  activeProviderMatch,
  lowCreditMatch,
  presentProvider,
  list,
};
