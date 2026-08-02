"use strict";

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
const MUTABLE_STATUSES = Object.freeze(["new", "contacted", "rejected"]);
const CONVERSION_LOCK_TTL_MS = 10 * 60 * 1000;
const STATUS_HISTORY_LIMIT = 50;

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
    statusHistory: Array.isArray(row.statusHistory) ? row.statusHistory : [],
  };
}

function statusHistoryEntry(fromStatus, toStatus, note, actor, changedAt = new Date()) {
  return {
    fromStatus: String(fromStatus || ""),
    toStatus: String(toStatus || ""),
    note: String(note || "").trim(),
    changedBy: actorValue(actor),
    changedAt,
  };
}

function transitionHistory(current, toStatus, note, actor) {
  const entries = [];
  const history = Array.isArray(current.statusHistory) ? current.statusHistory : [];
  const hasRecordedRejection = history.some((entry) => entry?.toStatus === "rejected");
  if (current.status === "rejected" && !hasRecordedRejection && current.internalNote) {
    entries.push(statusHistoryEntry(
      "",
      "rejected",
      current.internalNote,
      current.processedBy || actor,
      current.rejectedAt || current.updatedAt || current.createdAt || new Date(),
    ));
  }
  entries.push(statusHistoryEntry(current.status, toStatus, note, actor));
  return entries;
}

function historyPush(entries) {
  return { $each: entries, $slice: -STATUS_HISTORY_LIMIT };
}

function activeConversionLock(row, now = new Date()) {
  if (!row?.conversionLockAt) return false;
  return new Date(row.conversionLockAt) >= new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
}

function maskedMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `******${digits.slice(-4)}` : "not-recorded";
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
  const status = enumValue(input.status, MUTABLE_STATUSES, {
    label: "Provider request status",
  });
  if (current.status === "converted") {
    throw Object.assign(new Error("Converted provider requests cannot be changed"), { status: 409 });
  }
  if (status === current.status) {
    throw validationError("Select a different provider request status");
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
  if (activeConversionLock(current, now)) {
    throw Object.assign(new Error("This provider request is currently being converted"), { status: 409 });
  }

  let internalNote;
  if (current.status === "rejected" && status !== "rejected") {
    internalNote = humanTextValue(input.internalNote, {
      label: "Reopening note",
      required: true,
      maxLength: 2000,
      preserveWhitespace: true,
    });
    if (internalNote.trim() === String(current.internalNote || "").trim()) {
      throw validationError("Update the internal note to explain why this rejected request is being reopened");
    }
  } else {
    internalNote = humanTextValue(input.internalNote ?? current.internalNote, {
      label: "Internal note",
      required: status === "rejected",
      maxLength: 2000,
      preserveWhitespace: true,
    });
  }

  const set = {
    status,
    internalNote,
    processedBy: actorValue(actor),
    updatedAt: now,
    conversionLockAt: null,
    conversionLockBy: "",
  };
  if (status === "contacted") {
    set.contactedAt = now;
    set.rejectedAt = null;
  } else if (status === "new") {
    set.contactedAt = null;
    set.rejectedAt = null;
  } else {
    set.rejectedAt = now;
  }

  let result;
  try {
    result = await ProviderJoinRequest.updateOne(
      {
        ...requestQuery(providerJoinRequestId),
        status: current.status,
        $or: [
          { conversionLockAt: null },
          { conversionLockAt: { $exists: false } },
          { conversionLockAt: { $lt: staleBefore } },
        ],
      },
      {
        $set: set,
        $push: {
          statusHistory: historyPush(transitionHistory(current, status, internalNote, actor)),
        },
      },
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw Object.assign(new Error("Another open provider request already uses this mobile number"), {
        status: 409,
        code: "PROVIDER_REQUEST_CONTACT_CONFLICT",
      });
    }
    throw error;
  }
  if (!result.modifiedCount) {
    throw Object.assign(new Error("This provider request changed while you were updating it"), { status: 409 });
  }
  console.log(`Provider joining request ${providerJoinRequestId} changed from ${current.status} to ${status}`);
  return get(providerJoinRequestId);
}

