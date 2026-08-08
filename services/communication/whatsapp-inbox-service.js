"use strict";

const crypto = require("crypto");
const path = require("path");
const WhatsAppConversation = require("../../models/WhatsAppConversation");
const WhatsAppMessage = require("../../models/WhatsAppMessage");
const Communication = require("../../models/Communication");
const Enquiry = require("../../models/Enquiry");
const communicationService = require("./communication-service");
const s3Service = require("../storage/s3-service");
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

const MEDIA_MESSAGE_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);
const MEDIA_PROCESSING_STALE_MS = 5 * 60 * 1000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = Math.min(
  60_000,
  Math.max(3_000, Number(process.env.GUPSHUP_MEDIA_DOWNLOAD_TIMEOUT_MS || 20_000) || 20_000),
);
const MEDIA_REDIRECT_LIMIT = 3;
const DEFAULT_MEDIA_HOST_SUFFIXES = [".gupshup.io"];
const CONTENT_TYPE_EXTENSIONS = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/quicktime": ".mov",
});

function mediaError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function configuredMediaHosts() {
  return String(process.env.GUPSHUP_MEDIA_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedMediaHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  const configured = configuredMediaHosts();
  if (configured.some((allowed) => host === allowed || (allowed.startsWith(".") && host.endsWith(allowed)))) return true;
  return DEFAULT_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function validatedMediaUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch (error) {
    throw mediaError("WhatsApp media URL is invalid", "WHATSAPP_MEDIA_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || !isAllowedMediaHost(url.hostname)) {
    throw mediaError("WhatsApp media URL is not from an approved Gupshup host", "WHATSAPP_MEDIA_URL_NOT_ALLOWED");
  }
  url.hash = "";
  return url;
}

function normalizeContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function contentTypeAllowed(messageType, contentType, fileName = "") {
  const mime = normalizeContentType(contentType);
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (messageType === "image") return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime);
  if (messageType === "sticker") return ["image/webp", "image/png"].includes(mime);
  if (messageType === "audio") return mime.startsWith("audio/");
  if (messageType === "video") return mime.startsWith("video/");
  if (messageType !== "document") return false;
  if ([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
  ].includes(mime)) return true;
  return mime === "application/octet-stream" && [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"].includes(extension);
}

function fallbackExtension(messageType, contentType) {
  const mime = normalizeContentType(contentType);
  if (CONTENT_TYPE_EXTENSIONS[mime]) return CONTENT_TYPE_EXTENSIONS[mime];
  return { image: ".jpg", sticker: ".webp", audio: ".audio", video: ".mp4", document: ".bin" }[messageType] || ".bin";
}

function safeMediaFileName(value, messageType, contentType, messageId = "media") {
  const raw = path.basename(String(value || "").replace(/\0/g, "").replace(/[\r\n]/g, " ")).trim();
  const rawExtension = path.extname(raw).toLowerCase();
  const mime = normalizeContentType(contentType);
  const octetStreamExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"];
  const extension = CONTENT_TYPE_EXTENSIONS[mime]
    || (mime === "application/octet-stream" && octetStreamExtensions.includes(rawExtension) ? rawExtension : "")
    || fallbackExtension(messageType, contentType);
  const stem = path.basename(raw || `${messageType}-${messageId}`, path.extname(raw))
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || `${messageType}-${String(messageId || "media").slice(0, 40)}`;
  return `${stem}${extension}`.slice(0, 240);
}

function validateInboundMedia(media = {}) {
  const messageType = normalizeMessageType(media.messageType || media.type);
  if (!MEDIA_MESSAGE_TYPES.has(messageType)) return null;
  const sourceUrl = String(media.sourceUrl || media.url || "").trim();
  const contentType = normalizeContentType(media.contentType);
  const fileName = String(media.fileName || media.name || "").trim().slice(0, 255);
  const caption = String(media.caption || "").trim().slice(0, 4096);
  if (!sourceUrl) {
    return { messageType, sourceUrl: "", contentType, fileName, caption, missingUrl: true, invalidUrl: false };
  }
  try {
    validatedMediaUrl(sourceUrl);
    return { messageType, sourceUrl, contentType, fileName, caption, missingUrl: false, invalidUrl: false };
  } catch (error) {
    return {
      messageType,
      sourceUrl: "",
      contentType,
      fileName,
      caption,
      missingUrl: false,
      invalidUrl: true,
      urlErrorCode: String(error.code || "WHATSAPP_MEDIA_URL_INVALID"),
    };
  }
}

function initialMediaDocument(media) {
  if (!media) return undefined;
  return {
    storageStatus: media.missingUrl || media.invalidUrl ? "failed" : "pending",
    source: "gupshup",
    fileName: safeMediaFileName(media.fileName, media.messageType, media.contentType),
    contentType: media.contentType,
    sizeBytes: 0,
    caption: media.caption,
    s3Key: "",
    errorCode: media.missingUrl
      ? "WHATSAPP_MEDIA_URL_MISSING"
      : media.invalidUrl
        ? media.urlErrorCode || "WHATSAPP_MEDIA_URL_INVALID"
        : "",
    failureReason: media.missingUrl
      ? "Media URL was not included in the Gupshup webhook"
      : media.invalidUrl
        ? "Media URL was not from an approved Gupshup host"
        : "",
    attemptedAt: null,
    storedAt: null,
  };
}

function privateMediaKey(conversationId, messageId, fileName) {
  const settings = s3Service.config();
  const safeConversation = String(conversationId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  const safeMessage = String(messageId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  if (!safeConversation || !safeMessage) throw mediaError("WhatsApp media storage identity is invalid", "WHATSAPP_MEDIA_ID_INVALID");
  return `${settings.privatePrefix}whatsapp-inbox/${safeConversation}/${safeMessage}/${fileName}`;
}

function contentDispositionFileName(value) {
  const header = String(value || "");
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch (error) { return utf8[1]; }
  }
  const basic = header.match(/filename="?([^";]+)"?/i);
  return basic ? basic[1].trim() : "";
}

async function downloadMediaBuffer(sourceUrl, maxBytes, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") throw mediaError("Media download is unavailable", "WHATSAPP_MEDIA_DOWNLOAD_UNAVAILABLE", 503);
  let url = validatedMediaUrl(sourceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= MEDIA_REDIRECT_LIMIT; redirect += 1) {
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "*/*", "User-Agent": "Findoly-CRM-WhatsApp-Media/1.0" },
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MEDIA_REDIRECT_LIMIT) {
          throw mediaError("WhatsApp media download redirected too many times", "WHATSAPP_MEDIA_REDIRECT_FAILED", 502);
        }
        url = validatedMediaUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        throw mediaError(`WhatsApp media download failed with status ${response.status}`, "WHATSAPP_MEDIA_DOWNLOAD_FAILED", 502);
      }
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > maxBytes) throw mediaError("WhatsApp media exceeds the configured upload limit", "WHATSAPP_MEDIA_TOO_LARGE", 413);
      const chunks = [];
      let total = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          total += chunk.length;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw mediaError("WhatsApp media exceeds the configured upload limit", "WHATSAPP_MEDIA_TOO_LARGE", 413);
          }
          chunks.push(chunk);
        }
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        total = buffer.length;
        if (total > maxBytes) throw mediaError("WhatsApp media exceeds the configured upload limit", "WHATSAPP_MEDIA_TOO_LARGE", 413);
        chunks.push(buffer);
      }
      if (!total) throw mediaError("WhatsApp media file is empty", "WHATSAPP_MEDIA_EMPTY", 422);
      return {
        buffer: Buffer.concat(chunks, total),
        contentType: normalizeContentType(response.headers.get("content-type")),
        fileName: contentDispositionFileName(response.headers.get("content-disposition")),
        sizeBytes: total,
      };
    }
    throw mediaError("WhatsApp media download failed", "WHATSAPP_MEDIA_DOWNLOAD_FAILED", 502);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw mediaError("WhatsApp media download timed out", "WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function presentMessage(message = {}) {
  const source = message?.toObject ? message.toObject() : { ...message };
  if (!source.media) return source;
  const media = { ...source.media };
  delete media.s3Key;
  media.available = media.storageStatus === "stored";
  return { ...source, media };
}

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

function finiteCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeLocationText(value, maxLength) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeInboundLocation(value = {}) {
  if (!value || typeof value !== "object") return null;
  const latitude = finiteCoordinate(value.latitude ?? value.lat);
  const longitude = finiteCoordinate(value.longitude ?? value.lng ?? value.lon);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return {
    latitude,
    longitude,
    name: safeLocationText(value.name, 200),
    address: safeLocationText(value.address, 500),
  };
}

function locationFromCommunication(communication = {}) {
  const metadataLocation = communication.metadata?.whatsappLocation;
  if (metadataLocation) return normalizeInboundLocation(metadataLocation);
  const payload = communication.externalResponse?.payload?.payload || communication.externalResponse?.payload || {};
  const location = payload.location && typeof payload.location === "object" ? payload.location : payload;
  return normalizeInboundLocation({
    latitude: location.latitude ?? location.lat,
    longitude: location.longitude ?? location.lng ?? location.lon,
    name: location.name || "",
    address: location.address || "",
  });
}

function previewFor(type, text) {
  if (type === "location") return "Shared a location";
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
  const updateTime = new Date();

  if (message.direction === "inbound" && message.metadata?.imported !== true) {
    const reopened = await WhatsAppConversation.updateOne(
      { conversationId, status: "closed" },
      {
        $set: {
          status: "open",
          closedAt: null,
          closedBy: "",
          updatedAt: updateTime,
        },
      },
    );
    if (Number(reopened.modifiedCount || 0) > 0) {
      console.info({
        event: "whatsapp_inbox_conversation_reopened",
        conversationId,
        messageId: String(message.messageId || "").slice(0, 120),
        reason: "new_inbound_message",
      });
    }
  }

  await WhatsAppConversation.updateOne(
    { conversationId },
    {
      $set: { updatedAt: updateTime },
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
  const media = options.media ? validateInboundMedia(options.media) : null;
  const location = type === "location"
    ? normalizeInboundLocation(options.location || locationFromCommunication(source))
    : null;
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
    ...(media ? { media: initialMediaDocument(media) } : {}),
    ...(location ? { location } : {}),
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
  if (!result.inserted && result.message && media && (!result.message.media || result.message.media.storageStatus === "none")) {
    const mediaFields = initialMediaDocument(media);
    await WhatsAppMessage.updateOne(
      { messageId: result.message.messageId },
      { $set: { media: mediaFields, updatedAt: new Date() } },
    );
    result.message = { ...result.message, media: mediaFields };
  }
  if (!result.inserted && result.message && location && !normalizeInboundLocation(result.message.location)) {
    await WhatsAppMessage.updateOne(
      { messageId: result.message.messageId },
      { $set: { location, updatedAt: new Date() } },
    );
    result.message = { ...result.message, location };
  }
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
  return {
    ...result,
    message: result.message ? presentMessage(result.message) : result.message,
    conversationId: conversation.conversationId,
    skipped: false,
  };
}

async function claimMediaProcessing(messageId) {
  const staleBefore = new Date(Date.now() - MEDIA_PROCESSING_STALE_MS);
  return WhatsAppMessage.findOneAndUpdate(
    {
      messageId,
      $or: [
        { "media.storageStatus": { $in: ["pending", "failed", "none"] } },
        { "media.storageStatus": { $exists: false } },
        { "media.storageStatus": "processing", "media.attemptedAt": { $lt: staleBefore } },
      ],
    },
    {
      $set: {
        "media.storageStatus": "processing",
        "media.attemptedAt": new Date(),
        "media.errorCode": "",
        "media.failureReason": "",
        updatedAt: new Date(),
      },
    },
    { new: true },
  ).lean();
}

async function storeInboundMedia({ messageId, media }) {
  const normalized = validateInboundMedia(media);
  if (!normalized || normalized.missingUrl || normalized.invalidUrl) {
    return {
      stored: false,
      skipped: true,
      reason: normalized?.invalidUrl ? "media_url_invalid" : "media_url_missing",
      errorCode: normalized?.urlErrorCode || (normalized?.missingUrl ? "WHATSAPP_MEDIA_URL_MISSING" : ""),
    };
  }
  const existing = await WhatsAppMessage.findOne({ messageId }).lean();
  if (!existing) throw Object.assign(new Error("WhatsApp message not found"), { status: 404, code: "WHATSAPP_MESSAGE_NOT_FOUND" });
  if (existing.media?.storageStatus === "stored" && existing.media?.s3Key) {
    return { stored: true, skipped: true, message: presentMessage(existing) };
  }
  const claimed = await claimMediaProcessing(messageId);
  if (!claimed) return { stored: false, skipped: true, reason: "media_processing_in_progress" };

  try {
    const settings = s3Service.config();
    if (!settings.configured) throw mediaError("Private S3 storage is not configured", "S3_NOT_CONFIGURED", 503);
    const downloaded = await downloadMediaBuffer(normalized.sourceUrl, settings.maxUploadBytes);
    const resolvedContentType = downloaded.contentType && downloaded.contentType !== "application/octet-stream"
      ? downloaded.contentType
      : normalized.contentType || downloaded.contentType || "application/octet-stream";
    const candidateName = normalized.fileName || downloaded.fileName || "";
    if (!contentTypeAllowed(normalized.messageType, resolvedContentType, candidateName)) {
      throw mediaError("WhatsApp media file type is not supported", "WHATSAPP_MEDIA_TYPE_UNSUPPORTED", 415);
    }
    const fileName = safeMediaFileName(candidateName, normalized.messageType, resolvedContentType, messageId);
    const key = privateMediaKey(claimed.conversationId, messageId, fileName);
    const uploaded = await s3Service.putObject({
      key,
      body: downloaded.buffer,
      contentType: resolvedContentType,
    });
    const storedAt = new Date();
    const fields = {
      "media.storageStatus": "stored",
      "media.source": "gupshup",
      "media.fileName": fileName,
      "media.contentType": uploaded.contentType,
      "media.sizeBytes": uploaded.sizeBytes,
      "media.caption": normalized.caption,
      "media.s3Key": uploaded.key,
      "media.errorCode": "",
      "media.failureReason": "",
      "media.storedAt": storedAt,
      updatedAt: storedAt,
    };
    await WhatsAppMessage.updateOne({ messageId }, { $set: fields });
    const updated = await WhatsAppMessage.findOne({ messageId }).lean();
    console.info({
      event: "whatsapp_inbox_media_stored",
      messageId,
      conversationId: claimed.conversationId || "",
      messageType: normalized.messageType,
      contentType: uploaded.contentType,
      sizeBytes: uploaded.sizeBytes,
    });
    return {
      stored: true,
      message: presentMessage(updated || {
        ...claimed,
        media: {
          ...claimed.media,
          storageStatus: "stored",
          source: "gupshup",
          fileName,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          caption: normalized.caption,
          s3Key: uploaded.key,
          errorCode: "",
          failureReason: "",
          storedAt,
        },
      }),
    };
  } catch (error) {
    const code = String(error.code || "WHATSAPP_MEDIA_STORAGE_FAILED").slice(0, 120);
    const failureReason = safeLogMessage(error.message, "WhatsApp media could not be saved").slice(0, 1000);
    await WhatsAppMessage.updateOne(
      { messageId },
      {
        $set: {
          "media.storageStatus": "failed",
          "media.errorCode": code,
          "media.failureReason": failureReason,
          updatedAt: new Date(),
        },
      },
    ).catch(() => {});
    console.error({
      event: "whatsapp_inbox_media_storage_failed",
      messageId,
      conversationId: claimed.conversationId || "",
      messageType: normalized.messageType,
      code,
      message: failureReason,
    });
    return { stored: false, errorCode: code, failureReason };
  }
}


const RETRYABLE_MEDIA_CODES = new Set([
  "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
  "WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT",
  "WHATSAPP_MEDIA_STORAGE_FAILED",
  "S3_NOT_CONFIGURED",
  "S3_REQUEST_FAILED",
  "S3_TOKEN_EXPIRED",
]);

function queueInboundMediaStorage({ messageId, media }) {
  const run = async (attempt = 1) => {
    const result = await storeInboundMedia({ messageId, media });
    if (result.stored || attempt >= 2 || !RETRYABLE_MEDIA_CODES.has(result.errorCode)) return;
    const timer = setTimeout(() => { void run(attempt + 1); }, 30_000);
    if (typeof timer.unref === "function") timer.unref();
  };
  const timer = setTimeout(() => { void run(1); }, 0);
  if (typeof timer.unref === "function") timer.unref();
}

async function getMessageMedia(messageId, disposition = "attachment") {
  const normalizedId = textValue(messageId, {
    label: "WhatsApp message ID",
    required: true,
    maxLength: 120,
  });
  const message = await WhatsAppMessage.findOne({ messageId: normalizedId })
    .select("messageId conversationId messageType media")
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
  if (!message) throw Object.assign(new Error("WhatsApp message not found"), { status: 404 });
  if (message.media?.storageStatus !== "stored" || !message.media?.s3Key) {
    throw Object.assign(new Error("WhatsApp media is not available"), { status: 404, code: "WHATSAPP_MEDIA_NOT_AVAILABLE", expose: true });
  }
  return s3Service.createDownloadUrl({
    key: message.media.s3Key,
    disposition: String(disposition || "").toLowerCase() === "inline" ? "inline" : "attachment",
  });
}

async function recordInbound({ communication, messageType = "text", occurredAt = new Date(), media = null, location = null }) {
  const result = await recordCommunication(communication, {
    messageType,
    occurredAt,
    markUnread: true,
    media,
    location,
  });
  if (!result.skipped) {
    console.info({
      event: "whatsapp_inbox_inbound_recorded",
      communicationId: communication?.communicationId || "",
      conversationId: result.conversationId || "",
      contact: maskedContact(communication?.recipientContact),
      inserted: result.inserted === true,
      messageType: normalizeMessageType(messageType),
      mediaExpected: Boolean(media),
      locationAvailable: Boolean(location),
    });
    if (media && result.message?.messageId) {
      queueInboundMediaStorage({ messageId: result.message.messageId, media });
      result.mediaStored = result.message.media?.storageStatus === "stored";
      result.mediaQueued = !result.mediaStored;
    }
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
  result.data = result.data.reverse().map(presentMessage);
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
  validateInboundMedia,
  normalizeInboundLocation,
  locationFromCommunication,
  safeMediaFileName,
  privateMediaKey,
  contentTypeAllowed,
  downloadMediaBuffer,
  presentMessage,
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
  storeInboundMedia,
  getMessageMedia,
  syncDeliveryStatus,
  safeLogMessage,
};
