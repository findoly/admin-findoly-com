"use strict";

const crypto = require("crypto");
const { gupshupBaseUrl, defaultCountryCode } = require("./communication-config");
const { validationError } = require("../../utils/validation");

const MAX_GUPSHUP_POSTBACK_LENGTH = 128;

function timeoutSignal(milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds).unref();
  return controller.signal;
}

function requireGupshupConfig() {
  const config = {
    apiKey: String(process.env.CRM_GUPSHUP_API_KEY || "").trim(),
    appName: String(process.env.CRM_GUPSHUP_APP_NAME || "").trim(),
    sourceNumber: String(process.env.CRM_GUPSHUP_SOURCE_NUMBER || "").trim(),
  };
  if (!config.apiKey) throw validationError("Gupshup API key is not configured", 503);
  if (!config.appName) throw validationError("Gupshup app name is not configured", 503);
  if (!config.sourceNumber) throw validationError("Gupshup source WhatsApp number is not configured", 503);
  return config;
}

function normalizeWhatsAppAddress(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) throw validationError("WhatsApp recipient is required");
  if (digits.length === 10) digits = `${defaultCountryCode()}${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw validationError("WhatsApp recipient must contain 10 to 15 digits");
  }
  return digits;
}

function parseResponse(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { raw };
  }
}

function normalizedPostbackTexts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 10).map((entry) => {
    const index = Number(entry?.index);
    const text = String(entry?.text || "").trim();
    if (!Number.isInteger(index) || index < 0 || index > 9 || !text) {
      throw validationError("WhatsApp postback text is invalid");
    }
    if (text.length > MAX_GUPSHUP_POSTBACK_LENGTH) {
      const error = validationError(
        `WhatsApp quick-reply postback exceeds Gupshup's ${MAX_GUPSHUP_POSTBACK_LENGTH}-character limit`,
      );
      error.code = "WHATSAPP_POSTBACK_TOO_LONG";
      error.postbackLength = text.length;
      throw error;
    }
    if (seen.has(index)) throw validationError("WhatsApp postback button indexes must be unique");
    seen.add(index);
    return { index, text };
  });
}

function lastFour(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.slice(-4);
}

function providerErrorCode(data = {}, message = "") {
  const direct = String(data.code || data.errorCode || data.statusCode || "").trim();
  if (direct) return direct.slice(0, 120);
  return String(message || "").match(/#(\d{2,12})/)?.[1] || "";
}

async function request(pathname, form, context = {}) {
  const config = requireGupshupConfig();
  const startedAt = process.hrtime.bigint();
  console.info({
    event: "gupshup_request_started",
    pathname,
    communicationId: String(context.communicationId || ""),
    purpose: String(context.purpose || ""),
    templateId: String(context.templateId || ""),
    parameterCount: Number(context.parameterCount || 0),
    quickReplyCount: Number(context.quickReplyCount || 0),
    postbackLength: Number(context.postbackLength || 0),
    recipientLast4: lastFour(context.recipient),
  });
  try {
    const response = await fetch(`${gupshupBaseUrl()}${pathname}`, {
      method: "POST",
      headers: {
        apikey: config.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
    });
    const data = parseResponse(await response.text());
    const providerStatus = String(data.status || "").toLowerCase();
    const durationMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
    if (!response.ok || providerStatus === "error") {
      const message = data.message || data.error || `Gupshup API request failed with status ${response.status}`;
      console.error({
        event: "gupshup_request_failed",
        pathname,
        communicationId: String(context.communicationId || ""),
        httpStatus: response.status,
        providerStatus: providerStatus || "error",
        providerCode: providerErrorCode(data, message),
        providerMessage: String(message).slice(0, 2000),
        postbackLength: Number(context.postbackLength || 0),
        durationMs,
      });
      throw Object.assign(new Error(String(message)), {
        status: response.status >= 400 && response.status < 500 ? 400 : 502,
        providerResponse: data,
      });
    }
    console.info({
      event: "gupshup_request_completed",
      pathname,
      communicationId: String(context.communicationId || ""),
      httpStatus: response.status,
      providerStatus: providerStatus || "accepted",
      providerMessageId: String(data.messageId || data.id || ""),
      durationMs,
    });
    return {
      provider: "gupshup",
      providerMessageId: data.messageId || data.id || "",
      status: providerStatus === "submitted" || providerStatus === "success"
        ? "accepted"
        : (providerStatus || "accepted"),
      response: data,
    };
  } catch (error) {
    if (!error?.providerResponse) {
      const durationMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
      console.error({
        event: "gupshup_request_failed",
        pathname,
        communicationId: String(context.communicationId || ""),
        providerCode: String(error.code || error.name || "REQUEST_FAILED"),
        providerMessage: String(error.message || error).slice(0, 2000),
        postbackLength: Number(context.postbackLength || 0),
        durationMs,
      });
    }
    throw error;
  }
}

async function sendTemplate(payload) {
  const config = requireGupshupConfig();
  const externalTemplateId = String(payload.externalTemplateId || "").trim();
  if (!externalTemplateId) throw validationError("Gupshup template ID is required");
  const params = Array.isArray(payload.templateParams)
    ? payload.templateParams.map((value) => String(value ?? ""))
    : [];
  const form = new URLSearchParams({
    channel: "whatsapp",
    source: normalizeWhatsAppAddress(config.sourceNumber),
    destination: normalizeWhatsAppAddress(payload.to),
    "src.name": config.appName,
    template: JSON.stringify({ id: externalTemplateId, params }),
  });
  const postbackTexts = normalizedPostbackTexts(payload.postbackTexts);
  if (postbackTexts.length) form.set("postbackTexts", JSON.stringify(postbackTexts));
  return request("/wa/api/v1/template/msg", form, {
    communicationId: payload.communicationId,
    purpose: payload.purpose,
    templateId: externalTemplateId,
    parameterCount: params.length,
    quickReplyCount: postbackTexts.length,
    postbackLength: Math.max(0, ...postbackTexts.map((entry) => entry.text.length)),
    recipient: payload.to,
  });
}

async function sendText(payload) {
  const config = requireGupshupConfig();
  const text = String(payload.text || "").trim();
  if (!text) throw validationError("WhatsApp session message text is required");
  if (text.length > 4096) throw validationError("WhatsApp session message must not exceed 4096 characters");
  const message = {
    type: "text",
    text,
    previewUrl: payload.previewUrl === true,
  };
  const form = new URLSearchParams({
    channel: "whatsapp",
    source: normalizeWhatsAppAddress(config.sourceNumber),
    destination: normalizeWhatsAppAddress(payload.to),
    "src.name": config.appName,
    message: JSON.stringify(message),
  });
  return request("/wa/api/v1/msg", form, {
    communicationId: payload.communicationId,
    purpose: payload.purpose,
    recipient: payload.to,
  });
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhookToken({ queryToken = "", headerToken = "" } = {}) {
  const expected = process.env.CRM_GUPSHUP_WEBHOOK_TOKEN || "";
  if (!expected) return true;
  return constantTimeEqual(queryToken, expected) || constantTimeEqual(headerToken, expected);
}

module.exports = {
  MAX_GUPSHUP_POSTBACK_LENGTH,
  normalizeWhatsAppAddress,
  normalizedPostbackTexts,
  sendTemplate,
  sendText,
  verifyWebhookToken,
};
