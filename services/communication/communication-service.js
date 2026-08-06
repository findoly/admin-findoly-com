const crypto = require("crypto");
const Communication = require("../../models/Communication");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const messageGateway = require("./message-gateway");
const whatsappService = require("./whatsapp-service");
const { createUnlockAction, tokenHash, actionExpiryMinutes } = require("./whatsapp-action-token");
const { normalizeChannelId } = require("./slack-service");
const { renderText, normalizeVariables, templateParameterValues } = require("./template-renderer");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { boundedJsonValue } = require("../../utils/bounded-json");
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

const COMMUNICATION_HISTORY_LIMIT = 200;
const COMMUNICATION_DASHBOARD_CACHE_TTL_MS = Math.min(
  300_000,
  Math.max(5_000, Number(process.env.COMMUNICATION_DASHBOARD_CACHE_TTL_MS || 30_000) || 30_000),
);
const COMMUNICATION_QUERY_MAX_TIME_MS = Math.min(
  60_000,
  Math.max(1_000, Number(process.env.CRM_QUERY_MAX_TIME_MS || 10_000) || 10_000),
);
let communicationDashboardCache = null;
let communicationDashboardExpiresAt = 0;
let communicationDashboardBuildPromise = null;

const safeWhatsappInboxLogMessage = function (value) {
  return String(value || "WhatsApp inbox outbound sync failed")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-number]")
    .replace(/(authorization|token|secret|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
};

const recordWhatsappInboxSafely = async function (communication, employee = {}) {
  if (!communication || communication.channel !== "whatsapp") return;
  try {
    const inboxService = require("./whatsapp-inbox-service");
    await inboxService.recordOutbound(communication, employee);
  } catch (error) {
    console.error({
      event: "whatsapp_inbox_outbound_sync_failed",
      communicationId: communication.communicationId || "",
      code: String(error.code || "WHATSAPP_INBOX_SYNC_FAILED"),
      message: safeWhatsappInboxLogMessage(error.message),
    });
  }
};

const historyPush = function (entry) {
  return { $each: [entry], $slice: -COMMUNICATION_HISTORY_LIMIT };
};

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
  if (source.direction) {
    query.direction = enumValue(source.direction, COMMUNICATION_DIRECTIONS, {
      label: "Communication direction filter",
    });
  }
  if (source.status) {
    query.status = textValue(source.status, { label: "Communication status filter", maxLength: 50 });
  }
  if (source.purpose) {
    query.purpose = textValue(source.purpose, { label: "Communication purpose filter", maxLength: 100 }).toLowerCase();
  }
  if (source.accountType) {
    const accountType = enumValue(source.accountType, ["customer", "provider", "agent", "employee", "manual"], {
      label: "Communication recipient type filter",
    });
    if (["provider", "agent", "employee"].includes(accountType)) {
      query["metadata.accountType"] = accountType;
    } else if (accountType === "manual") {
      query.automatic = false;
    } else {
      query.$and = [
        { $or: [{ "metadata.accountType": "" }, { "metadata.accountType": { $exists: false } }] },
        { recipientContact: { $ne: "" } },
      ];
    }
  }
  if (source.enquiryId) {
    query.enquiryId = identifierValue(source.enquiryId, { label: "Requirement ID filter" });
  }
  if (source.templateId) {
    query.templateId = identifierValue(source.templateId, { label: "Template ID filter" });
  }
  const q = queryTextValue(source.q, { label: "Communication search", maxLength: 100 });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["communicationId", "enquiryId", "providerMessageId", "metadata.gupshupMessageId", "metadata.metaMessageId", "metadata.whatsappMessageIds"],
      phoneFields: ["recipientContact"],
      emailFields: ["recipientContact"],
      prefixFields: ["recipientName", "subject", "purpose", "trigger"],
    });
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
  if (channel === "whatsapp" && (template.status !== "approved" || !template.externalTemplateId)) {
    throw validationError("WhatsApp messages can use only approved templates with a Gupshup template ID");
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
    template = await getTemplate(
      source.templateId,
      channel,
    );
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
    if (existing) {
      console.info({
        event: "communication_deduplicated",
        communicationId: existing.communicationId || "",
        channel,
        purpose: String(source.purpose || ""),
      });
      if (channel === "whatsapp") await recordWhatsappInboxSafely(existing);
      return existing;
    }
  }

  const metadata = plainObjectValue(source.metadata || {}, {
    label: "Communication metadata",
    maxBytes: 50000,
  });
  if (isSlack) {
    metadata.slackChannelId = recipientContact;
    metadata.slackChannelName = slackChannelName;
  }
  if (channel === "whatsapp") {
    if (Array.isArray(source.templateParamsOverride)) {
      metadata.whatsappTemplateParams = source.templateParamsOverride.map((value) => String(value ?? ""));
    }
    if (source.whatsappAction?.type) {
      metadata.whatsappActionType = String(source.whatsappAction.type);
      metadata.whatsappActionButtonIndex = Number(source.whatsappAction.buttonIndex);
    }
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
  console.info({
    event: "communication_queued",
    communicationId: communication.communicationId,
    enquiryId: communication.enquiryId,
    providerId: communication.providerId,
    ruleId: communication.ruleId,
    channel: communication.channel,
    purpose: communication.purpose,
  });

  try {
    let postbackTexts = [];
    if (channel === "whatsapp" && source.whatsappAction?.type === "unlock_lead") {
      const buttonIndex = Number(source.whatsappAction.buttonIndex);
      if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex > 9) {
        throw validationError("WhatsApp unlock button index is invalid");
      }
      const actionToken = createUnlockAction({
        communicationId: communication.communicationId,
        providerId: communication.providerId,
        enquiryId: communication.enquiryId,
      });
      const expiresAt = new Date(Date.now() + actionExpiryMinutes() * 60 * 1000);
      const whatsappUnlock = {
        type: "unlock_lead",
        status: "pending",
        buttonIndex,
        tokenHash: tokenHash(actionToken),
        expiresAt,
        attempts: 0,
        processing: false,
      };
      communication.metadata = { ...(communication.metadata || {}), whatsappUnlock };
      await Communication.updateOne(
        { communicationId: communication.communicationId },
        { $set: { metadata: communication.metadata, updatedAt: new Date() } },
      );
      postbackTexts = [{ index: buttonIndex, text: actionToken }];
    }

    console.info({
      event: "communication_delivery_started",
      communicationId: communication.communicationId,
      enquiryId: communication.enquiryId,
      providerId: communication.providerId,
      ruleId: communication.ruleId,
      channel,
      purpose: communication.purpose,
      templateId: communication.templateId,
      postbackLength: postbackTexts[0]?.text?.length || 0,
    });
    const result = await messageGateway.send({
      channel,
      to: recipientContact,
      channelId: isSlack ? recipientContact : "",
      channelName: isSlack ? slackChannelName : "",
      templateName: template ? template.name : "",
      externalTemplateId: template ? template.externalTemplateId : "",
      templateParams: template
        ? templateParameterValues(template, preview.variables, {
          override: Array.isArray(source.templateParamsOverride) ? source.templateParamsOverride : undefined,
          buttonValues: Array.isArray(source.templateButtonValues) ? source.templateButtonValues : undefined,
        })
        : [],
      postbackTexts,
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
          externalResponse: boundedJsonValue(result.response || null),
          sentAt: new Date(),
          failureReason: "",
          updatedAt: new Date(),
        },
        $push: { statusHistory: historyPush({ status, at: new Date(), actor: actor || "system" }) },
      },
    );
    console.info({
      event: "communication_delivery_completed",
      communicationId: communication.communicationId,
      channel,
      purpose: communication.purpose,
      status,
      deliveryProvider: result.provider || "manual",
      providerMessageId: result.providerMessageId || "",
    });
  } catch (error) {
    const failureFields = {
      status: "failed",
      failedAt: new Date(),
      failureReason: String(error.message || "Message delivery failed").slice(0, 3000),
      externalResponse: boundedJsonValue(error.providerResponse || null),
      updatedAt: new Date(),
    };
    if (communication.metadata?.whatsappUnlock?.type === "unlock_lead") {
      failureFields["metadata.whatsappUnlock.status"] = "send_failed";
      failureFields["metadata.whatsappUnlock.processing"] = false;
      failureFields["metadata.whatsappUnlock.completedAt"] = new Date();
    }
    await Communication.updateOne(
      { communicationId: communication.communicationId },
      {
        $set: failureFields,
        $push: { statusHistory: historyPush({ status: "failed", at: new Date(), reason: error.message || "Message delivery failed" }) },
      },
    );
    console.error({
      event: "communication_delivery_failed",
      communicationId: communication.communicationId,
      enquiryId: communication.enquiryId,
      providerId: communication.providerId,
      ruleId: communication.ruleId,
      channel,
      purpose: communication.purpose,
      code: String(error.code || "DELIVERY_FAILED"),
      message: String(error.message || "Message delivery failed").slice(0, 2000),
      postbackLength: Number(error.postbackLength || 0),
    });
    if (channel === "whatsapp") {
      const failedCommunication = await get(communication.communicationId).catch(() => null);
      await recordWhatsappInboxSafely(failedCommunication);
    }
    throw error;
  }
  const completedCommunication = await get(communication.communicationId);
  if (channel === "whatsapp") await recordWhatsappInboxSafely(completedCommunication);
  return completedCommunication;
};

