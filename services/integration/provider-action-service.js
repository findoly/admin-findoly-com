"use strict";

const crypto = require("crypto");
const { validationError } = require("../../utils/validation");

function timeoutSignal(milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  timer.unref();
  return controller.signal;
}


function compactIdentifier(value, prefix) {
  const raw = String(value || "").trim();
  if (raw && raw.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(raw)) return raw;
  const digest = crypto.createHash("sha256").update(raw || crypto.randomUUID(), "utf8").digest("hex");
  return `${prefix}-${digest.slice(0, 48)}`;
}

function actionConfig() {
  const url = String(process.env.CRM_PROVIDER_ACTION_API_URL || "").trim();
  const token = String(process.env.CRM_PROVIDER_ACTION_API_TOKEN || "").trim();
  if (!url || !token) throw validationError("Provider WhatsApp action integration is not configured", 503);
  return { url, token };
}

async function unlockLead(input) {
  const config = actionConfig();
  const idempotencyKey = compactIdentifier(input.idempotencyKey || crypto.randomUUID(), "whatsapp-action");
  const body = {
    providerId: String(input.providerId || ""),
    enquiryId: String(input.enquiryId || ""),
    providerWhatsapp: String(input.providerWhatsapp || ""),
    communicationId: String(input.communicationId || ""),
    inboundMessageId: compactIdentifier(input.inboundMessageId, "inbound"),
    originalProviderMessageId: String(input.originalProviderMessageId || ""),
    requestedAt: new Date().toISOString(),
    idempotencyKey,
  };
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
      "x-request-id": input.requestId || crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(Math.min(30000, Math.max(3000, Number(process.env.CRM_PROVIDER_ACTION_API_TIMEOUT_MS || 15000)))),
  });
  let data = {};
  try { data = await response.json(); } catch (_error) { data = {}; }
  if (!response.ok) {
    const error = new Error(String(data.message || `Provider action API failed with status ${response.status}`));
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.code = data.code || "PROVIDER_ACTION_FAILED";
    error.providerResponse = data;
    throw error;
  }
  if (!data || data.success !== true || !data.data) {
    const error = new Error("Provider action API returned an invalid response");
    error.status = 502;
    error.code = "PROVIDER_ACTION_INVALID_RESPONSE";
    error.providerResponse = data;
    throw error;
  }
  return data.data;
}

module.exports = { unlockLead, actionConfig, compactIdentifier };
