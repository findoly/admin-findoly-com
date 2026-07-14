const { textValue, validationError } = require("../../utils/validation");

const timeoutSignal = function (milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(function () {
    controller.abort();
  }, milliseconds).unref();
  return controller.signal;
};

const configuredChannelName = function () {
  return textValue(process.env.SLACK_CHANNEL_NAME || "internal-team", {
    label: "Slack channel name",
    required: true,
    maxLength: 100,
  });
};

const sendMessage = async function (payload) {
  const webhookUrl = String(process.env.SLACK_WEBHOOK_URL || "").trim();
  if (!webhookUrl) throw validationError("Slack incoming webhook URL is not configured", 503);

  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch (error) {
    throw validationError("Slack incoming webhook URL is invalid", 503);
  }
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith("slack.com")) {
    throw validationError("Slack incoming webhook URL must use an HTTPS slack.com address", 503);
  }

  const text = textValue(payload.text || payload.message || "", {
    label: "Slack message",
    required: true,
    maxLength: 10000,
    preserveWhitespace: true,
  });
  const channelName = textValue(payload.channelName || configuredChannelName(), {
    label: "Slack channel name",
    required: true,
    maxLength: 100,
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
  });
  const raw = await response.text();
  if (!response.ok || String(raw || "").trim().toLowerCase() !== "ok") {
    throw Object.assign(new Error(raw || `Slack webhook failed with status ${response.status}`), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: { status: response.status, raw, channelName },
    });
  }

  return {
    provider: "slack",
    providerMessageId: "",
    status: "sent",
    response: { ok: true, channelName },
  };
};

module.exports = { sendMessage, configuredChannelName };
