const { textValue, validationError } = require("../../utils/validation");

let channelCache = {
  expiresAt: 0,
  channels: [],
};

const timeoutSignal = function (milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(function () {
    controller.abort();
  }, milliseconds).unref();
  return controller.signal;
};

const configuredToken = function () {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) throw validationError("Slack bot token is not configured", 503);
  if (!token.startsWith("xoxb-")) {
    throw validationError("Slack bot token must be a Bot User OAuth Token beginning with xoxb-", 503);
  }
  return token;
};

const normalizeChannelId = function (value, options) {
  const settings = options || {};
  const channelId = textValue(value, {
    label: settings.label || "Slack channel ID",
    required: settings.required !== false,
    fallback: settings.fallback || "",
    maxLength: 100,
  }).toUpperCase();
  if (!channelId) return "";
  if (!/^[A-Z][A-Z0-9]{8,}$/.test(channelId)) {
    throw validationError(`${settings.label || "Slack channel ID"} is invalid`);
  }
  return channelId;
};

const configuredChannelId = function () {
  return normalizeChannelId(process.env.SLACK_DEFAULT_CHANNEL_ID || "", {
    label: "Default Slack channel ID",
    required: false,
  });
};

const configuredChannelName = function () {
  return textValue(process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team", {
    label: "Default Slack channel name",
    required: true,
    maxLength: 100,
  }).replace(/^#/, "");
};

const parseSlackResponse = async function (response) {
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { ok: false, error: raw || "invalid_response" };
  }
  if (!response.ok || data.ok === false) {
    const retryAfter = response.headers?.get ? response.headers.get("retry-after") : "";
    const message = data.error || `Slack API failed with status ${response.status}`;
    throw Object.assign(new Error(`Slack API error: ${message}`), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: {
        status: response.status,
        error: data.error || "",
        retryAfter: retryAfter || "",
        responseMetadata: data.response_metadata || null,
      },
    });
  }
  return data;
};

const slackRequest = async function (method, options) {
  const request = options || {};
  const url = new URL(`https://slack.com/api/${method}`);
  if (request.query) {
    Object.keys(request.query).forEach(function (key) {
      const value = request.query[key];
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  const response = await fetch(url.toString(), {
    method: request.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${configuredToken()}`,
      ...(request.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
  });
  return parseSlackResponse(response);
};

const listChannels = async function (options) {
  const settings = options || {};
  const cacheSeconds = Math.max(30, Number(process.env.SLACK_CHANNEL_CACHE_SECONDS || 300) || 300);
  if (!settings.refresh && channelCache.expiresAt > Date.now()) {
    return channelCache.channels;
  }

  const channels = [];
  let cursor = "";
  do {
    const data = await slackRequest("conversations.list", {
      query: {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      },
    });
    for (const channel of data.channels || []) {
      if (!channel?.id || !channel?.name || channel.is_archived) continue;
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: Boolean(channel.is_private),
        isMember: Boolean(channel.is_member),
      });
    }
    cursor = String(data.response_metadata?.next_cursor || "").trim();
  } while (cursor);

  channels.sort(function (left, right) {
    return String(left.name).localeCompare(String(right.name));
  });
  channelCache = {
    expiresAt: Date.now() + cacheSeconds * 1000,
    channels,
  };
  return channels;
};

const sendMessage = async function (payload) {
  const source = payload || {};
  const text = textValue(source.text || source.message || "", {
    label: "Slack message",
    required: true,
    maxLength: 10000,
    preserveWhitespace: true,
  });
  const channelId = normalizeChannelId(source.channelId || source.to || configuredChannelId(), {
    label: "Slack channel ID",
    required: true,
  });
  const channelName = textValue(source.channelName || configuredChannelName(), {
    label: "Slack channel name",
    required: false,
    maxLength: 100,
  }).replace(/^#/, "");

  const data = await slackRequest("chat.postMessage", {
    body: {
      channel: channelId,
      text,
    },
  });

  return {
    provider: "slack",
    providerMessageId: data.ts || "",
    status: "sent",
    response: {
      ok: true,
      channelId: data.channel || channelId,
      channelName,
      timestamp: data.ts || "",
    },
  };
};

const clearChannelCache = function () {
  channelCache = { expiresAt: 0, channels: [] };
};

module.exports = {
  sendMessage,
  listChannels,
  clearChannelCache,
  normalizeChannelId,
  configuredChannelId,
  configuredChannelName,
};
