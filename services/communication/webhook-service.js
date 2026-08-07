const crypto = require("crypto");
const Communication = require("../../models/Communication");
const communicationService = require("./communication-service");
const whatsappService = require("./whatsapp-service");
const providerWhatsappActionService = require("./provider-whatsapp-action-service");
const whatsappInboxService = require("./whatsapp-inbox-service");
const templateService = require("./template-service");
const { truthy } = require("./communication-config");
const { textValue, validationError } = require("../../utils/validation");
const { boundedJsonValue } = require("../../utils/bounded-json");

const COMMUNICATION_HISTORY_LIMIT = 200;

const historyPush = function (entry) {
  return { $each: [entry], $slice: -COMMUNICATION_HISTORY_LIMIT };
};


const parseJsonBuffer = function (rawBody, label) {
  try {
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch (error) {
    throw validationError(`${label} contains invalid JSON`);
  }
};

const extractWhatsAppMessageText = function (message) {
  const content = message?.payload || message || {};
  if (content.text) return typeof content.text === "string" ? content.text : (content.text.body || "");
  if (content.body) return content.body;
  if (content.title) return content.title;
  if (content.caption) return content.caption;
  if (content.postbackText) return content.postbackText;
  return `[${message?.type || content?.type || "message"}]`;
};

const extractWhatsAppMessageType = function (message) {
  const content = message?.payload || message || {};
  return whatsappInboxService.normalizeMessageType(message?.type || content?.type || "text");
};

const extractWhatsAppMedia = function (message) {
  const messageType = extractWhatsAppMessageType(message);
  if (!["image", "document", "audio", "video", "sticker"].includes(messageType)) return null;
  const content = message?.payload || {};
  return whatsappInboxService.validateInboundMedia({
    messageType,
    sourceUrl: content.url || content.link || content.mediaUrl || "",
    fileName: content.name || content.fileName || content.filename || "",
    contentType: content["content-type"] || content.contentType || content.mimeType || content.mime_type || "",
    caption: content.caption || "",
  });
};

const syncInboxDeliverySafely = async function (input) {
  try {
    return await whatsappInboxService.syncDeliveryStatus(input);
  } catch (error) {
    console.error({
      event: "whatsapp_inbox_delivery_sync_failed",
      communicationId: input.communicationId || "",
      status: input.status || "",
      code: String(error.code || "WHATSAPP_INBOX_SYNC_FAILED"),
      message: whatsappInboxService.safeLogMessage(error.message, "WhatsApp inbox delivery sync failed"),
    });
    return { matched: 0, modified: 0, failed: true };
  }
};


const uniqueTextValues = function (values) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, entries) => entries.indexOf(value) === index);
};

const whatsappEventAt = function (event, payload) {
  const candidates = [event?.timestamp, payload?.timestamp, payload?.payload?.ts];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
};

const whatsappEventKey = function ({ status, gupshupMessageId, metaMessageId, eventAt }) {
  return ["gupshup", status, gupshupMessageId, metaMessageId, eventAt.toISOString()].join(":");
};

const gupshupStatus = function (value) {
  const status = String(value || "").toLowerCase();
  if (status === "enqueued") return "accepted";
  if (["sent", "delivered", "read", "failed"].includes(status)) return status;
  return status || "accepted";
};

