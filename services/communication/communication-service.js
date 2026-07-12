const Communication = require("../../models/Communication");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const {
  textValue,
  emailValue,
  enumValue,
  identifierValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");

const COMMUNICATION_CHANNELS = Object.freeze([
  "call",
  "whatsapp",
  "email",
  "sms",
]);
const COMMUNICATION_DIRECTIONS = Object.freeze(["outbound", "inbound"]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionalIdentifier(value, label) {
  if (value === undefined || value === null || value === "") return "";
  return identifierValue(value, { label, required: false });
}

function normalizeRecipientContact(value, channel) {
  const contact = textValue(value, {
    label: "Recipient contact",
    maxLength: 254,
  });
  if (!contact) return "";
  if (channel === "email") {
    return emailValue(contact, { label: "Recipient email" });
  }
  return validateMobile(contact, {
    label: "Recipient mobile number",
    required: false,
  });
}

function normalizeCommunicationInput(input = {}, current = {}) {
  const channel = enumValue(input.channel, COMMUNICATION_CHANNELS, {
    label: "Communication channel",
    fallback: current.channel || "call",
  });
  return {
    enquiryId: optionalIdentifier(
      input.enquiryId ?? current.enquiryId,
      "Requirement ID",
    ),
    providerId: optionalIdentifier(
      input.providerId ?? current.providerId,
      "Provider ID",
    ),
    recipientName: textValue(input.recipientName ?? current.recipientName, {
      label: "Recipient name",
      maxLength: 120,
    }),
    recipientContact: normalizeRecipientContact(
      input.recipientContact ?? current.recipientContact,
      channel,
    ),
    channel,
    direction: enumValue(input.direction, COMMUNICATION_DIRECTIONS, {
      label: "Communication direction",
      fallback: current.direction || "outbound",
    }),
    message: textValue(input.message ?? current.message, {
      label: "Communication message",
      maxLength: 10_000,
      preserveWhitespace: true,
    }),
    status: textValue(input.status ?? current.status, {
      label: "Communication status",
      fallback: "logged",
      required: true,
      maxLength: 50,
    }),
  };
}

function assertCommunicationIdUnchanged(current, input = {}) {
  for (const field of ["communicationId", "id"]) {
    if (input[field] === undefined || input[field] === null) continue;
    const reference = String(current.communicationId || current.id || "");
    if (String(input[field]) !== reference) {
      throw validationError("Communication ID cannot be changed");
    }
  }
  if (
    input._id !== undefined &&
    input._id !== null &&
    String(input._id) !== String(current._id || "")
  ) {
    throw validationError("Communication database ID cannot be changed");
  }
}

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.channel) {
    query.channel = enumValue(filters.channel, COMMUNICATION_CHANNELS, {
      label: "Communication channel filter",
    });
  }
  if (filters.enquiryId) {
    query.enquiryId = identifierValue(filters.enquiryId, {
      label: "Requirement ID filter",
    });
  }
  const q = queryTextValue(filters.q, {
    label: "Communication search",
    maxLength: 100,
  });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { recipientName: search },
      { recipientContact: search },
      { message: search },
      { enquiryId: search },
    ];
  }
  return cursorPaginate(Communication, {
    query,
    sort: { createdAt: -1, _id: -1 },
    limit,
    cursor,
  });
}

async function get(communicationId) {
  const id = identifierValue(communicationId, { label: "Communication ID" });
  const communication = await Communication.findOne({
    communicationId: id,
  }).lean();
  if (!communication) {
    throw Object.assign(new Error("Communication not found"), { status: 404 });
  }
  return communication;
}

async function create(input = {}) {
  return Communication.create(normalizeCommunicationInput(input));
}

async function update(communicationId, input = {}) {
  const current = await get(communicationId);
  assertCommunicationIdUnchanged(current, input);
  const result = await Communication.updateOne(
    { communicationId: current.communicationId },
    {
      $set: {
        ...normalizeCommunicationInput(input, current),
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount) {
    throw Object.assign(new Error("Communication not found"), { status: 404 });
  }
  return get(current.communicationId);
}

module.exports = {
  list,
  get,
  create,
  update,
  normalizeCommunicationInput,
  normalizeRecipientContact,
  assertCommunicationIdUnchanged,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
};
