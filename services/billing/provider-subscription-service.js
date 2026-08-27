const PaymentOrder = require("../../models/PaymentOrder");
const ProviderSubscription = require("../../models/ProviderSubscription");
const CreditAllocation = require("../../models/CreditAllocation");
const Provider = require("../../models/Provider");
const {
  getPagination,
  normalizeSort,
  decodeCursor,
  buildCursorCondition,
  encodeCursor,
} = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  enumValue,
  queryTextValue,
  tokenValue,
  validationError,
} = require("../../utils/validation");

const STATUSES = Object.freeze(["completed", "active", "scheduled", "expired", "cancelled", "failed"]);
const BILLING_CYCLES = Object.freeze(["monthly", "quarterly", "half_yearly", "yearly", "annual"]);
const PURCHASE_PURPOSES = Object.freeze(["credit_purchase", "plan_purchase"]);

function escapeRegex(value) {
  return String(value || "").replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function searchPattern(value) {
  const normalized = String(value || "").trim();
  const exactContact = /^[6-9]\d{9}$/.test(normalized) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized);
  return new RegExp((exactContact ? "^" : "^") + escapeRegex(normalized) + (exactContact ? "$" : ""), "i");
}

function effectiveStatus(row, now = new Date()) {
  if (row?.recordType === "credit_package" || row?.purpose === "credit_purchase") return "completed";
  const status = String(row?.subscription?.status || row?.status || "").trim().toLowerCase();
  const startsAt = row?.subscription?.startsAt || row?.startsAt;
  const expiresAt = row?.subscription?.expiresAt || row?.expiresAt;
  if (["cancelled", "failed"].includes(status)) return status;
  if (!row?.subscription && !startsAt && !expiresAt) return "completed";
  if (expiresAt && new Date(expiresAt) <= now) return "expired";
  if (startsAt && new Date(startsAt) > now) return "scheduled";
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

function creditsFromMinor(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
}

function presentPurchase(row = {}) {
  const subscription = row.subscription || null;
  const allocation = row.allocation || null;
  const isCreditPackage = row.purpose === "credit_purchase";
  const providerSubscriptionId = subscription?.providerSubscriptionId || "";
  const paymentOrderId = row.paymentOrderId || "";
  const totalCredits = Number(
    (isCreditPackage ? row.totalCredits : subscription?.totalCredits) || row.totalCredits || 0,
  );

  return {
    _id: row._id,
    recordId: isCreditPackage ? paymentOrderId : (providerSubscriptionId || paymentOrderId),
    recordType: isCreditPackage ? "credit_package" : "legacy_subscription",
    providerSubscriptionId,
    paymentOrderId,
    providerId: row.providerId || "",
    provider: row.provider || null,
    planCode: (isCreditPackage ? row.planCode : subscription?.planCode) || row.planCode || "",
    planName: (isCreditPackage ? row.planName : subscription?.planName) || row.planName || "",
    billingCycle: isCreditPackage ? "" : (subscription?.billingCycle || row.billingCycle || ""),
    status: effectiveStatus({ ...row, subscription }),
    startsAt: isCreditPackage ? null : (subscription?.startsAt || null),
    expiresAt: isCreditPackage ? null : (subscription?.expiresAt || null),
    purchasedAt: row.purchasedAt || row.fulfilledAt || row.paidAt || row.createdAt || null,
    listedPricePaise: Number((isCreditPackage ? row.listedPricePaise : subscription?.listedPricePaise) || row.listedPricePaise || 0),
    subtotalPaise: Number((isCreditPackage ? row.subtotalPaise : subscription?.subtotalPaise) || row.subtotalPaise || 0),
    gstAmountPaise: Number((isCreditPackage ? row.gstAmountPaise : subscription?.gstAmountPaise) || row.gstAmountPaise || 0),
    totalAmountPaise: Number((isCreditPackage ? row.totalAmountPaise : subscription?.totalAmountPaise) || row.totalAmountPaise || row.amountPaise || 0),
    gstIncluded: isCreditPackage ? row.gstIncluded === true : subscription?.gstIncluded === true,
    baseCredits: Number((isCreditPackage ? row.baseCredits : subscription?.baseCredits) || row.baseCredits || 0),
    bonusCredits: Number((isCreditPackage ? row.bonusCredits : subscription?.bonusCredits) || row.bonusCredits || 0),
    totalCredits,
    remainingCredits: isCreditPackage && allocation
      ? creditsFromMinor(allocation.remainingMinorCredits)
      : null,
    allocationStatus: isCreditPackage ? String(allocation?.status || "") : "",
    allocationId: isCreditPackage ? String(allocation?.creditAllocationId || "") : "",
    purpose: row.purpose || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function basePurchaseQuery(filters = {}) {
  const query = {
    purpose: { $in: PURCHASE_PURPOSES },
    status: "paid",
    fulfilled: true,
  };
  if (filters.billingCycle) {
    query.billingCycle = enumValue(filters.billingCycle, BILLING_CYCLES, { label: "Billing cycle" });
  }
  if (filters.planCode) {
    query.planCode = tokenValue(filters.planCode, { label: "Plan code", maxLength: 80, lowercase: true });
  }
  return query;
}

function pipelineLookups() {
  return [
    {
      $lookup: {
        from: ProviderSubscription.collection.collectionName,
        localField: "paymentOrderId",
        foreignField: "paymentOrderId",
        as: "subscriptionRows",
      },
    },
    { $set: { subscription: { $arrayElemAt: ["$subscriptionRows", 0] } } },
    {
      $lookup: {
        from: CreditAllocation.collection.collectionName,
        localField: "paymentOrderId",
        foreignField: "paymentOrderId",
        as: "allocationRows",
      },
    },
    { $set: { allocation: { $arrayElemAt: ["$allocationRows", 0] } } },
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
      $set: {
        purchasedAt: { $ifNull: ["$fulfilledAt", { $ifNull: ["$paidAt", "$createdAt"] }] },
        startsAt: "$subscription.startsAt",
        expiresAt: "$subscription.expiresAt",
        providerSubscriptionId: { $ifNull: ["$subscription.providerSubscriptionId", ""] },
        recordType: {
          $cond: [{ $eq: ["$purpose", "credit_purchase"] }, "credit_package", "legacy_subscription"],
        },
      },
    },
    {
      $set: {
        effectiveStatus: {
          $switch: {
            branches: [
              { case: { $eq: ["$purpose", "credit_purchase"] }, then: "completed" },
              { case: { $in: ["$subscription.status", ["cancelled", "failed"]] }, then: "$subscription.status" },
              {
                case: { $eq: [{ $ifNull: ["$subscription.providerSubscriptionId", ""] }, ""] },
                then: "completed",
              },
              {
                case: {
                  $and: [
                    { $ne: ["$subscription.expiresAt", null] },
                    { $lte: ["$subscription.expiresAt", "$$NOW"] },
                  ],
                },
                then: "expired",
              },
              {
                case: {
                  $and: [
                    { $ne: ["$subscription.startsAt", null] },
                    { $gt: ["$subscription.startsAt", "$$NOW"] },
                  ],
                },
                then: "scheduled",
              },
            ],
            default: "active",
          },
        },
      },
    },
  ];
}

function buildPostQuery(filters = {}) {
  const query = {};
  if (filters.status) {
    query.effectiveStatus = enumValue(filters.status, STATUSES, { label: "Purchase status" });
  }
  applyDateRange(query, filters, {
    fields: {
      purchasedAt: "Purchase date",
      startsAt: "Start date",
      expiresAt: "Expiry date",
      updatedAt: "Updated date",
    },
    defaultField: "purchasedAt",
  });
  return query;
}

function buildSort(filters = {}) {
  return dateSort(filters, {
    fields: ["purchasedAt", "startsAt", "expiresAt", "updatedAt"],
    defaultField: "purchasedAt",
  });
}

function searchMatch(q) {
  if (!q) return null;
  const search = searchPattern(q);
  return {
    $or: [
      { paymentOrderId: search },
      { providerSubscriptionId: search },
      { planName: search },
      { planCode: search },
      { "subscription.planName": search },
      { "subscription.planCode": search },
      { "provider.providerId": search },
      { "provider.name": search },
      { "provider.businessName": search },
      { "provider.mobile": search },
      { "provider.email": search },
    ],
  };
}

async function list(filters = {}) {
  await reconcileStatuses();
  const { limit, cursor } = getPagination(filters);
  const q = queryTextValue(filters.q, { label: "Purchase search", maxLength: 100 });
  const sort = normalizeSort(buildSort(filters));
  const cursorValues = decodeCursor(cursor, sort);
  const cursorCondition = buildCursorCondition(sort, cursorValues);
  const postQuery = buildPostQuery(filters);
  const searchQuery = searchMatch(q);

  const pipeline = [
    { $match: basePurchaseQuery(filters) },
    ...pipelineLookups(),
    ...(Object.keys(postQuery).length ? [{ $match: postQuery }] : []),
    ...(searchQuery ? [{ $match: searchQuery }] : []),
    ...(cursorCondition ? [{ $match: cursorCondition }] : []),
    { $sort: sort },
    { $limit: limit + 1 },
    { $unset: ["subscriptionRows", "allocationRows", "providerRows"] },
  ];

  const rows = await PaymentOrder.aggregate(pipeline)
    .allowDiskUse(false)
    .option({ maxTimeMS: Math.min(Math.max(Number(process.env.CRM_QUERY_MAX_TIME_MS || 10000), 1000), 60000) });

  const hasNext = rows.length > limit;
  const dataRows = hasNext ? rows.slice(0, limit) : rows;
  return {
    data: dataRows.map(presentPurchase),
    pagination: {
      limit,
      returned: dataRows.length,
      hasNext,
      nextCursor: hasNext && dataRows.length ? encodeCursor(dataRows[dataRows.length - 1], sort) : "",
    },
  };
}

async function get(recordId) {
  const id = String(recordId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(id)) throw validationError("Purchase ID is invalid");

  const rows = await PaymentOrder.aggregate([
    { $match: basePurchaseQuery({}) },
    ...pipelineLookups(),
    {
      $match: {
        $or: [
          { paymentOrderId: id },
          { providerSubscriptionId: id },
        ],
      },
    },
    { $limit: 1 },
    { $unset: ["subscriptionRows", "allocationRows", "providerRows"] },
  ])
    .allowDiskUse(false)
    .option({ maxTimeMS: Math.min(Math.max(Number(process.env.CRM_QUERY_MAX_TIME_MS || 10000), 1000), 60000) });

  if (!rows.length) throw Object.assign(new Error("Provider purchase not found"), { status: 404 });
  return presentPurchase(rows[0]);
}

module.exports = {
  list,
  get,
  reconcileStatuses,
  effectiveStatus,
  presentPurchase,
  STATUSES,
  BILLING_CYCLES,
  PURCHASE_PURPOSES,
};