const sendWhatsappSession = async function (input, actor = "system") {
  const source = input || {};
  const recipientContact = normalizeRecipientContact(source.recipientContact, "whatsapp");
  if (!recipientContact) throw validationError("Recipient contact is required");
  const message = textValue(source.message, {
    label: "WhatsApp session message",
    required: true,
    maxLength: 4096,
    preserveWhitespace: true,
  });
  const idempotencyKey = textValue(source.idempotencyKey, {
    label: "Idempotency key",
    maxLength: 200,
  });
  if (idempotencyKey) {
    const existing = await Communication.findOne({ idempotencyKey }).lean();
    if (existing) {
      console.info({
        event: "communication_deduplicated",
        communicationId: existing.communicationId || "",
        channel: "whatsapp",
        purpose: String(source.purpose || "whatsapp_session"),
      });
      await recordWhatsappInboxSafely(existing);
      return existing;
    }
  }
  const communication = await Communication.create({
    enquiryId: optionalIdentifier(source.enquiryId, "Requirement ID"),
    providerId: optionalIdentifier(source.providerId, "Provider ID"),
    agentId: optionalIdentifier(source.agentId, "Agent ID"),
    recipientName: textValue(source.recipientName, { label: "Recipient name", maxLength: 120 }),
    recipientContact,
    channel: "whatsapp",
    direction: "outbound",
    purpose: textValue(source.purpose, { label: "Communication purpose", fallback: "whatsapp_session", maxLength: 100 }),
    trigger: textValue(source.trigger, { label: "Communication trigger", fallback: "whatsapp_inbound_reply", maxLength: 100 }),
    subject: "",
    message,
    variables: {},
    automatic: booleanValue(source.automatic, { label: "Automatic communication", fallback: true }),
    actor,
    status: "queued",
    idempotencyKey,
    statusHistory: [{ status: "queued", at: new Date(), actor }],
    metadata: plainObjectValue(source.metadata || {}, { label: "Communication metadata", maxBytes: 50000 }),
  });
  console.info({
    event: "communication_queued",
    communicationId: communication.communicationId,
    enquiryId: communication.enquiryId,
    providerId: communication.providerId,
    channel: "whatsapp",
    purpose: communication.purpose,
  });
  try {
    const result = await whatsappService.sendText({
      to: recipientContact,
      text: message,
      previewUrl: source.previewUrl === true,
      contextMessageId: String(source.contextMessageId || "").trim(),
      communicationId: communication.communicationId,
      purpose: communication.purpose,
    });
    const status = String(result.status || "accepted").toLowerCase();
    await Communication.updateOne(
      { communicationId: communication.communicationId },
      {
        $set: {
          status,
          deliveryMode: "local",
          deliveryProvider: result.provider || "gupshup",
          providerMessageId: result.providerMessageId || "",
          externalResponse: boundedJsonValue(result.response || null),
          sentAt: new Date(),
          failureReason: "",
          updatedAt: new Date(),
        },
        $push: { statusHistory: historyPush({ status, at: new Date(), actor }) },
      },
    );
    console.info({
      event: "communication_delivery_completed",
      communicationId: communication.communicationId,
      channel: "whatsapp",
      purpose: communication.purpose,
      status,
      deliveryProvider: result.provider || "gupshup",
      providerMessageId: result.providerMessageId || "",
    });
  } catch (error) {
    await Communication.updateOne(
      { communicationId: communication.communicationId },
      {
        $set: {
          status: "failed",
          failedAt: new Date(),
          failureReason: String(error.message || "Message delivery failed").slice(0, 3000),
          externalResponse: boundedJsonValue(error.providerResponse || null),
          updatedAt: new Date(),
        },
        $push: { statusHistory: historyPush({ status: "failed", at: new Date(), reason: error.message || "Message delivery failed" }) },
      },
    );
    console.error({
      event: "communication_delivery_failed",
      communicationId: communication.communicationId,
      enquiryId: communication.enquiryId,
      providerId: communication.providerId,
      channel: "whatsapp",
      purpose: communication.purpose,
      code: String(error.code || "DELIVERY_FAILED"),
      message: String(error.message || "Message delivery failed").slice(0, 2000),
    });
    const failedCommunication = await get(communication.communicationId).catch(() => null);
    await recordWhatsappInboxSafely(failedCommunication);
    throw error;
  }
  const completedCommunication = await get(communication.communicationId);
  await recordWhatsappInboxSafely(completedCommunication);
  return completedCommunication;
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
      ...(current.purpose === "nearby_lead_available" && Array.isArray(current.metadata?.whatsappTemplateParams) ? {
        templateParamsOverride: current.metadata.whatsappTemplateParams,
      } : {}),
      ...(current.purpose === "nearby_lead_available" && current.metadata?.whatsappActionType === "unlock_lead" ? {
        whatsappAction: {
          type: "unlock_lead",
          buttonIndex: Number(current.metadata.whatsappActionButtonIndex),
        },
      } : {}),
      idempotencyKey: `retry:${current.communicationId}:${Date.now()}`,
    },
    actor || "admin",
  );
};


