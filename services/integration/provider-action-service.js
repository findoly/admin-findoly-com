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

function credentialFingerprint(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

function endpointDetails(value) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      endpointHost: parsed.hostname.slice(0, 253),
      endpointPath: parsed.pathname.slice(0, 512) || "/",
    };
  } catch (_error) {
    return { endpointHost: "invalid", endpointPath: "" };
  }
}

function elapsedMilliseconds(startedAt) {
  return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
}

async function responseJson(response) {
  try {
    if (typeof response.json === "function") return await response.json();
    if (typeof response.text === "function") {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
  } catch (_error) {
    return {};
  }
  return {};
}

function actionConfig() {
  const url = String(process.env.CRM_PROVIDER_ACTION_API_URL || "").trim();
  const token = String(process.env.CRM_PROVIDER_ACTION_API_TOKEN || "").trim();
  if (!url || !token) throw validationError("Provider WhatsApp action integration is not configured", 503);
  return { url, token };
}

function requestContext(input, config, requestId, idempotencyKey) {
  return {
    requestId: String(requestId || "").slice(0, 80),
    providerId: String(input.providerId || "").slice(0, 128),
    enquiryId: String(input.enquiryId || "").slice(0, 128),
    communicationId: String(input.communicationId || "").slice(0, 128),
    inboundMessageId: String(input.inboundMessageId || "").slice(0, 128),
    idempotencyKey: String(idempotencyKey || "").slice(0, 128),
    ...endpointDetails(config.url),
    configuredCredentialFingerprint: credentialFingerprint(config.token),
  };
}

async function unlockLead(input) {
  const config = actionConfig();
  const idempotencyKey = compactIdentifier(input.idempotencyKey || crypto.randomUUID(), "whatsapp-action");
  const requestId = compactIdentifier(input.requestId || crypto.randomUUID(), "request");
  const context = requestContext(input, config, requestId, idempotencyKey);
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
  const startedAt = process.hrtime.bigint();
  console.info({ event: "provider_action_request_started", ...context });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "x-idempotency-key": idempotencyKey,
        "x-request-id": requestId,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(Math.min(30000, Math.max(3000, Number(process.env.CRM_PROVIDER_ACTION_API_TIMEOUT_MS || 15000)))),
    });
    const data = await responseJson(response);
    const providerStatus = String(data?.data?.status || data?.status || "").slice(0, 80);
    const providerCode = String(data?.data?.code || data?.code || "").slice(0, 120);
    console.info({
      event: "provider_action_request_completed",
      ...context,
      httpStatus: Number(response.status || 0),
      providerStatus,
      providerCode,
      responseSuccess: data?.success === true,
      durationMs: elapsedMilliseconds(startedAt),
    });

    if (!response.ok) {
      const error = new Error(String(data.message || `Provider action API failed with status ${response.status}`));
      error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
      error.code = data.code || "PROVIDER_ACTION_FAILED";
      error.providerHttpStatus = Number(response.status || 0);
      error.providerStatus = providerStatus;
      error.providerCode = providerCode;
      error.providerResponse = data;
      error.requestId = requestId;
      error.endpoint = { host: context.endpointHost, path: context.endpointPath };
      throw error;
    }
    if (!data || data.success !== true || !data.data) {
      const error = new Error("Provider action API returned an invalid response");
      error.status = 502;
      error.code = "PROVIDER_ACTION_INVALID_RESPONSE";
      error.providerHttpStatus = Number(response.status || 0);
      error.providerStatus = providerStatus;
      error.providerCode = providerCode;
      error.providerResponse = data;
      error.requestId = requestId;
      error.endpoint = { host: context.endpointHost, path: context.endpointPath };
      throw error;
    }
    return data.data;
  } catch (error) {
    const isTimeout = error?.name === "AbortError" || error?.name === "TimeoutError";
    const isIntegrationError = Boolean(error?.providerHttpStatus || error?.code === "PROVIDER_ACTION_INVALID_RESPONSE");
    let outgoing = error;
    if (!isIntegrationError) {
      outgoing = new Error(isTimeout
        ? "Provider action API request timed out"
        : "Unable to connect to the Provider action API");
      outgoing.status = isTimeout ? 504 : 502;
      outgoing.code = isTimeout ? "PROVIDER_ACTION_TIMEOUT" : "PROVIDER_ACTION_NETWORK_ERROR";
      outgoing.requestId = requestId;
      outgoing.endpoint = { host: context.endpointHost, path: context.endpointPath };
      outgoing.cause = error;
    }
    console.error({
      event: "provider_action_request_failed",
      ...context,
      failureType: isTimeout ? "timeout" : (outgoing.providerHttpStatus ? "http_error" : "network_or_response_error"),
      httpStatus: Number(outgoing.providerHttpStatus || 0),
      providerStatus: String(outgoing.providerStatus || "").slice(0, 80),
      providerCode: String(outgoing.providerCode || outgoing.code || "").slice(0, 120),
      errorCode: String(outgoing.code || "PROVIDER_ACTION_FAILED").slice(0, 120),
      errorName: String(error?.name || "Error").slice(0, 80),
      durationMs: elapsedMilliseconds(startedAt),
    });
    throw outgoing;
  }
}

module.exports = {
  unlockLead,
  actionConfig,
  compactIdentifier,
  credentialFingerprint,
  endpointDetails,
  responseJson,
};
