const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SKIP_DB = "true";
process.env.MESSAGE_DELIVERY_MODE = "local";
process.env.COMMUNICATION_LOG_RETENTION_DAYS = "7";
process.env.OTP_RETENTION_DAYS = "7";
process.env.SLACK_BOT_TOKEN = "xoxb-test-bot-token";
process.env.SLACK_DEFAULT_CHANNEL_ID = "C0123456789";
process.env.SLACK_DEFAULT_CHANNEL_NAME = "internal-team";
process.env.SLACK_CHANNEL_CACHE_SECONDS = "300";

const Communication = require("../models/Communication");
const OtpRequest = require("../models/OtpRequest");
const CommunicationRule = require("../models/CommunicationRule");
const communicationService = require("../services/communication/communication-service");
const slackService = require("../services/communication/slack-service");
const ruleService = require("../services/communication/rule-service");
const { configurationStatus } = require("../services/communication/communication-config");

const ttlIndex = function (model, name) {
  return model.schema.indexes().find(function (row) {
    return row[1] && row[1].name === name;
  });
};

const slackResponse = function (data, status) {
  return {
    ok: !status || status < 400,
    status: status || 200,
    headers: {
      get: function () {
        return "";
      },
    },
    text: async function () {
      return JSON.stringify(data);
    },
  };
};

test("communication logs use a seven-day MongoDB TTL index", function () {
  const index = ttlIndex(Communication, "communication_log_ttl");
  assert.ok(index);
  assert.deepEqual(index[0], { createdAt: 1 });
  assert.equal(index[1].expireAfterSeconds, 7 * 24 * 60 * 60);
});

test("OTP activity uses a seven-day MongoDB TTL index", function () {
  const index = ttlIndex(OtpRequest, "otp_activity_ttl");
  assert.ok(index);
  assert.deepEqual(index[0], { createdAt: 1 });
  assert.equal(index[1].expireAfterSeconds, 7 * 24 * 60 * 60);
});

test("Slack is a supported communication channel and provider", function () {
  assert.ok(Communication.schema.path("channel").enumValues.includes("slack"));
  assert.ok(Communication.schema.path("deliveryProvider").enumValues.includes("slack"));
  assert.ok(communicationService.COMMUNICATION_CHANNELS.includes("slack"));
  assert.equal(communicationService.normalizeRecipientContact("C0123456789", "slack"), "C0123456789");
});

test("configuration status reports Slack bot readiness without exposing token", function () {
  const status = configurationStatus();
  assert.equal(status.slack.botToken, true);
  assert.equal(status.slack.defaultChannelId, "C0123456789");
  assert.equal(status.slack.defaultChannelName, "internal-team");
  assert.equal(status.slack.available, true);
  assert.equal(status.retention.communicationDays, 7);
  assert.equal(status.retention.otpDays, 7);
  assert.equal(Object.prototype.hasOwnProperty.call(status.slack, "token"), false);
});

test("Slack service posts a message to the selected channel with the bot token", async function () {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async function (url, options) {
    request = { url, options };
    return slackResponse({ ok: true, channel: "C0987654321", ts: "1720000000.000100" });
  };
  try {
    const result = await slackService.sendMessage({
      channelId: "C0987654321",
      channelName: "sales-team",
      text: "New lead requires review",
    });
    assert.equal(request.url, "https://slack.com/api/chat.postMessage");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, `Bearer ${process.env.SLACK_BOT_TOKEN}`);
    assert.deepEqual(JSON.parse(request.options.body), {
      channel: "C0987654321",
      text: "New lead requires review",
    });
    assert.equal(result.provider, "slack");
    assert.equal(result.providerMessageId, "1720000000.000100");
    assert.equal(result.response.channelName, "sales-team");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Slack channel synchronization returns accessible public and private channels", async function () {
  const originalFetch = global.fetch;
  slackService.clearChannelCache();
  global.fetch = async function (url, options) {
    assert.match(url, /^https:\/\/slack\.com\/api\/conversations\.list\?/);
    assert.equal(options.headers.Authorization, `Bearer ${process.env.SLACK_BOT_TOKEN}`);
    return slackResponse({
      ok: true,
      channels: [
        { id: "G0987654321", name: "private-ops", is_private: true, is_member: true },
        { id: "C0987654321", name: "sales-team", is_private: false, is_member: true },
      ],
      response_metadata: { next_cursor: "" },
    });
  };
  try {
    const channels = await slackService.listChannels({ refresh: true });
    assert.deepEqual(channels.map(function (item) { return item.name; }), ["private-ops", "sales-team"]);
    assert.equal(channels[0].isPrivate, true);
    assert.equal(channels[1].id, "C0987654321");
  } finally {
    global.fetch = originalFetch;
    slackService.clearChannelCache();
  }
});

test("communication rules store Slack channel ID, name and message fields", function () {
  assert.ok(CommunicationRule.schema.path("slackEnabled"));
  assert.ok(CommunicationRule.schema.path("slackChannelId"));
  assert.ok(CommunicationRule.schema.path("slackChannelName"));
  assert.ok(CommunicationRule.schema.path("slackMessage"));
});

test("a Slack-only notification rule is valid when channel and message are present", async function () {
  const result = await ruleService.normalizeInput(
    {
      name: "Provider rejected Slack alert",
      event: "provider_rejected",
      enabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      slackEnabled: true,
      slackChannelId: "C0987654321",
      slackChannelName: "#provider-updates",
      slackMessage: "Provider {{provider_name}} rejected lead {{lead_id}}. Reason: {{note}}",
      recipientSource: "customer",
      description: "Internal Slack notification",
    },
    {},
  );
  assert.equal(result.slackEnabled, true);
  assert.equal(result.slackChannelId, "C0987654321");
  assert.equal(result.slackChannelName, "provider-updates");
  assert.match(result.slackMessage, /{{lead_id}}/);
});

test("Slack-enabled rules reject a missing channel ID", async function () {
  const previous = process.env.SLACK_DEFAULT_CHANNEL_ID;
  process.env.SLACK_DEFAULT_CHANNEL_ID = "";
  try {
    await assert.rejects(
      ruleService.normalizeInput(
        {
          name: "Missing channel Slack alert",
          event: "provider_invalid",
          enabled: true,
          whatsappEnabled: false,
          emailEnabled: false,
          slackEnabled: true,
          slackChannelName: "internal-team",
          slackMessage: "Lead {{lead_id}} is invalid",
          recipientSource: "customer",
        },
        {},
      ),
      /Slack channel ID is required/,
    );
  } finally {
    process.env.SLACK_DEFAULT_CHANNEL_ID = previous;
  }
});

test("Slack-enabled rules reject blank messages", async function () {
  await assert.rejects(
    ruleService.normalizeInput(
      {
        name: "Blank Slack alert",
        event: "provider_invalid",
        enabled: true,
        whatsappEnabled: false,
        emailEnabled: false,
        slackEnabled: true,
        slackChannelId: "C0987654321",
        slackChannelName: "internal-team",
        slackMessage: "   ",
        recipientSource: "customer",
      },
      {},
    ),
    /Slack message is required/,
  );
});