const uniqueMessageIds = function (value) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .slice(0, 10);
};

const statusRank = Object.freeze({
  logged: 0,
  queued: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
});

const resolvedDeliveryStatus = function (currentStatus, incomingStatus) {
  const terminalFailures = ["failed", "bounced", "complained", "rejected"];
  if (terminalFailures.includes(incomingStatus)) return incomingStatus;
  if (terminalFailures.includes(String(currentStatus || "").toLowerCase())) return String(currentStatus);
  const currentRank = statusRank[String(currentStatus || "").toLowerCase()] ?? -1;
  const incomingRank = statusRank[String(incomingStatus || "").toLowerCase()] ?? -1;
  return currentRank > incomingRank ? String(currentStatus || incomingStatus) : incomingStatus;
};

const updateDeliveryStatus = async function (providerMessageId, status, details) {
  const messageIds = uniqueMessageIds(providerMessageId).map((entry) => textValue(entry, {
    label: "Provider message ID",
    required: true,
    maxLength: 500,
  }));
  if (!messageIds.length) throw validationError("Provider message ID is required");
  const normalizedStatus = textValue(status, {
    label: "Delivery status",
    required: true,
    maxLength: 50,
  }).toLowerCase();
  const current = await Communication.findOne({
    purpose: { $ne: "whatsapp_delivery_event_unmatched" },
    $or: [
      { providerMessageId: { $in: messageIds } },
      { "metadata.whatsappMessageIds": { $in: messageIds } },
      { "metadata.gupshupMessageId": { $in: messageIds } },
      { "metadata.metaMessageId": { $in: messageIds } },
    ],
  }).lean();
  if (!current) return { matched: 0, modified: 0, messageIds };

  const now = new Date();
  const eventAtValue = details?.eventAt ? new Date(details.eventAt) : now;
  const eventAt = Number.isNaN(eventAtValue.getTime()) ? now : eventAtValue;
  const eventKey = String(details?.eventKey || "").slice(0, 500);
  const duplicate = Boolean(eventKey && (current.statusHistory || []).some((entry) => entry?.eventKey === eventKey));
  const effectiveStatus = resolvedDeliveryStatus(current.status, normalizedStatus);
  const fields = {
    status: effectiveStatus,
    updatedAt: now,
    "metadata.lastWebhookAt": eventAt,
    "metadata.lastWebhookStatus": normalizedStatus,
    "metadata.webhookMatched": true,
  };
  if (details?.gupshupMessageId) fields["metadata.gupshupMessageId"] = String(details.gupshupMessageId);
  if (details?.metaMessageId) fields["metadata.metaMessageId"] = String(details.metaMessageId);
  if (normalizedStatus === "sent" && !current.sentAt) fields.sentAt = eventAt;
  if (normalizedStatus === "delivered" && !current.deliveredAt) fields.deliveredAt = eventAt;
  if (normalizedStatus === "read" && !current.readAt) fields.readAt = eventAt;
  if (["failed", "bounced", "complained", "rejected"].includes(normalizedStatus)) {
    fields.failedAt = current.failedAt || eventAt;
    fields.failureReason = textValue(details?.reason || "", {
      label: "Delivery failure reason",
      maxLength: 3000,
    });
  }

  const update = {
    $set: fields,
    $addToSet: {
      "metadata.whatsappMessageIds": { $each: messageIds },
    },
  };
  if (!duplicate) {
    update.$push = {
      statusHistory: historyPush({
        status: normalizedStatus,
        at: eventAt,
        source: "gupshup_webhook",
        eventKey,
        details: boundedJsonValue(details || {}),
      }),
    };
  }
  const result = await Communication.updateOne({ communicationId: current.communicationId }, update);
  return {
    matched: 1,
    modified: result.modifiedCount || 0,
    duplicate,
    communicationId: current.communicationId,
    messageIds,
  };
};

