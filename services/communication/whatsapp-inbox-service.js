"use strict";

const crypto = require("crypto");
const WhatsAppConversation = require("../../models/WhatsAppConversation");
const WhatsAppMessage = require("../../models/WhatsAppMessage");
const Communication = require("../../models/Communication");
const Enquiry = require("../../models/Enquiry");
const communicationService = require("./communication-service");
const uuid = require("../../utils/uuid");
const { normalizeMobile } = require("../../utils/mobile");
const { cursorPaginate, getPagination } = require("../../utils/pagination");
const { textValue, enumValue, validationError } = require("../../utils/validation");

const QUERY_MAX_TIME_MS = Math.min(
  60_000,
  Math.max(1_000, Number(process.env.CRM_QUERY_MAX_TIME_MS || 10_000) || 10_000),
);

const MESSAGE_TYPES = Object.freeze([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
  "contact",
  "sticker",
  "interactive",
  "unknown",
]);

const STATUS_RANK = Object.freeze({
  logged: 0,
  queued: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
});

const PROVIDER_PURPOSES = new Set([
  "nearby_lead_available",
  "whatsapp_button_reply",
  "whatsapp_unlock_request",
  "whatsapp_unlock_result",
  "whatsapp_delivery_event_unmatched",
]);

function safeContact(value) {
  const normalized = normalizeMobile(value);
  return /^[6-9]\d{9}$/.test(normalized) ? normalized : "";
}

function maskedContact(value) {
  const number = safeContact(value);
  return number ? `******${number.slice(-4)}` : "unknown";
}

function safeLogMessage(value, fallback = "WhatsApp inbox operation failed") {
  return String(value || fallback)
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-number]")
    .replace(/(authorization|token|secret|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function normalizeMessageType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "text";
  if (["file", "pdf"].includes(raw)) return "document";
  if (["quick_reply", "button", "list_reply"].includes(raw)) return "interactive";
  return MESSAGE_TYPES.includes(raw) ? raw : "unknown";
}

function previewFor(type, text) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  const labels = {
    image: "Image",
    document: "Document",
    audio: "Audio",
    video: "Video",
    location: "Location",
    contact: "Contact",
    sticker: "Sticker",
    interactive: "Interactive message",
    unknown: "Message",
  };
  const prefix = type === "text" ? "" : `[${labels[type] || "Message"}]`;
  return `${prefix}${prefix && cleanText ? " " : ""}${cleanText}`.slice(0, 240) || "[Message]";
}

function resolvedStatus(currentStatus, incomingStatus) {
  const current = String(currentStatus || "").toLowerCase();
  const incoming = String(incomingStatus || "").toLowerCase();
  const failures = ["failed", "bounced", "complained", "rejected"];
  if (failures.includes(incoming)) return incoming;
  if (failures.includes(current)) return current;
  const currentRank = STATUS_RANK[current] ?? -1;
  const incomingRank = STATUS_RANK[incoming] ?? -1;
  return currentRank > incomingRank ? current : incoming;
}

function isCustomerCommunication(communication = {}) {
  if (communication.channel !== "whatsapp") return false;
  const purpose = String(communication.purpose || "").trim().toLowerCase();
  const accountType = String(communication.metadata?.accountType || "").trim().toLowerCase();
  if (PROVIDER_PURPOSES.has(purpose) || purpose.startsWith("whatsapp_unlock")) return false;
  if (["provider", "agent", "employee"].includes(accountType)) return false;
  if (String(communication.providerId || "").trim() || String(communication.agentId || "").trim()) return false;
  return Boolean(safeContact(communication.recipientContact));
}

