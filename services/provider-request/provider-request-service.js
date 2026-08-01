const crypto = require("crypto");
const ProviderJoinRequest = require("../../models/ProviderJoinRequest");
const Provider = require("../../models/Provider");
const Category = require("../../models/Category");
const providerService = require("../provider/provider-service");
const { withTransaction } = require("../../utils/transaction");
const { releaseEntityContacts } = require("../contact-identity/contact-identity-service");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  enumValue,
  humanTextValue,
  identifierValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");

const STATUSES = Object.freeze(["new", "contacted", "converted", "rejected"]);
const OPEN_STATUSES = Object.freeze(["new", "contacted"]);
const CONVERSION_LOCK_TTL_MS = 10 * 60 * 1000;

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requestQuery(providerJoinRequestId) {
  return { providerJoinRequestId: identifierValue(providerJoinRequestId, { label: "Provider request ID" }) };
}

function actorValue(actor) {
  return actor?.email || actor?.employeeId || actor?.mobile || actor?.name || "crm-admin";
}

function present(row = {}) {
  return {
    ...row,
    providerJoinRequestId: row.providerJoinRequestId || row.id || "",
  };
}

async function metadata() {
  const categories = await Category.find({ active: { $ne: false } })
    .select({ categoryId: 1, name: 1, slug: 1 })
    .sort({ name: 1, _id: 1 })
    .limit(500)
    .lean();
  return { statuses: STATUSES, categories };
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) {
    query.status = enumValue(filters.status, STATUSES, { label: "Provider request status" });
  }
  if (filters.categorySlug) {
    query.categorySlug = identifierValue(filters.categorySlug, { label: "Category" });
  }
  const q = queryTextValue(filters.q, { label: "Provider request search", maxLength: 120 });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["providerJoinRequestId"],
      phoneFields: ["normalizedMobile", "mobile", "normalizedWhatsappNumber", "whatsappNumber"],
      emailFields: ["normalizedEmail", "email"],
      prefixFields: ["name", "businessName", "city", "servicePincode"],
    });
  }
  applyDateRange(query, filters, {
    fields: { createdAt: "Submitted date", updatedAt: "Updated date" },
    defaultField: "createdAt",
  });
  const result = await cursorPaginate(ProviderJoinRequest, {
    query,
    sort: dateSort(filters, { fields: ["createdAt", "updatedAt"], defaultField: "createdAt" }),
    limit,
    cursor,
  });
  return { ...result, data: result.data.map(present) };
}

async function get(providerJoinRequestId) {
  const row = await ProviderJoinRequest.findOne(requestQuery(providerJoinRequestId)).lean();
  if (!row) throw Object.assign(new Error("Provider joining request not found"), { status: 404 });
  return present(row);
}

async function updateStatus(providerJoinRequestId, input = {}, actor) {
  const current = await get(providerJoinRequestId);
  const status = enumValue(input.status, ["contacted", "rejected"], {
    label: "Provider request status",
  });
  if (current.status === "converted") {
    throw Object.assign(new Error("Converted provider requests cannot be changed"), { status: 409 });
  }
  if (current.status === "rejected") {
    throw Object.assign(new Error("Rejected provider requests cannot be changed"), { status: 409 });
  }
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
  if (current.conversionLockAt && new Date(current.conversionLockAt) >= staleBefore) {
    throw Object.assign(new Error("This provider request is currently being converted"), { status: 409 });
  }
  const internalNote = humanTextValue(input.internalNote ?? current.internalNote, {
    label: "Internal note",
    required: status === "rejected",
    maxLength: 2000,
    preserveWhitespace: true,
  });
  const set = {
    status,
    internalNote,
    processedBy: actorValue(actor),
    updatedAt: now,
    conversionLockAt: null,
    conversionLockBy: "",
  };
  if (status === "contacted") {
    set.contactedAt = current.contactedAt || now;
    set.rejectedAt = null;
  } else {
    set.rejectedAt = now;
  }
  const result = await ProviderJoinRequest.updateOne(
    {
      ...requestQuery(providerJoinRequestId),
      status: { $in: OPEN_STATUSES },
      $or: [
        { conversionLockAt: null },
        { conversionLockAt: { $exists: false } },
        { conversionLockAt: { $lt: staleBefore } },
      ],
    },
    { $set: set },
  );
  if (!result.modifiedCount) {
    throw Object.assign(new Error("This provider request changed while you were updating it"), { status: 409 });
  }
  console.log(`Provider joining request ${providerJoinRequestId} marked ${status}`);
  return get(providerJoinRequestId);
}