const recordUnmatchedWhatsAppEvent = async function (input = {}) {
  const messageIds = uniqueMessageIds(input.messageIds);
  const primaryMessageId = String(input.gupshupMessageId || messageIds[0] || input.metaMessageId || "").trim();
  const normalizedStatus = textValue(input.status || "received", {
    label: "Delivery status",
    required: true,
    maxLength: 50,
  }).toLowerCase();
  const now = new Date();
  const eventAtValue = input.eventAt ? new Date(input.eventAt) : now;
  const eventAt = Number.isNaN(eventAtValue.getTime()) ? now : eventAtValue;
  const identity = primaryMessageId || JSON.stringify(boundedJsonValue(input.event || {}));
  const idempotencyKey = `whatsapp-webhook-unmatched:${crypto.createHash("sha256").update(identity).digest("hex")}`;
  const eventKey = String(input.eventKey || `${normalizedStatus}:${eventAt.toISOString()}`).slice(0, 500);
  const existing = await Communication.findOne({ idempotencyKey }).lean();
  const historyEntry = {
    status: normalizedStatus,
    at: eventAt,
    source: "gupshup_webhook",
    eventKey,
    details: boundedJsonValue(input.details || input.event || {}),
  };
  if (existing) {
    const duplicate = Boolean((existing.statusHistory || []).some((entry) => entry?.eventKey === eventKey));
    const update = {
      $set: {
        status: resolvedDeliveryStatus(existing.status, normalizedStatus),
        recipientContact: String(input.destination || existing.recipientContact || "").slice(0, 254),
        externalResponse: boundedJsonValue(input.event || existing.externalResponse || null),
        "metadata.lastWebhookAt": eventAt,
        "metadata.lastWebhookStatus": normalizedStatus,
        "metadata.webhookMatched": false,
        updatedAt: now,
      },
      $addToSet: { "metadata.whatsappMessageIds": { $each: messageIds } },
    };
    if (input.gupshupMessageId) update.$set["metadata.gupshupMessageId"] = String(input.gupshupMessageId);
    if (input.metaMessageId) update.$set["metadata.metaMessageId"] = String(input.metaMessageId);
    if (!duplicate) update.$push = { statusHistory: historyPush(historyEntry) };
    await Communication.updateOne({ communicationId: existing.communicationId }, update);
    return { created: false, duplicate, communicationId: existing.communicationId };
  }

  const created = await Communication.create({
    recipientName: "Unmatched WhatsApp event",
    recipientContact: String(input.destination || "").slice(0, 254),
    channel: "whatsapp",
    direction: "inbound",
    purpose: "whatsapp_delivery_event_unmatched",
    trigger: "gupshup_webhook",
    message: `WhatsApp ${normalizedStatus} event received without a matching outbound CRM communication.`,
    automatic: true,
    actor: "system",
    status: normalizedStatus,
    deliveryMode: "local",
    deliveryProvider: "gupshup",
    providerMessageId: primaryMessageId.slice(0, 500),
    idempotencyKey,
    metadata: {
      accountType: "manual",
      webhookMatched: false,
      whatsappMessageIds: messageIds,
      gupshupMessageId: String(input.gupshupMessageId || ""),
      metaMessageId: String(input.metaMessageId || ""),
      lastWebhookAt: eventAt,
      lastWebhookStatus: normalizedStatus,
    },
    externalResponse: boundedJsonValue(input.event || null),
    statusHistory: [historyEntry],
  });
  return { created: true, duplicate: false, communicationId: created.communicationId };
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
    enquiryId: optionalIdentifier(source.enquiryId, "Requirement ID"),
    providerId: optionalIdentifier(source.providerId, "Provider ID"),
    agentId: optionalIdentifier(source.agentId, "Agent ID"),
    recipientName: textValue(source.recipientName, { label: "Sender name", maxLength: 120 }),
    recipientContact: textValue(source.recipientContact, { label: "Sender contact", maxLength: 254 }),
    channel: "whatsapp",
    direction: "inbound",
    purpose: textValue(source.purpose, { label: "Communication purpose", fallback: "inbound_message", maxLength: 100 }),
    trigger: textValue(source.trigger, { label: "Communication trigger", fallback: "whatsapp_webhook", maxLength: 100 }),
    message: textValue(source.message, { label: "Inbound message", maxLength: 10000, preserveWhitespace: true }),
    status: "received",
    deliveryMode: "local",
    deliveryProvider: "gupshup",
    providerMessageId,
    metadata: plainObjectValue(source.metadata || {}, { label: "Communication metadata", maxBytes: 50000 }),
    externalResponse: boundedJsonValue(source.externalResponse || null),
    statusHistory: [{ status: "received", at: new Date() }],
  });
};

