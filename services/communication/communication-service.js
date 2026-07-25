const Communication = require("../../models/Communication");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const messageGateway = require("./message-gateway");
const { normalizeChannelId } = require("./slack-service");
const { renderText, normalizeVariables } = require("./template-renderer");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  textValue,
  emailValue,
  enumValue,
  identifierValue,
  queryTextValue,
  plainObjectValue,
  booleanValue,
  validationError,
} = require("../../utils/validation");

const COMMUNICATION_CHANNELS = Object.freeze(["call", "whatsapp", "email", "sms", "slack"]);
const COMMUNICATION_DIRECTIONS = Object.freeze(["outbound", "inbound"]);
const DELIVERY_STATUSES = Object.freeze([
  "logged",
  "queued",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "bounced",
  "complained",
  "rejected",
]);

const escapeRegex = function (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const optionalIdentifier = function (value, label) {
  if (value === undefined || value === null || value === "") return "";
  return identifierValue(value, { label, required: false });
};

const normalizeRecipientContact = function (value, channel) {
  const contact = textValue(value, { label: "Recipient contact", maxLength: 254 });
  if (!contact) return "";
  if (channel === "email") return emailValue(contact, { label: "Recipient email" });
  if (channel === "slack") {
    return normalizeChannelId(contact, {
      label: "Slack channel ID",
      required: true,
    });
  }
  return validateMobile(contact, { label: "Recipient mobile number", required: false });
};

const normalizeCommunicationInput = function (input, current) {
  const source = input || {};
  const existing = current || {};
  const channel = enumValue(source.channel, COMMUNICATION_CHANNELS, {
    label: "Communication channel",
    fallback: existing.channel || "call",
  });
  return {
    enquiryId: optionalIdentifier(source.enquiryId ?? existing.enquiryId, "Requirement ID"),
    providerId: optionalIdentifier(source.providerId ?? existing.providerId, "Provider ID"),
    agentId: optionalIdentifier(source.agentId ?? existing.agentId, "Agent ID"),
    recipientName: textValue(source.recipientName ?? existing.recipientName, {
      label: "Recipient name",
      maxLength: 120,
    }),
    recipientContact: normalizeRecipientContact(
      source.recipientContact ?? existing.recipientContact,
      channel,
    ),
    channel,
    direction: enumValue(source.direction, COMMUNICATION_DIRECTIONS, {
      label: "Communication direction",
      fallback: existing.direction || "outbound",
    }),
    subject: textValue(source.subject ?? existing.subject, {
      label: "Communication subject",
      maxLength: 300,
    }),
    message: textValue(source.message ?? existing.message, {
      label: "Communication message",
      maxLength: 10000,
      preserveWhitespace: true,
    }),
    purpose: textValue(source.purpose ?? existing.purpose, {
      label: "Communication purpose",
      fallback: "manual",
      maxLength: 100,
    }),
    trigger: textValue(source.trigger ?? existing.trigger, {
      label: "Communication trigger",
      fallback: "manual",
      maxLength: 100,
    }),
    status: textValue(source.status ?? existing.status, {
      label: "Communication status",
      fallback: "logged",
      required: true,
      maxLength: 50,
    }),
    automatic: booleanValue(source.automatic, {
      label: "Automatic communication",
      fallback: existing.automatic || false,
    }),
    actor: textValue(source.actor ?? existing.actor, {
      label: "Communication actor",
      maxLength: 254,
    }),
  };
};

const assertCommunicationIdUnchanged = function (current, input) {
  const source = input || {};
  for (const field of ["communicationId", "id"]) {
    if (source[field] === undefined || source[field] === null) continue;
    const reference = String(current.communicationId || current.id || "");
    if (String(source[field]) !== reference) throw validationError("Communication ID cannot be changed");
  }
  if (
    source._id !== undefined &&
    source._id !== null &&
    String(source._id) !== String(current._id || "")
  ) {
    throw validationError("Communication database ID cannot be changed");
  }
};

const list = async function (filters) {
  const source = filters || {};
  const { limit, cursor } = getPagination(source);
  const query = {};
  if (source.channel) {
    query.channel = enumValue(source.channel, COMMUNICATION_CHANNELS, {
      label: "Communication channel filter",
    });
  }
  if (source.status) {
    query.status = textValue(source.status, { label: "Communication status filter", maxLength: 50 });
  }
  if (source.enquiryId) {
    query.enquiryId = identifierValue(source.enquiryId, { label: "Requirement ID filter" });
  }
  if (source.templateId) {
    query.templateId = identifierValue(source.templateId, { label: "Template ID filter" });
  }
  const q = queryTextValue(source.q, { label: "Communication search", maxLength: 100 });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { recipientName: search },
      { recipientContact: search },
      { message: search },
      { subject: search },
      { enquiryId: search },
      { providerMessageId: search },
    ];
  }
  applyDateRange(query, source, { fields: { createdAt: "Created date", updatedAt: "Updated date", sentAt: "Sent date" } });
  return cursorPaginate(Communication, {
    query,
    sort: dateSort(source, { fields: ["createdAt", "updatedAt", "sentAt"] }),
    limit,
    cursor,
  });
};

