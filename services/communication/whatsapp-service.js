const crypto = require("crypto");
const { gupshupBaseUrl, defaultCountryCode } = require("./communication-config");
const { validationError } = require("../../utils/validation");

const timeoutSignal = function (milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(function () { controller.abort(); }, milliseconds).unref();
  return controller.signal;
};

const requireGupshupConfig = function () {
  const config = {
    apiKey: process.env.CRM_GUPSHUP_API_KEY || "",
    appName: process.env.CRM_GUPSHUP_APP_NAME || "",
    sourceNumber: process.env.CRM_GUPSHUP_SOURCE_NUMBER || "",
  };
  if (!config.apiKey) throw validationError("Gupshup API key is not configured", 503);
  if (!config.appName) throw validationError("Gupshup app name is not configured", 503);
  if (!config.sourceNumber) throw validationError("Gupshup source WhatsApp number is not configured", 503);
  return config;
};

const normalizeWhatsAppAddress = function (value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) throw validationError("WhatsApp recipient is required");
  if (digits.length === 10) digits = `${defaultCountryCode()}${digits}`;
  if (digits.length < 10 || digits.length > 15) throw validationError("WhatsApp recipient must contain 10 to 15 digits");
  return digits;
};

const parseResponse = function (raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (error) { return { raw }; }
};

const sendTemplate = async function (payload) {
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
  const response = await fetch(`${gupshupBaseUrl()}/wa/api/v1/template/msg`, {
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
  if (!response.ok || providerStatus === "error") {
    const message = data.message || data.error || `Gupshup API request failed with status ${response.status}`;
    throw Object.assign(new Error(String(message)), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: data,
    });
  }
  return {
    provider: "gupshup",
    providerMessageId: data.messageId || data.id || "",
    status: providerStatus === "submitted" || providerStatus === "success" ? "accepted" : (providerStatus || "accepted"),
    response: data,
  };
};

const constantTimeEqual = function (left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const verifyWebhookToken = function ({ queryToken = "", headerToken = "" } = {}) {
  const expected = process.env.CRM_GUPSHUP_WEBHOOK_TOKEN || "";
  if (!expected) return true;
  return constantTimeEqual(queryToken, expected) || constantTimeEqual(headerToken, expected);
};

module.exports = { normalizeWhatsAppAddress, sendTemplate, verifyWebhookToken };