async function buildDashboard() {
  // Aggregate counts inside MongoDB instead of streaming every communication
  // document into Node. Cache the result briefly so multiple browser requests
  // and multiple dashboard widgets do not rescan the retained log repeatedly.
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
    ]).option({ maxTimeMS: COMMUNICATION_QUERY_MAX_TIME_MS }),
    Communication.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$channel", "unknown"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).option({ maxTimeMS: COMMUNICATION_QUERY_MAX_TIME_MS }),
  ]);
  const recent = await Communication.find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .maxTimeMS(COMMUNICATION_QUERY_MAX_TIME_MS)
    .lean();
  const failed = await Communication.find({ status: { $in: ["failed", "bounced", "complained", "rejected"] } })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(10)
    .maxTimeMS(COMMUNICATION_QUERY_MAX_TIME_MS)
    .lean();
  const recentSlack = await Communication.find({ channel: "slack" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .maxTimeMS(COMMUNICATION_QUERY_MAX_TIME_MS)
    .lean();
  return { statuses, channelTotals, recent, recentSlack, failed };
}

const dashboard = async function (options = {}) {
  const now = Date.now();
  if (!options.refresh && communicationDashboardCache && communicationDashboardExpiresAt > now) {
    return communicationDashboardCache;
  }
  if (!communicationDashboardBuildPromise) {
    communicationDashboardBuildPromise = buildDashboard()
      .then((result) => {
        communicationDashboardCache = result;
        communicationDashboardExpiresAt = Date.now() + COMMUNICATION_DASHBOARD_CACHE_TTL_MS;
        return result;
      })
      .finally(() => {
        communicationDashboardBuildPromise = null;
      });
  }
  return communicationDashboardBuildPromise;
};

module.exports = {
  list,
  get,
  create,
  update,
  send,
  sendWhatsappSession,
  retry,
  dashboard,
  buildDashboard,
  updateDeliveryStatus,
  recordUnmatchedWhatsAppEvent,
  createInbound,
  normalizeCommunicationInput,
  normalizeRecipientContact,
  assertCommunicationIdUnchanged,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  DELIVERY_STATUSES,
};