async function markConverted(request, providerId, actor, lockToken, transitionNote = "") {
  const providerJoinRequestId = request.providerJoinRequestId;
  const updated = await withTransaction(async (session) => {
    const now = new Date();
    const row = await ProviderJoinRequest.findOneAndUpdate(
      {
        ...requestQuery(providerJoinRequestId),
        status: request.status,
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
        $push: {
          statusHistory: historyPush(transitionHistory(
            request,
            "converted",
            transitionNote || "Provider account created from this request",
            actor,
          )),
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

  let reopenNote = "";
  if (initial.status === "rejected") {
    reopenNote = humanTextValue(input.reopenNote, {
      label: "Reopening note",
      required: true,
      maxLength: 2000,
      preserveWhitespace: true,
    });
    if (reopenNote.trim() === String(initial.internalNote || "").trim()) {
      throw validationError("Add a new note explaining why this rejected request is being converted");
    }
  }

  const now = new Date();
  const lockToken = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
  const request = await ProviderJoinRequest.findOneAndUpdate(
    {
      ...requestQuery(providerJoinRequestId),
      status: initial.status,
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
    const normalizedEmail = String(request.normalizedEmail || request.email || "").trim().toLowerCase();
    const providerMatches = [];
    if (phoneValues.length) {
      for (const field of ["normalizedMobile", "mobile", "normalizedWhatsappNumber", "whatsappNumber"]) {
        providerMatches.push({ [field]: { $in: phoneValues } });
      }
    }
    if (normalizedEmail) providerMatches.push({ $or: [{ normalizedEmail }, { email: normalizedEmail }] });
    const existing = providerMatches.length
      ? await Provider.findOne({ $or: providerMatches }).lean()
      : null;
    if (existing) {
      const updatedRequest = await markConverted(
        request,
        existing.providerId,
        actor,
        lockToken,
        reopenNote || "Request linked to an existing provider account",
      );
      return { provider: providerService.presentProvider(existing), request: updatedRequest, existing: true };
    }

    const provider = await providerService.create(input, actorValue(actor), {
      allowedProviderJoinRequestId: request.providerJoinRequestId,
    });
    const updatedRequest = await markConverted(
      request,
      provider.providerId,
      actor,
      lockToken,
      reopenNote || "Provider account created from this request",
    );
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

async function remove(providerJoinRequestId, actor) {
  const deleted = await withTransaction(async (session) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CONVERSION_LOCK_TTL_MS);
    const row = await ProviderJoinRequest.findOne(requestQuery(providerJoinRequestId)).session(session).lean();
    if (!row) throw Object.assign(new Error("Provider joining request not found"), { status: 404 });
    if (row.status === "converted") {
      throw Object.assign(new Error("Converted provider requests are retained for audit history and cannot be deleted"), {
        status: 409,
      });
    }
    if (activeConversionLock(row, now)) {
      throw Object.assign(new Error("This provider request is currently being converted"), { status: 409 });
    }

    const result = await ProviderJoinRequest.deleteOne(
      {
        ...requestQuery(providerJoinRequestId),
        status: { $ne: "converted" },
        $or: [
          { conversionLockAt: null },
          { conversionLockAt: { $exists: false } },
          { conversionLockAt: { $lt: staleBefore } },
        ],
      },
      { session },
    );
    if (!result.deletedCount) {
      throw Object.assign(new Error("This provider request changed while it was being deleted"), { status: 409 });
    }
    await releaseEntityContacts("provider_join_request", providerJoinRequestId, session);
    return row;
  }, { operationLabel: "Provider request deletion" });

  console.log(`Provider joining request ${providerJoinRequestId} permanently deleted by ${actorValue(actor)}; previous status=${deleted.status}; mobile=${maskedMobile(deleted.mobile)}`);
  return {
    providerJoinRequestId,
    name: deleted.name || "",
    previousStatus: deleted.status || "",
  };
}

module.exports = {
  metadata,
  list,
  get,
  updateStatus,
  convert,
  remove,
  present,
  STATUSES,
  OPEN_STATUSES,
  MUTABLE_STATUSES,
};
