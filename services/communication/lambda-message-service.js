const { validationError } = require("../../utils/validation");

const timeoutSignal = function (milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(function () {
    controller.abort();
  }, milliseconds).unref();
  return controller.signal;
};

const send = async function (payload) {
  const url = process.env.MESSAGE_LAMBDA_URL || "";
  if (!url) throw validationError("Message Lambda URL is not configured", 503);
  const headers = { "Content-Type": "application/json" };
  if (process.env.MESSAGE_LAMBDA_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MESSAGE_LAMBDA_AUTH_TOKEN}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { raw };
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.message || `Message Lambda failed with status ${response.status}`), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: data,
    });
  }
  return {
    provider: "lambda",
    providerMessageId: data.providerMessageId || data.messageId || "",
    status: data.status || "queued",
    response: data,
  };
};

module.exports = { send };