const processWhatsApp = async function (rawBody, auth = {}) {
  if (!whatsappService.verifyWebhookToken(auth)) {
    throw validationError("Invalid Gupshup webhook token", 401);
  }
  const event = parseJsonBuffer(rawBody, "Gupshup WhatsApp webhook");
  if (event.type === "template-event") {
    return {
      templateUpdates: await templateService.processProviderEvent(event),
      statusUpdates: 0,
      inboundMessages: 0,
    };
  }
  if (event.type === "message-event") {
    const payload = event.payload || {};
    const gupshupMessageId = String(payload.gsId || "").trim();
    const metaMessageId = String(payload.id || "").trim();
    const messageIds = uniqueTextValues([gupshupMessageId, metaMessageId]);
    if (!messageIds.length) return { ignored: true, reason: "missing_message_id" };
    const status = gupshupStatus(payload.type);
    const eventAt = whatsappEventAt(event, payload);
    const details = payload.payload || {};
    const eventKey = whatsappEventKey({ status, gupshupMessageId, metaMessageId, eventAt });
    const deliveryDetails = {
      reason: details.reason || payload.reason || "",
      code: details.code || "",
      destination: payload.destination || "",
      eventAt,
      eventKey,
      gupshupMessageId,
      metaMessageId,
      event,
    };
    const result = await communicationService.updateDeliveryStatus(messageIds, status, deliveryDetails);
    if (result.matched) {
      await syncInboxDeliverySafely({
        communicationId: result.communicationId || "",
        messageIds,
        status,
        details: deliveryDetails,
      });
      return {
        statusUpdates: result.matched,
        inboundMessages: 0,
        webhookAuditUpdates: 0,
        communicationId: result.communicationId || "",
        duplicate: result.duplicate === true,
      };
    }
    const audit = await communicationService.recordUnmatchedWhatsAppEvent({
      messageIds,
      status,
      destination: payload.destination || "",
      eventAt,
      eventKey,
      gupshupMessageId,
      metaMessageId,
      details: deliveryDetails,
      event,
    });
    return {
      statusUpdates: 0,
      inboundMessages: 0,
      webhookAuditUpdates: 1,
      unmatched: true,
      communicationId: audit.communicationId || "",
      duplicate: audit.duplicate === true,
    };
  }
  if (event.type === "message") {
    const actionResult = await providerWhatsappActionService.processInbound(event, {
      requestId: auth.requestId || "",
    });
    if (actionResult.handled) {
      return { statusUpdates: 0, inboundMessages: 1, action: actionResult };
    }
    const payload = event.payload || {};
    const occurredAt = whatsappEventAt(event, payload);
    const messageType = extractWhatsAppMessageType(payload);
    const media = extractWhatsAppMedia(payload);
    const inbound = await communicationService.createInbound({
      recipientName: payload.sender?.name || "",
      recipientContact: payload.source || payload.sender?.phone || "",
      providerMessageId: payload.id || "",
      message: extractWhatsAppMessageText(payload),
      metadata: {
        accountType: "customer",
        whatsappMessageType: messageType,
        ...(media ? {
          whatsappMedia: {
            fileName: media.fileName || "",
            contentType: media.contentType || "",
            caption: media.caption || "",
            available: Boolean(media.sourceUrl),
          },
        } : {}),
      },
      externalResponse: event,
    });
    try {
      await whatsappInboxService.recordInbound({
        communication: inbound,
        messageType,
        occurredAt,
        media,
      });
    } catch (error) {
      console.error({
        event: "whatsapp_inbox_inbound_sync_failed",
        communicationId: inbound?.communicationId || "",
        code: String(error.code || "WHATSAPP_INBOX_SYNC_FAILED"),
        message: whatsappInboxService.safeLogMessage(error.message, "WhatsApp inbox inbound sync failed"),
      });
    }
    return { statusUpdates: 0, inboundMessages: 1, inboxConversation: true };
  }
  return { ignored: true, reason: "unsupported_event" };
};

const validSnsCertificateUrl = function (value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return /^sns(?:\.[a-z0-9-]+)?\.amazonaws\.com$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
};

const snsCanonicalString = function (message) {
  const fields = message.Type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  let output = "";
  fields.forEach(function (field) {
    if (message[field] !== undefined) output += `${field}\n${message[field]}\n`;
  });
  return output;
};

const verifySnsSignature = async function (message) {
  if (!validSnsCertificateUrl(message.SigningCertURL)) return false;
  const certificateResponse = await fetch(message.SigningCertURL, {
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10000) : undefined,
  });
  if (!certificateResponse.ok) return false;
  const certificate = await certificateResponse.text();
  const algorithm = String(message.SignatureVersion || "1") === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const verifier = crypto.createVerify(algorithm);
  verifier.update(snsCanonicalString(message), "utf8");
  verifier.end();
  return verifier.verify(certificate, message.Signature, "base64");
};

