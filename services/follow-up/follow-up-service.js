const FollowUp = require("../../models/FollowUp");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
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
    dueAt: dateTimeValue(input.dueAt ?? current.dueAt, {
      label: "Follow-up due date",
      required: false,
    }),
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
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { title: search },
      { customerName: search },
      { notes: search },
      { enquiryId: search },
    ];
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
  return FollowUp.create(normalizeFollowUpInput(input));
}

async function update(followUpId, input = {}) {
  const current = await get(followUpId);
  assertFollowUpIdUnchanged(current, input);
  const result = await FollowUp.updateOne(
    { followUpId: current.followUpId },
    {
      $set: {
        ...normalizeFollowUpInput(input, current),
        updatedAt: new Date(),
      },
    },
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
};