const get = async function (communicationId) {
  const id = identifierValue(communicationId, { label: "Communication ID" });
  const communication = await Communication.findOne({ communicationId: id }).lean();
  if (!communication) throw Object.assign(new Error("Communication not found"), { status: 404 });
  return communication;
};

const create = async function (input) {
  return Communication.create(normalizeCommunicationInput(input || {}, {}));
};

const update = async function (communicationId, input) {
  const current = await get(communicationId);
  assertCommunicationIdUnchanged(current, input || {});
  const result = await Communication.updateOne(
    { communicationId: current.communicationId },
    { $set: { ...normalizeCommunicationInput(input || {}, current), updatedAt: new Date() } },
  );
  if (!result.matchedCount) throw Object.assign(new Error("Communication not found"), { status: 404 });
  return get(current.communicationId);
};

const getTemplate = async function (templateId, channel) {
  const id = identifierValue(templateId, { label: "Template ID" });
  const template = await CommunicationTemplate.findOne({ templateId: id, channel, isActive: true }).lean();
  if (!template) throw validationError(`${channel} template was not found or is inactive`);
  if (channel === "whatsapp" && template.status !== "approved") {
    throw validationError("WhatsApp messages can use only approved templates");
  }
  if (channel === "email" && template.status !== "active") {
    throw validationError("Email messages can use only active email templates");
  }
  return template;
};

const deliveryPreview = function (template, variables) {
  const normalized = normalizeVariables(variables || {});
  return {
    subject: renderText(template.subject || "", normalized),
    message: renderText(template.body || "", normalized),
    html: renderText(template.bodyHtml || template.body || "", normalized),
    variables: normalized,
  };
};

