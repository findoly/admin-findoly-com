const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SKIP_DB = "true";
process.env.MESSAGE_DELIVERY_MODE = "local";
process.env.COMMUNICATION_LOG_RETENTION_DAYS = "7";
process.env.OTP_RETENTION_DAYS = "7";
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/TEST";
process.env.SLACK_CHANNEL_NAME = "internal-team";

const Communication = require("../models/Communication");
const OtpRequest = require("../models/OtpRequest");
const communicationService = require("../services/communication/communication-service");
const slackService = require("../services/communication/slack-service");
const { configurationStatus } = require("../services/communication/communication-config");

const ttlIndex = function (model, name) {
  return model.schema.indexes().find(function (row) {
    return row[1] && row[1].name === name;
  });
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
  assert.equal(communicationService.normalizeRecipientContact("#internal-team", "slack"), "internal-team");
});

test("configuration status reports Slack and retention without exposing secrets", function () {
  const status = configurationStatus();
  assert.equal(status.slack.webhookUrl, true);
  assert.equal(status.slack.channelName, "internal-team");
  assert.equal(status.slack.available, true);
  assert.equal(status.retention.communicationDays, 7);
  assert.equal(status.retention.otpDays, 7);
  assert.equal(Object.prototype.hasOwnProperty.call(status.slack, "url"), false);
});

test("Slack service posts only the text payload to the configured incoming webhook", async function () {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async function (url, options) {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async function () {
        return "ok";
      },
    };
  };
  try {
    const result = await slackService.sendMessage({
      channelName: "internal-team",
      text: "New lead requires review",
    });
    assert.equal(request.url, process.env.SLACK_WEBHOOK_URL);
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { text: "New lead requires review" });
    assert.equal(result.provider, "slack");
    assert.equal(result.status, "sent");
    assert.equal(result.response.channelName, "internal-team");
  } finally {
    global.fetch = originalFetch;
  }
});

const CommunicationRule = require("../models/CommunicationRule");
const ruleService = require("../services/communication/rule-service");

test("communication rules store Slack channel and message fields", function () {
  assert.ok(CommunicationRule.schema.path("slackEnabled"));
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
      slackChannelName: "#internal-team",
      slackMessage: "Provider {{provider_name}} rejected lead {{lead_id}}. Reason: {{note}}",
      recipientSource: "customer",
      description: "Internal Slack notification",
    },
    {},
  );
  assert.equal(result.slackEnabled, true);
  assert.equal(result.slackChannelName, "internal-team");
  assert.match(result.slackMessage, /{{lead_id}}/);
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
        slackChannelName: "internal-team",
        slackMessage: "   ",
        recipientSource: "customer",
      },
      {},
    ),
    /Slack message is required/,
  );
});
