const ProviderSubscription = require("../../models/ProviderSubscription");
const Provider = require("../../models/Provider");
const {
  getPagination,
  cursorPaginate,
  normalizeSort,
  decodeCursor,
  buildCursorCondition,
  encodeCursor,
  mergeQuery,
} = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  enumValue,
  queryTextValue,
  tokenValue,
  validationError,
} = require("../../utils/validation");

const STATUSES = Object.freeze(["active", "scheduled", "expired", "cancelled", "failed"]);
const BILLING_CYCLES = Object.freeze(["monthly", "quarterly", "half_yearly", "yearly", "annual"]);

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchPattern(value) {
  const normalized = String(value || "").trim();
  const exactContact = /^[6-9]\d{9}$/.test(normalized) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized);
  return new RegExp(`${exactContact ? "^" : "^"}${escapeRegex(normalized)}${exactContact ? "$" : ""}`, "i");
}

async function searchedList({ query, q, sort, limit, cursor }) {
  const normalizedSort = normalizeSort(sort);
  const cursorValues = decodeCursor(cursor, normalizedSort);
  const cursorCondition = buildCursorCondition(normalizedSort, cursorValues);
  const search = searchPattern(q);
  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: Provider.collection.collectionName,
        localField: "providerId",
        foreignField: "providerId",
        as: "providerRows",
      },
    },
    { $set: { provider: { $arrayElemAt: ["$providerRows", 0] } } },
    {
      $match: {
        $or: [
          { providerSubscriptionId: search },
          { paymentOrderId: search },
          { planName: search },
          { planCode: search },
          { "provider.providerId": search },
          { "provider.name": search },
          { "provider.businessName": search },
          { "provider.mobile": search },
          { "provider.email": search },
        ],
      },
    },
    ...(cursorCondition ? [{ $match: cursorCondition }] : []),
    { $sort: normalizedSort },
    { $limit: limit + 1 },
    { $unset: "providerRows" },
  ];
  const rows = await ProviderSubscription.aggregate(pipeline)
    .allowDiskUse(false)
    .option({ maxTimeMS: Math.min(Math.max(Number(process.env.CRM_QUERY_MAX_TIME_MS || 10000), 1000), 60000) });
  const hasNext = rows.length > limit;
  const data = hasNext ? rows.slice(0, limit) : rows;
  return {
    data: data.map((row) => ({ ...row, status: effectiveStatus(row), provider: row.provider || null })),
    pagination: {
      limit,
      returned: data.length,
      hasNext,
      nextCursor: hasNext && data.length ? encodeCursor(data[data.length - 1], normalizedSort) : "",
    },
  };
}

function effectiveStatus(row, now = new Date()) {
  const startsAt = row.startsAt ? new Date(row.startsAt) : null;
  const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
  if (["cancelled", "failed"].includes(row.status)) return row.status;
  if (expiresAt && expiresAt <= now) return "expired";
  if (startsAt && startsAt > now) return "scheduled";
  return "active";
}

async function reconcileStatuses() {
  const now = new Date();
  await Promise.all([
    ProviderSubscription.updateMany(
      { status: { $in: ["active", "scheduled"] }, expiresAt: { $lte: now } },
      { $set: { status: "expired", updatedAt: now } },
    ),
    ProviderSubscription.updateMany(
      { status: "scheduled", startsAt: { $lte: now }, expiresAt: { $gt: now } },
      { $set: { status: "active", updatedAt: now } },
    ),
  ]);
}

async function list(filters = {}) {
  await reconcileStatuses();
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = enumValue(filters.status, STATUSES, { label: "Subscription status" });
  if (filters.billingCycle) {
    query.billingCycle = enumValue(filters.billingCycle, BILLING_CYCLES, { label: "Billing cycle" });
  }
  if (filters.planCode) {
    query.planCode = tokenValue(filters.planCode, { label: "Plan code", maxLength: 80, lowercase: true });
  }
  const q = queryTextValue(filters.q, { label: "Subscription search", maxLength: 100 });
  applyDateRange(query, filters, {
    fields: {
      purchasedAt: "Purchase date",
      startsAt: "Start date",
      expiresAt: "Expiry date",
      createdAt: "Created date",
      updatedAt: "Updated date",
    },
    defaultField: "purchasedAt",
  });
  const sort = dateSort(filters, {
    fields: ["purchasedAt", "startsAt", "expiresAt", "createdAt", "updatedAt"],
    defaultField: "purchasedAt",
  });
  if (q) return searchedList({ query, q, sort, limit, cursor });
  const result = await cursorPaginate(ProviderSubscription, { query, sort, limit, cursor });
  const ids = [...new Set(result.data.map((row) => row.providerId).filter(Boolean))];
  const providers = ids.length
    ? await Provider.find({ providerId: { $in: ids } }).select({ providerId: 1, name: 1, businessName: 1, mobile: 1, email: 1 }).lean()
    : [];
  const map = new Map(providers.map((row) => [row.providerId, row]));
  return {
    ...result,
    data: result.data.map((row) => ({
      ...row,
      status: effectiveStatus(row),
      provider: map.get(row.providerId) || null,
    })),
  };
}

async function get(providerSubscriptionId) {
  const id = String(providerSubscriptionId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(id)) throw validationError("Subscription ID is invalid");
  const row = await ProviderSubscription.findOne({ providerSubscriptionId: id }).lean();
  if (!row) throw Object.assign(new Error("Provider subscription not found"), { status: 404 });
  const provider = await Provider.findOne({ providerId: row.providerId }).lean();
  return { ...row, status: effectiveStatus(row), provider };
}

module.exports = { list, get, reconcileStatuses, effectiveStatus, STATUSES, BILLING_CYCLES };