const send = async function (input, actor) {
  const source = input || {};
  const channel = enumValue(source.channel, ["whatsapp", "email", "slack"], {
    label: "Delivery channel",
  });
  const isSlack = channel === "slack";
  let template = null;
  let preview = null;
  let recipientContact = "";
  let slackChannelName = "";

  if (isSlack) {
    recipientContact = normalizeRecipientContact(
      source.channelId || source.recipientContact || process.env.SLACK_DEFAULT_CHANNEL_ID || "",
      channel,
    );
    slackChannelName = textValue(
      source.channelName || process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team",
      {
        label: "Slack channel name",
        required: false,
        maxLength: 100,
      },
    ).replace(/^#/, "");
    const message = textValue(source.message || source.text || "", {
      label: "Slack message",
      required: true,
      maxLength: 10000,
      preserveWhitespace: true,
    });
    preview = {
      subject: textValue(source.subject || "Internal Slack notification", {
        label: "Slack subject",
        maxLength: 300,
      }),
      message,
      html: "",
      variables: {},
    };
  } else {
    template = await getTemplate(source.templateId, channel);
    recipientContact = normalizeRecipientContact(source.recipientContact, channel);
    if (!recipientContact) throw validationError("Recipient contact is required");
    preview = deliveryPreview(template, source.variables || {});
  }

  const idempotencyKey = textValue(source.idempotencyKey, {
    label: "Idempotency key",
    maxLength: 200,
  });
  if (idempotencyKey) {
    const existing = await Communication.findOne({ idempotencyKey }).lean();
    if (existing) return existing;
  }

  const metadata = plainObjectValue(source.metadata || {}, {
    label: "Communication metadata",
    maxBytes: 50000,
  });
  if (isSlack) {
    metadata.slackChannelId = recipientContact;
    metadata.slackChannelName = slackChannelName;
  }

  const communication = await Communication.create({
    enquiryId: optionalIdentifier(source.enquiryId, "Requirement ID"),
    providerId: optionalIdentifier(source.providerId, "Provider ID"),
    agentId: optionalIdentifier(source.agentId, "Agent ID"),
    templateId: template ? template.templateId : "",
    ruleId: optionalIdentifier(source.ruleId, "Rule ID"),
    recipientName: textValue(source.recipientName, {
      label: "Recipient name",
      fallback: isSlack ? "Internal team" : "",
      maxLength: 120,
    }),
    recipientContact,
    channel,
    direction: "outbound",
    purpose: textValue(source.purpose, {
      label: "Communication purpose",
      fallback: isSlack ? "internal_team_notification" : "manual",
      maxLength: 100,
    }),
    trigger: textValue(source.trigger, {
      label: "Communication trigger",
      fallback: isSlack ? "manual_slack" : "manual",
      maxLength: 100,
    }),
    subject: preview.subject,
    message: String(source.purpose || "") === "otp" ? "[OTP hidden]" : preview.message,
    variables: String(source.purpose || "") === "otp" ? {} : preview.variables,
    automatic: booleanValue(source.automatic, { label: "Automatic communication", fallback: false }),
    actor: actor || "system",
    status: "queued",
    idempotencyKey,
    statusHistory: [{ status: "queued", at: new Date(), actor: actor || "system" }],
    metadata,
  });

  try {
    const result = await messageGateway.send({
      channel,
      to: recipientContact,
      channelId: isSlack ? recipientContact : "",
      channelName: isSlack ? slackChannelName : "",
      templateName: template ? template.name : "",
      language: template ? template.language : "",
      category: template ? template.category : "",
      subject: preview.subject,
      text: preview.message,
      html: preview.html,
      variables: preview.variables,
      communicationId: communication.communicationId,
      purpose: communication.purpose,
      metadata: communication.metadata,
    });
    const status = String(result.status || "sent").toLowerCase();
    await Communication.updateOne(
      { communicationId: communication.communicationId },
      {
        $set: {
          status,
          deliveryMode: result.mode || "local",
          deliveryProvider: result.provider || "manual",
          providerMessageId: result.providerMessageId || "",
          externalResponse: result.response || null,
          sentAt: new Date(),
          failureReason: "",
          updatedAt: new Date(),
        },
        $push: { statusHistory: { status, at: new Date(), actor: actor || "system" } },
      },
    );
  } catch (error) {
    await Communication.updateOne(
      { communicationId: communication.communicationId },
      {
        $set: {
          status: "failed",
          failedAt: new Date(),
          failureReason: String(error.message || "Message delivery failed").slice(0, 3000),
          externalResponse: error.providerResponse || null,
          updatedAt: new Date(),
        },
        $push: { statusHistory: { status: "failed", at: new Date(), reason: error.message || "Message delivery failed" } },
      },
    );
    throw error;
  }
  return get(communication.communicationId);
};

const retry = async function (communicationId, actor) {
  const current = await get(communicationId);
  if (!["whatsapp", "email", "slack"].includes(current.channel)) {
    throw validationError("Only WhatsApp, email and Slack deliveries can be retried");
  }
  if (current.purpose === "otp") {
    throw validationError("OTP deliveries cannot be retried; request a new OTP instead");
  }
  if (current.channel === "slack") {
    return send(
      {
        channel: "slack",
        channelId: current.recipientContact || current.metadata?.slackChannelId || process.env.SLACK_DEFAULT_CHANNEL_ID || "",
        channelName: current.metadata?.slackChannelName || process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team",
        recipientName: current.recipientName || "Internal team",
        message: current.message || "",
        subject: current.subject || "Internal Slack notification",
        purpose: current.purpose || "internal_team_notification",
        trigger: "manual_retry",
        automatic: false,
        metadata: {
          ...(current.metadata || {}),
          retriedFromCommunicationId: current.communicationId,
        },
        idempotencyKey: `retry:${current.communicationId}:${Date.now()}`,
      },
      actor || "admin",
    );
  }
  if (!current.templateId) {
    throw validationError("This communication does not have a reusable template");
  }
  return send(
    {
      enquiryId: current.enquiryId || "",
      providerId: current.providerId || "",
      agentId: current.agentId || "",
      templateId: current.templateId,
      ruleId: current.ruleId || "",
      recipientName: current.recipientName || "",
      recipientContact: current.recipientContact || "",
      channel: current.channel,
      purpose: current.purpose || "manual",
      trigger: "manual_retry",
      automatic: false,
      variables: current.variables || {},
      metadata: {
        ...(current.metadata || {}),
        retriedFromCommunicationId: current.communicationId,
      },
      idempotencyKey: `retry:${current.communicationId}:${Date.now()}`,
    },
    actor || "admin",
  );
};


const updateDeliveryStatus = async function (providerMessageId, status, details) {
  const externalId = textValue(providerMessageId, {
    label: "Provider message ID",
    required: true,
    maxLength: 500,
  });
  const normalizedStatus = textValue(status, {
    label: "Delivery status",
    required: true,
    maxLength: 50,
  }).toLowerCase();
  const now = new Date();
  const fields = {
    status: normalizedStatus,
    updatedAt: now,
  };
  if (normalizedStatus === "sent") fields.sentAt = now;
  if (normalizedStatus === "delivered") fields.deliveredAt = now;
  if (normalizedStatus === "read") fields.readAt = now;
  if (["failed", "bounced", "complained", "rejected"].includes(normalizedStatus)) {
    fields.failedAt = now;
    fields.failureReason = textValue(details?.reason || "", {
      label: "Delivery failure reason",
      maxLength: 3000,
    });
  }
  const result = await Communication.updateOne(
    { providerMessageId: externalId },
    {
      $set: fields,
      $push: {
        statusHistory: {
          status: normalizedStatus,
          at: now,
          details: details || {},
        },
      },
    },
  );
  return { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 };
};

const createInbound = async function (input) {
  const source = input || {};
  const providerMessageId = textValue(source.providerMessageId, {
    label: "Provider message ID",
    maxLength: 500,
  });
  if (providerMessageId) {
    const existing = await Communication.findOne({ providerMessageId }).lean();
    if (existing) return existing;
  }
  return Communication.create({
    recipientName: textValue(source.recipientName, { label: "Sender name", maxLength: 120 }),
    recipientContact: textValue(source.recipientContact, { label: "Sender contact", maxLength: 254 }),
    channel: "whatsapp",
    direction: "inbound",
    purpose: "inbound_message",
    trigger: "whatsapp_webhook",
    message: textValue(source.message, { label: "Inbound message", maxLength: 10000, preserveWhitespace: true }),
    status: "received",
    deliveryMode: "local",
    deliveryProvider: "meta",
    providerMessageId,
    externalResponse: source.externalResponse || null,
    statusHistory: [{ status: "received", at: new Date() }],
  });
};

const dashboard = async function () {
  // Aggregate counts inside MongoDB instead of streaming every communication
  // document into Node. This keeps the dashboard usable as the log grows.
  const [statuses, channelTotals] = await Promise.all([
    Communication.aggregate([
      {
        $group: {
          _id: {
            channel: { $ifNull: ["$channel", "unknown"] },
            status: { $ifNull: ["$status", "unknown"] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.channel": 1, "_id.status": 1 } },
    ]),
    Communication.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$channel", "unknown"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const recent = await Communication.find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .lean();
  const failed = await Communication.find({ status: { $in: ["failed", "bounced", "complained", "rejected"] } })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(10)
    .lean();
  const recentSlack = await Communication.find({ channel: "slack" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .lean();
  return { statuses, channelTotals, recent, recentSlack, failed };
};

module.exports = {
  list,
  get,
  create,
  update,
  send,
  retry,
  dashboard,
  updateDeliveryStatus,
  createInbound,
  normalizeCommunicationInput,
  normalizeRecipientContact,
  assertCommunicationIdUnchanged,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  DELIVERY_STATUSES,
};
