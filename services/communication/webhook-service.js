const crypto = require("crypto");
const Communication = require("../../models/Communication");
const communicationService = require("./communication-service");
const whatsappService = require("./whatsapp-service");
const { truthy } = require("./communication-config");
const { textValue, validationError } = require("../../utils/validation");

const parseJsonBuffer = function (rawBody, label) {
  try {
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch (error) {
    throw validationError(`${label} contains invalid JSON`);
  }
};

const extractWhatsAppMessageText = function (message) {
  if (!message) return "";
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  return `[${message.type || "message"}]`;
};

const processWhatsApp = async function (rawBody, signature) {
  if (!whatsappService.verifyWebhookSignature(rawBody, signature)) {
    throw validationError("Invalid WhatsApp webhook signature", 401);
  }
  const payload = parseJsonBuffer(rawBody, "WhatsApp webhook");
  let statusUpdates = 0;
  let inboundMessages = 0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        const reason = status.errors?.map(function (error) {
          return error.title || error.message || error.code;
        }).join("; ") || "";
        const result = await communicationService.updateDeliveryStatus(status.id, status.status, {
          reason,
          timestamp: status.timestamp || "",
          conversation: status.conversation || null,
          pricing: status.pricing || null,
          errors: status.errors || [],
        });
        statusUpdates += result.matched;
      }
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const contact = contacts.find(function (item) {
          return item.wa_id === message.from;
        });
        await communicationService.createInbound({
          recipientName: contact?.profile?.name || "",
          recipientContact: message.from || "",
          providerMessageId: message.id || "",
          message: extractWhatsAppMessageText(message),
          externalResponse: message,
        });
        inboundMessages += 1;
      }
    }
  }
  return { statusUpdates, inboundMessages };
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
    { $set: fields, $push: { statusHistory: { status, at: now, details: body } } },
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
};