const sesStatus = function (notificationType) {
  const value = String(notificationType || "").toLowerCase();
  if (value === "delivery") return "delivered";
  if (value === "bounce") return "bounced";
  if (value === "complaint") return "complained";
  if (value === "reject") return "rejected";
  if (value === "send") return "sent";
  if (value === "open") return "read";
  if (value === "deliverydelay") return "delayed";
  if (value === "renderingfailure") return "failed";
  return value || "sent";
};

const sesReason = function (event) {
  if (event.bounce) return event.bounce.bounceSubType || event.bounce.bounceType || "Email bounced";
  if (event.complaint) return event.complaint.complaintFeedbackType || "Email complaint";
  if (event.reject) return event.reject.reason || "Email rejected";
  if (event.failure) return event.failure.errorMessage || "Email rendering failed";
  if (event.deliveryDelay) return event.deliveryDelay.delayType || "Email delivery delayed";
  return "";
};

const processSes = async function (rawBody) {
  const envelope = parseJsonBuffer(rawBody, "SES webhook");
  if (!(await verifySnsSignature(envelope))) {
    throw validationError("Invalid Amazon SNS signature", 401);
  }
  if (envelope.Type === "SubscriptionConfirmation") {
    if (truthy(process.env.SES_SNS_AUTO_CONFIRM) && validSnsCertificateUrl(envelope.SubscribeURL)) {
      const response = await fetch(envelope.SubscribeURL, {
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10000) : undefined,
      });
      if (!response.ok) throw Object.assign(new Error("Unable to confirm Amazon SNS subscription"), { status: 502 });
      return { subscriptionConfirmed: true };
    }
    return { subscriptionConfirmed: false, confirmationRequired: true };
  }
  if (envelope.Type !== "Notification") return { ignored: true };
  let event;
  try {
    event = typeof envelope.Message === "string" ? JSON.parse(envelope.Message) : envelope.Message;
  } catch (error) {
    throw validationError("SES notification message contains invalid JSON");
  }
  const messageId = event?.mail?.messageId || "";
  if (!messageId) return { ignored: true };
  return communicationService.updateDeliveryStatus(messageId, sesStatus(event.eventType || event.notificationType), {
    reason: sesReason(event),
    event,
  });
};

const constantTimeEqual = function (left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const processLambdaDelivery = async function (body, authHeader) {
  const expected = process.env.MESSAGE_LAMBDA_WEBHOOK_TOKEN || process.env.MESSAGE_LAMBDA_AUTH_TOKEN || "";
  if (!expected || !constantTimeEqual(String(authHeader || ""), `Bearer ${expected}`)) {
    throw validationError("Invalid message-delivery webhook token", 401);
  }
  const communicationId = identifierOrBlank(body.communicationId);
  const providerMessageId = textValue(body.providerMessageId || "", {
    label: "Provider message ID",
    maxLength: 500,
  });
  const status = textValue(body.status, {
    label: "Message status",
    required: true,
    maxLength: 50,
  }).toLowerCase();
  if (providerMessageId) {
    return communicationService.updateDeliveryStatus(providerMessageId, status, {
      reason: body.reason || "",
      lambda: body,
    });
  }
  if (!communicationId) throw validationError("Communication ID or provider message ID is required");
  const now = new Date();
  const fields = { status, updatedAt: now };
  if (body.providerMessageId) fields.providerMessageId = String(body.providerMessageId);
  if (status === "delivered") fields.deliveredAt = now;
  if (status === "read") fields.readAt = now;
  if (["failed", "bounced", "complained", "rejected"].includes(status)) {
    fields.failedAt = now;
    fields.failureReason = String(body.reason || "").slice(0, 3000);
  }
  const result = await Communication.updateOne(
    { communicationId },
    { $set: fields, $push: { statusHistory: historyPush({ status, at: now, details: boundedJsonValue(body) }) } },
  );
  return { matched: result.matchedCount || 0, modified: result.modifiedCount || 0 };
};

const identifierOrBlank = function (value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(normalized)) {
    throw validationError("Communication ID is invalid");
  }
  return normalized;
};

module.exports = {
  processWhatsApp,
  processSes,
  processLambdaDelivery,
  verifySnsSignature,
  snsCanonicalString,
  extractWhatsAppMessageText,
  extractWhatsAppMessageType,
};