async function matchingEnquiries(contactNumber, limit = 10) {
  if (!contactNumber) return [];
  return Enquiry.find({ mobile: contactNumber })
    .select("enquiryId name mobile requirementTitle status category categorySlug serviceType createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.min(25, Math.max(1, Number(limit) || 10)))
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
}

async function upsertConversation({ contactNumber, displayName = "", enquiryId = "", occurredAt = new Date(), create = true }) {
  const normalizedContact = safeContact(contactNumber);
  if (!normalizedContact) throw validationError("WhatsApp contact number is invalid");
  if (!create) {
    const existing = await WhatsAppConversation.findOne({ contactNumber: normalizedContact })
      .select("conversationId")
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean();
    if (!existing) return { conversation: null, enquiries: [], occurredAt };
  }
  const [enquiries, matchedEnquiryCount] = await Promise.all([
    matchingEnquiries(normalizedContact, 10),
    Enquiry.countDocuments({ mobile: normalizedContact }).maxTimeMS(QUERY_MAX_TIME_MS),
  ]);
  const latestEnquiry = enquiries[0] || null;
  const resolvedName = String(displayName || latestEnquiry?.name || "").trim().slice(0, 120);
  const resolvedEnquiryId = String(enquiryId || latestEnquiry?.enquiryId || "").trim();
  const now = new Date();
  const update = {
    $set: {
      updatedAt: now,
      matchedEnquiryCount,
      latestEnquiryId: resolvedEnquiryId,
      latestEnquiryName: String(latestEnquiry?.name || resolvedName || "").slice(0, 120),
    },
  };
  if (create) {
    update.$setOnInsert = {
      conversationId: uuid(),
      contactNumber: normalizedContact,
      status: "open",
      unreadCount: 0,
      createdAt: now,
    };
  }
  if (resolvedName) update.$set.displayName = resolvedName;
  const conversation = await WhatsAppConversation.findOneAndUpdate(
    { contactNumber: normalizedContact },
    update,
    { new: true, upsert: create, setDefaultsOnInsert: create },
  ).lean();
  return { conversation, enquiries, occurredAt };
}

function messageIdentity({ direction, providerMessageId, communicationId, idempotencyKey }) {
  if (idempotencyKey) return String(idempotencyKey).slice(0, 300);
  if (providerMessageId) return `${direction}:provider:${providerMessageId}`.slice(0, 300);
  if (communicationId) return `${direction}:communication:${communicationId}`.slice(0, 300);
  return `${direction}:generated:${uuid()}`;
}

function communicationMessageType(communication = {}, fallback = "text") {
  return normalizeMessageType(
    communication.metadata?.whatsappMessageType ||
      communication.metadata?.messageType ||
      fallback,
  );
}

function providerIdsFromCommunication(communication = {}) {
  return [
    communication.providerMessageId,
    communication.metadata?.gupshupMessageId,
    communication.metadata?.metaMessageId,
    ...(Array.isArray(communication.metadata?.whatsappMessageIds)
      ? communication.metadata.whatsappMessageIds
      : []),
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .slice(0, 20);
}

function messageLookupQuery(document = {}) {
  const conditions = [];
  const idempotencyKey = String(document.idempotencyKey || "").trim();
  const communicationId = String(document.communicationId || "").trim();
  const providerMessageId = String(document.providerMessageId || "").trim();
  if (idempotencyKey) conditions.push({ idempotencyKey });
  if (communicationId) conditions.push({ communicationId });
  if (providerMessageId) {
    conditions.push({ providerMessageId });
    conditions.push({ providerMessageIds: providerMessageId });
  }
  if (!conditions.length) return null;
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

async function findExistingMessage(document) {
  const query = messageLookupQuery(document);
  if (!query) return null;
  return WhatsAppMessage.findOne(query).lean();
}

async function insertMessageOnce(document) {
  const existing = await findExistingMessage(document);
  if (existing) return { inserted: false, message: existing };

  // Mongoose timestamps adds updatedAt through $set for update operations. Keeping
  // updatedAt inside $setOnInsert would put the same path in two operators and
  // MongoDB rejects the upsert with an update-path conflict.
  const insertDocument = { ...document };
  delete insertDocument.createdAt;
  delete insertDocument.updatedAt;

  let result;
  try {
    result = await WhatsAppMessage.updateOne(
      { idempotencyKey: insertDocument.idempotencyKey },
      { $setOnInsert: insertDocument },
      { upsert: true },
    );
  } catch (error) {
    if (Number(error?.code) !== 11000) throw error;
    const duplicate = await findExistingMessage(document);
    if (!duplicate) throw error;
    return { inserted: false, message: duplicate };
  }

  const inserted = Number(result.upsertedCount || 0) > 0;
  const message = await findExistingMessage(document);
  return { inserted, message };
}

async function updateConversationLastMessage(conversationId, message) {
  const occurredAt = new Date(message.occurredAt || Date.now());
  const timeField = message.direction === "inbound" ? "lastInboundAt" : "lastOutboundAt";
  await WhatsAppConversation.updateOne(
    { conversationId },
    {
      $set: { updatedAt: new Date() },
      $max: { [timeField]: occurredAt },
    },
  );
  if (message.direction === "inbound" && !message.crmReadAt) {
    await WhatsAppConversation.updateOne(
      {
        conversationId,
        $or: [
          { lastReadAt: null },
          { lastReadAt: { $exists: false } },
          { lastReadAt: { $lt: occurredAt } },
        ],
      },
      { $inc: { unreadCount: 1 }, $set: { updatedAt: new Date() } },
    );
  }
  await WhatsAppConversation.updateOne(
    {
      conversationId,
      $or: [
        { lastMessageAt: null },
        { lastMessageAt: { $exists: false } },
        { lastMessageAt: { $lte: occurredAt } },
      ],
    },
    {
      $set: {
        lastMessageId: message.messageId,
        lastMessagePreview: previewFor(message.messageType, message.text),
        lastMessageType: message.messageType,
        lastMessageDirection: message.direction,
        lastMessageStatus: message.status,
        lastMessageAt: occurredAt,
        updatedAt: new Date(),
      },
    },
  );
}

async function recordCommunication(communication, options = {}) {
  const source = communication?.toObject ? communication.toObject() : communication || {};
  if (!isCustomerCommunication(source)) return { skipped: true, reason: "not_customer_whatsapp" };
  const contactNumber = safeContact(source.recipientContact);
  const occurredAt = new Date(
    source.direction === "outbound"
      ? source.sentAt || source.createdAt || Date.now()
      : options.occurredAt || source.createdAt || Date.now(),
  );
  const type = normalizeMessageType(options.messageType || communicationMessageType(source));
  const mayCreateConversation = source.direction === "inbound" || options.allowCreateConversation === true;
  const { conversation } = await upsertConversation({
    contactNumber,
    displayName: source.recipientName,
    enquiryId: source.enquiryId,
    occurredAt,
    create: mayCreateConversation,
  });
  if (!conversation) return { skipped: true, reason: "conversation_not_started" };
  const providerMessageIds = providerIdsFromCommunication(source);
  const providerMessageId = String(source.providerMessageId || providerMessageIds[0] || "").trim();
  const idempotencyKey = messageIdentity({
    direction: source.direction,
    providerMessageId,
    communicationId: source.communicationId,
    idempotencyKey: options.idempotencyKey,
  });
  const historicalRead = options.markUnread === false && source.direction === "inbound";
  const messageDocument = {
    messageId: uuid(),
    conversationId: conversation.conversationId,
    communicationId: String(source.communicationId || ""),
    providerMessageId,
    providerMessageIds,
    idempotencyKey,
    direction: source.direction === "inbound" ? "inbound" : "outbound",
    messageType: type,
    text: String(options.text ?? source.message ?? "").slice(0, 10000),
    status: String(source.status || (source.direction === "inbound" ? "received" : "queued")).slice(0, 50),
    actor: String(source.actor || "").slice(0, 254),
    employeeId: String(options.employeeId || "").slice(0, 120),
    employeeName: String(options.employeeName || "").slice(0, 120),
    failureReason: String(source.failureReason || "").slice(0, 3000),
    occurredAt,
    sentAt: source.sentAt || null,
    deliveredAt: source.deliveredAt || null,
    readAt: source.readAt || null,
    failedAt: source.failedAt || null,
    crmReadAt: historicalRead ? new Date() : null,
    metadata: {
      purpose: String(source.purpose || ""),
      trigger: String(source.trigger || ""),
      enquiryId: String(source.enquiryId || ""),
      imported: options.imported === true,
    },
    createdAt: occurredAt,
    updatedAt: new Date(),
  };
  const result = await insertMessageOnce(messageDocument);
  if (!result.inserted && result.message && (messageDocument.employeeId || messageDocument.employeeName)) {
    const employeeFields = {};
    if (messageDocument.employeeId && !result.message.employeeId) employeeFields.employeeId = messageDocument.employeeId;
    if (messageDocument.employeeName && !result.message.employeeName) employeeFields.employeeName = messageDocument.employeeName;
    if (Object.keys(employeeFields).length) {
      employeeFields.updatedAt = new Date();
      await WhatsAppMessage.updateOne({ messageId: result.message.messageId }, { $set: employeeFields });
      result.message = { ...result.message, ...employeeFields };
    }
  }
  if (result.inserted && result.message) await updateConversationLastMessage(conversation.conversationId, result.message);
  if (source.direction === "outbound" && source.communicationId) {
    const freshCommunication = await Communication.findOne({ communicationId: source.communicationId }).lean();
    if (freshCommunication) {
      await syncDeliveryStatus({
        communicationId: freshCommunication.communicationId,
        messageIds: providerIdsFromCommunication(freshCommunication),
        status: freshCommunication.status,
        details: {
          eventAt: freshCommunication.updatedAt || freshCommunication.sentAt || occurredAt,
          reason: freshCommunication.failureReason || "",
        },
      });
    }
  }
  return { ...result, conversationId: conversation.conversationId, skipped: false };
}

async function recordInbound({ communication, messageType = "text", occurredAt = new Date() }) {
  const result = await recordCommunication(communication, {
    messageType,
    occurredAt,
    markUnread: true,
  });
  if (!result.skipped) {
    console.info({
      event: "whatsapp_inbox_inbound_recorded",
      communicationId: communication?.communicationId || "",
      conversationId: result.conversationId || "",
      contact: maskedContact(communication?.recipientContact),
      inserted: result.inserted === true,
    });
  }
  return result;
}

async function recordOutbound(communication, employee = {}) {
  const result = await recordCommunication(communication, {
    messageType: "text",
    employeeId: employee.employeeId,
    employeeName: employee.name,
  });
  if (!result.skipped) {
    console.info({
      event: "whatsapp_inbox_outbound_recorded",
      communicationId: communication?.communicationId || "",
      conversationId: result.conversationId || "",
      contact: maskedContact(communication?.recipientContact),
      inserted: result.inserted === true,
    });
  }
  return result;
}

function escapedRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listConversations(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) {
    query.status = enumValue(filters.status, ["open", "closed"], {
      label: "Conversation status",
    });
  }
  if (["1", "true", "yes"].includes(String(filters.unread || "").toLowerCase())) {
    query.unreadCount = { $gt: 0 };
  }
  const q = textValue(filters.q, { label: "Conversation search", maxLength: 120 });
  if (q) {
    const normalizedNumber = normalizeMobile(q);
    const pattern = escapedRegex(q);
    query.$or = [
      { displayName: { $regex: pattern, $options: "i" } },
      { contactNumber: { $regex: escapedRegex(normalizedNumber || q) } },
      { latestEnquiryId: { $regex: pattern, $options: "i" } },
    ];
  }
  return cursorPaginate(WhatsAppConversation, {
    query,
    sort: { lastMessageAt: -1, _id: -1 },
    limit,
    cursor,
    maxTimeMS: QUERY_MAX_TIME_MS,
  });
}

async function findConversation(conversationId) {
  const normalizedId = textValue(conversationId, {
    label: "Conversation ID",
    required: true,
    maxLength: 120,
  });
  const conversation = await WhatsAppConversation.findOne({ conversationId: normalizedId })
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
  if (!conversation) throw Object.assign(new Error("WhatsApp conversation not found"), { status: 404 });
  return conversation;
}

async function getConversation(conversationId) {
  const conversation = await findConversation(conversationId);
  const enquiries = await matchingEnquiries(conversation.contactNumber, 25);
  return { conversation, enquiries };
}

async function listMessages(conversationId, filters = {}) {
  await findConversation(conversationId);
  const { limit, cursor } = getPagination(filters);
  const result = await cursorPaginate(WhatsAppMessage, {
    query: { conversationId },
    sort: { occurredAt: -1, _id: -1 },
    limit,
    cursor,
    maxTimeMS: QUERY_MAX_TIME_MS,
  });
  result.data = result.data.reverse();
  return result;
}

async function markRead(conversationId, actor = "api") {
  const conversation = await findConversation(conversationId);
  const now = new Date();
  await WhatsAppConversation.updateOne(
    { conversationId },
    {
      $set: {
        unreadCount: 0,
        lastReadAt: now,
        lastReadBy: String(actor || "api").slice(0, 254),
        updatedAt: now,
      },
    },
  );
  await WhatsAppMessage.updateMany(
    { conversationId, direction: "inbound", crmReadAt: null, occurredAt: { $lte: now } },
    { $set: { crmReadAt: now, updatedAt: now } },
  );
  return { ...conversation, unreadCount: 0, lastReadAt: now, lastReadBy: actor };
}

async function markUnread(conversationId) {
  await findConversation(conversationId);
  const latestInbound = await WhatsAppMessage.findOne({ conversationId, direction: "inbound" })
    .sort({ occurredAt: -1, _id: -1 })
    .lean();
  if (!latestInbound) throw validationError("This conversation has no inbound message to mark unread");
  await WhatsAppMessage.updateOne(
    { messageId: latestInbound.messageId },
    { $set: { crmReadAt: null, updatedAt: new Date() } },
  );
  const unreadCount = await WhatsAppMessage.countDocuments({
    conversationId,
    direction: "inbound",
    crmReadAt: null,
  }).maxTimeMS(QUERY_MAX_TIME_MS);
  await WhatsAppConversation.updateOne(
    { conversationId },
    { $set: { unreadCount, updatedAt: new Date() } },
  );
  return { conversationId, unreadCount };
}

async function updateConversationStatus(conversationId, status, actor = "api") {
  await findConversation(conversationId);
  const normalizedStatus = enumValue(status, ["open", "closed"], {
    label: "Conversation status",
  });
  const now = new Date();
  const fields = normalizedStatus === "closed"
    ? { status: "closed", closedAt: now, closedBy: String(actor || "api").slice(0, 254), updatedAt: now }
    : { status: "open", closedAt: null, closedBy: "", updatedAt: now };
  return WhatsAppConversation.findOneAndUpdate(
    { conversationId },
    { $set: fields },
    { new: true },
  ).lean();
}

function replyIdempotencyKey(conversationId, clientKey) {
  const cleanKey = textValue(clientKey, {
    label: "Reply idempotency key",
    maxLength: 160,
  });
  const fallback = crypto.randomUUID ? crypto.randomUUID() : uuid();
  return `whatsapp-inbox:${conversationId}:${cleanKey || fallback}`.slice(0, 200);
}

async function reply(conversationId, input = {}, employee = {}) {
  const conversation = await findConversation(conversationId);
  const message = textValue(input.message, {
    label: "WhatsApp message",
    required: true,
    maxLength: 4096,
    preserveWhitespace: true,
  });
  const idempotencyKey = replyIdempotencyKey(conversationId, input.idempotencyKey);
  const actor = employee.email || employee.mobile || "api";
  let communication;
  try {
    communication = await communicationService.sendWhatsappSession({
      enquiryId: conversation.latestEnquiryId || "",
      recipientName: conversation.displayName || conversation.latestEnquiryName || "",
      recipientContact: conversation.contactNumber,
      message,
      purpose: "whatsapp_inbox_reply",
      trigger: "crm_whatsapp_inbox",
      automatic: false,
      idempotencyKey,
      metadata: {
        accountType: "customer",
        conversationId,
        sentByEmployeeId: employee.employeeId || "",
      },
    }, actor);
  } catch (error) {
    communication = await Communication.findOne({ idempotencyKey }).lean();
    if (communication) await recordOutbound(communication, employee).catch(() => {});
    throw error;
  }

  console.info({
    event: "whatsapp_inbox_reply_delivery_completed",
    conversationId,
    communicationId: communication.communicationId || "",
    status: communication.status || "accepted",
    employeeId: employee.employeeId || "",
    contact: maskedContact(conversation.contactNumber),
  });

  let persistence = { status: "completed", message: null };
  try {
    const recorded = await recordOutbound(communication, employee);
    persistence.message = recorded.message || null;
    if (!persistence.message) persistence.status = "pending";
    console.info({
      event: "whatsapp_inbox_reply_persisted",
      conversationId,
      communicationId: communication.communicationId || "",
      messageId: persistence.message?.messageId || "",
      inserted: recorded.inserted === true,
    });
  } catch (error) {
    persistence = { status: "pending", message: null };
    console.error({
      event: "whatsapp_inbox_reply_persistence_failed",
      conversationId,
      communicationId: communication.communicationId || "",
      code: String(error.code || "WHATSAPP_INBOX_PERSISTENCE_FAILED"),
      message: safeLogMessage(error.message, "WhatsApp reply was delivered but inbox persistence failed"),
    });
  }

  if (conversation.status === "closed") {
    await updateConversationStatus(conversationId, "open", actor);
  }

  const occurredAt = communication.sentAt || communication.createdAt || new Date();
  const responseMessage = persistence.message || {
    messageId: `pending:${communication.communicationId || uuid()}`,
    conversationId,
    communicationId: communication.communicationId || "",
    providerMessageId: communication.providerMessageId || "",
    providerMessageIds: providerIdsFromCommunication(communication),
    direction: "outbound",
    messageType: "text",
    text: communication.message || message,
    status: communication.status || "accepted",
    actor: communication.actor || actor,
    employeeId: employee.employeeId || "",
    employeeName: employee.name || employee.email || "",
    failureReason: communication.failureReason || "",
    occurredAt,
    sentAt: communication.sentAt || occurredAt,
    deliveredAt: communication.deliveredAt || null,
    readAt: communication.readAt || null,
    failedAt: communication.failedAt || null,
    pendingPersistence: true,
  };

  console.info({
    event: "whatsapp_inbox_reply_sent",
    conversationId,
    communicationId: communication.communicationId || "",
    employeeId: employee.employeeId || "",
    contact: maskedContact(conversation.contactNumber),
    inboxSyncStatus: persistence.status,
  });

  return {
    deliveryAccepted: !["failed", "rejected", "bounced", "complained"].includes(String(communication.status || "").toLowerCase()),
    inboxSyncStatus: persistence.status,
    communicationId: communication.communicationId || "",
    message: responseMessage,
  };
}

async function syncDeliveryStatus({ communicationId = "", messageIds = [], status, details = {} }) {
  const ids = (Array.isArray(messageIds) ? messageIds : [messageIds])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const query = {
    $or: [
      ...(communicationId ? [{ communicationId }] : []),
      ...(ids.length ? [{ providerMessageId: { $in: ids } }, { providerMessageIds: { $in: ids } }] : []),
    ],
  };
  if (!query.$or.length) return { matched: 0, modified: 0 };
  const current = await WhatsAppMessage.findOne(query).lean();
  if (!current) return { matched: 0, modified: 0 };
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const effectiveStatus = resolvedStatus(current.status, normalizedStatus);
  const eventAtValue = details.eventAt ? new Date(details.eventAt) : new Date();
  const eventAt = Number.isNaN(eventAtValue.getTime()) ? new Date() : eventAtValue;
  const fields = { status: effectiveStatus, updatedAt: new Date() };
  if (normalizedStatus === "sent" && !current.sentAt) fields.sentAt = eventAt;
  if (normalizedStatus === "delivered" && !current.deliveredAt) fields.deliveredAt = eventAt;
  if (normalizedStatus === "read" && !current.readAt) fields.readAt = eventAt;
  if (["failed", "bounced", "complained", "rejected"].includes(normalizedStatus)) {
    fields.failedAt = current.failedAt || eventAt;
    fields.failureReason = String(details.reason || "").slice(0, 3000);
  }
  if (ids.length) fields.providerMessageIds = [...new Set([...(current.providerMessageIds || []), ...ids])];
  const result = await WhatsAppMessage.updateOne({ messageId: current.messageId }, { $set: fields });
  await WhatsAppConversation.updateOne(
    { conversationId: current.conversationId, lastMessageId: current.messageId },
    { $set: { lastMessageStatus: effectiveStatus, updatedAt: new Date() } },
  );
  return { matched: 1, modified: result.modifiedCount || 0, messageId: current.messageId };
}

module.exports = {
  MESSAGE_TYPES,
  PROVIDER_PURPOSES,
  safeContact,
  normalizeMessageType,
  previewFor,
  resolvedStatus,
  isCustomerCommunication,
  matchingEnquiries,
  recordCommunication,
  recordInbound,
  recordOutbound,
  listConversations,
  findConversation,
  getConversation,
  listMessages,
  markRead,
  markUnread,
  updateConversationStatus,
  reply,
  syncDeliveryStatus,
  safeLogMessage,
};