async function markConverted(providerJoinRequestId, providerId, actor, lockToken) {
  const updated = await withTransaction(async (session) => {
    const now = new Date();
    const row = await ProviderJoinRequest.findOneAndUpdate(
      {
        ...requestQuery(providerJoinRequestId),
        status: { $in: OPEN_STATUSES },
        conversionLockBy: lockToken,
      },
      {
        $set: {
          status: "converted",
          convertedProviderId: providerId,
          convertedAt: now,
          processedBy: actorValue(actor),
          conversionLockAt: null,
          conversionLockBy: "",
          updatedAt: now,
        },
      },
      { new: true, runValidators: true, session },
    ).lean();
    if (row) {
      await releaseEntityContacts("provider_join_request", providerJoinRequestId, session);
    }
    return row;
  }, { operationLabel: "Provider request conversion" });
  if (updated) return present(updated);
  const current = await get(providerJoinRequestId);
  if (current.status === "converted" && current.convertedProviderId === providerId) return current;
  throw Object.assign(new Error("This provider request is no longer available for conversion"), { status: 409 });
}

async function convert(providerJoinRequestId, input = {}, actor) {
  const initial = await get(providerJoinRequestId);
  if (initial.status === "converted") {
    const provider = initial.convertedProviderId
      ? await Provider.findOne({ providerId: initial.convertedProviderId }).lean()
      : null;
    if (provider) return { provider: providerService.presentProvider(provider), request: initial, existing: true };
    throw Object.assign(new Error("This provider request has already been converted"), { status: 409 });
  }
  if (initial.status === "rejected") {
    throw Object.assign(new Error("Rejected provider requests cannot be converted"), { status: 409 });
  }

  const now = new Date();
  const lockToken = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
  const request = await ProviderJoinRequest.findOneAndUpdate(
    {
      ...requestQuery(providerJoinRequestId),
      status: { $in: OPEN_STATUSES },
      $or: [
        { conversionLockAt: null },
        { conversionLockAt: { $exists: false } },
        { conversionLockAt: { $lt: staleBefore } },
      ],
    },
    { $set: { conversionLockAt: now, conversionLockBy: lockToken, processedBy: actorValue(actor) } },
    { new: true },
  ).lean();
  if (!request) {
    throw Object.assign(new Error("This provider request is already being processed"), { status: 409 });
  }

  try {
    const phoneValues = [...new Set([
      request.normalizedMobile,
      request.mobile,
      request.normalizedWhatsappNumber,
      request.whatsappNumber,
    ].filter(Boolean))];
    const emailValue = String(request.normalizedEmail || request.email || "").trim().toLowerCase();
    const providerMatches = [];
    if (phoneValues.length) {
      for (const field of ["normalizedMobile", "mobile", "normalizedWhatsappNumber", "whatsappNumber"]) {
        providerMatches.push({ [field]: { $in: phoneValues } });
      }
    }
    if (emailValue) providerMatches.push({ $or: [{ normalizedEmail: emailValue }, { email: emailValue }] });
    const existing = providerMatches.length
      ? await Provider.findOne({ $or: providerMatches }).lean()
      : null;
    if (existing) {
      const updatedRequest = await markConverted(providerJoinRequestId, existing.providerId, actor, lockToken);
      return { provider: providerService.presentProvider(existing), request: updatedRequest, existing: true };
    }

    const provider = await providerService.create(input, actorValue(actor), {
      allowedProviderJoinRequestId: request.providerJoinRequestId,
    });
    const updatedRequest = await markConverted(providerJoinRequestId, provider.providerId, actor, lockToken);
    console.log(`Provider joining request ${providerJoinRequestId} converted to provider ${provider.providerId}`);
    return { provider, request: updatedRequest, existing: false };
  } catch (error) {
    await ProviderJoinRequest.updateOne(
      { ...requestQuery(providerJoinRequestId), conversionLockBy: lockToken },
      { $set: { conversionLockAt: null, conversionLockBy: "" } },
    ).catch(() => {});
    throw error;
  }
}

module.exports = { metadata, list, get, updateStatus, convert, present, STATUSES, OPEN_STATUSES };
