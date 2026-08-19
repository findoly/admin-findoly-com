const FollowUp = require("../../models/FollowUp");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { parseIndiaDateTime } = require("../../utils/india-datetime");
const {
  textValue,
  enumValue,
  dateTimeValue,
  identifierValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");

const FOLLOW_UP_STATUSES = Object.freeze([
  "open",
  "pending",
  "completed",
  "cancelled",
]);
const FOLLOW_UP_CHANNELS = Object.freeze([
  "call",
  "whatsapp",
  "email",
  "visit",
]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionalIdentifier(value, label) {
  if (value === undefined || value === null || value === "") return "";
  return identifierValue(value, { label, required: false });
}

function followUpDateValue(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw validationError("Follow-up due date is invalid");
    return new Date(value.getTime());
  }
  const normalized = dateTimeValue(value, {
    label: "Follow-up due date",
    required: false,
  });
  if (!normalized) return null;
  const parsed = parseIndiaDateTime(normalized);
  if (!parsed) throw validationError("Follow-up due date is invalid");
  return parsed;
}

function normalizeFollowUpInput(input = {}, current = {}) {
  return {
    enquiryId: optionalIdentifier(
      input.enquiryId ?? current.enquiryId,
      "Requirement ID",
    ),
    customerName: textValue(input.customerName ?? current.customerName, {
      label: "Customer name",
      maxLength: 120,
    }),
    title: textValue(input.title ?? current.title, {
      label: "Follow-up title",
      required: true,
      maxLength: 200,
    }),
    dueAt: followUpDateValue(input.dueAt ?? current.dueAt),
    owner: textValue(input.owner ?? current.owner, {
      label: "Follow-up owner",
      fallback: "admin",
      maxLength: 120,
    }),
    channel: enumValue(input.channel, FOLLOW_UP_CHANNELS, {
      label: "Follow-up channel",
      fallback: current.channel || "call",
    }),
    status: enumValue(input.status, FOLLOW_UP_STATUSES, {
      label: "Follow-up status",
      fallback: current.status || "open",
    }),
    notes: textValue(input.notes ?? current.notes, {
      label: "Follow-up notes",
      maxLength: 5000,
    }),
  };
}

function assertFollowUpIdUnchanged(current, input = {}) {
  for (const field of ["followUpId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    const reference = String(current.followUpId || current.id || "");
    if (String(input[field]) !== reference) {
      throw validationError("Follow-up ID cannot be changed");
    }
  }
  if (
    input._id !== undefined &&
    input._id !== null &&
    String(input._id) !== String(current._id || "")
  ) {
    throw validationError("Follow-up database ID cannot be changed");
  }
}

function sameInstant(left, right) {
  const a = left ? new Date(left).getTime() : null;
  const b = right ? new Date(right).getTime() : null;
  return a === b;
}

function alertResetFields() {
  return {
    dueAlertStatus: "pending",
    dueAlertSentAt: null,
    dueAlertAttemptedAt: null,
    dueAlertAttempts: 0,
    dueAlertLastError: "",
  };
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) {
    query.status = enumValue(filters.status, FOLLOW_UP_STATUSES, {
      label: "Follow-up status filter",
    });
  }
  if (filters.enquiryId) {
    query.enquiryId = identifierValue(filters.enquiryId, {
      label: "Requirement ID filter",
    });
  }
  const q = queryTextValue(filters.q, {
    label: "Follow-up search",
    maxLength: 100,
  });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["followUpId", "enquiryId"],
      prefixFields: ["title", "customerName"],
    });
  }
  applyDateRange(query, filters, { fields: { dueAt: "Due date", createdAt: "Created date", updatedAt: "Updated date" }, defaultField: "dueAt" });
  return cursorPaginate(FollowUp, {
    query,
    sort: dateSort(filters, { fields: ["dueAt", "createdAt", "updatedAt"], defaultField: "dueAt" }),
    limit,
    cursor,
  });
}

async function get(followUpId) {
  const id = identifierValue(followUpId, { label: "Follow-up ID" });
  const followUp = await FollowUp.findOne({ followUpId: id }).lean();
  if (!followUp) {
    throw Object.assign(new Error("Follow-up not found"), { status: 404 });
  }
  return followUp;
}

async function create(input = {}) {
  const normalized = normalizeFollowUpInput(input);
  return FollowUp.create({
    ...normalized,
    completedAt: normalized.status === "completed" ? new Date() : null,
    ...alertResetFields(),
  });
}

async function update(followUpId, input = {}) {
  const current = await get(followUpId);
  assertFollowUpIdUnchanged(current, input);
  const normalized = normalizeFollowUpInput(input, current);
  const updateFields = {
    ...normalized,
    completedAt: normalized.status === "completed"
      ? (current.status === "completed" ? (current.completedAt || null) : new Date())
      : null,
    updatedAt: new Date(),
  };
  const dueChanged = !sameInstant(current.dueAt, normalized.dueAt);
  const reopened = ["completed", "cancelled"].includes(String(current.status || ""))
    && ["open", "pending"].includes(normalized.status);
  if (dueChanged || reopened) Object.assign(updateFields, alertResetFields());

  const result = await FollowUp.updateOne(
    { followUpId: current.followUpId },
    { $set: updateFields },
  );
  if (!result.matchedCount) {
    throw Object.assign(new Error("Follow-up not found"), { status: 404 });
  }
  return get(current.followUpId);
}

module.exports = {
  list,
  get,
  create,
  update,
  normalizeFollowUpInput,
  assertFollowUpIdUnchanged,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_CHANNELS,
  followUpDateValue,
  sameInstant,
  alertResetFields,
};
