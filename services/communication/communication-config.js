const { textValue } = require("../../utils/validation");

const truthy = function (value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
};

const deliveryMode = function () {
  const mode = String(process.env.MESSAGE_DELIVERY_MODE || "local").toLowerCase();
  return mode === "lambda" ? "lambda" : "local";
};

const metaApiVersion = function () {
  return textValue(process.env.META_WHATSAPP_API_VERSION || "v25.0", {
    label: "Meta API version",
    required: true,
    maxLength: 20,
  });
};

const metaBaseUrl = function () {
  return `https://graph.facebook.com/${metaApiVersion()}`;
};

const defaultCountryCode = function () {
  return String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, "") || "91";
};

const retentionDays = function (value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const configurationStatus = function () {
  const mode = deliveryMode();
  return {
    deliveryMode: mode,
    whatsapp: {
      accessToken: Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN),
      phoneNumberId: Boolean(process.env.META_WHATSAPP_PHONE_NUMBER_ID),
      businessAccountId: Boolean(process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID),
      webhookVerifyToken: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      appSecret: Boolean(process.env.META_APP_SECRET),
      apiVersion: metaApiVersion(),
      defaultCountryCode: defaultCountryCode(),
    },
    email: {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
      credentials: Boolean(
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
          process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
          process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
      ),
      fromEmail: Boolean(process.env.SES_FROM_EMAIL),
      fromName: process.env.SES_FROM_NAME || process.env.APP_NAME || "Findoly",
      configurationSet: process.env.SES_CONFIGURATION_SET || "",
    },
    slack: {
      botToken: Boolean(process.env.SLACK_BOT_TOKEN),
      defaultChannelId: process.env.SLACK_DEFAULT_CHANNEL_ID || "",
      defaultChannelName: process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team",
      channelCacheSeconds: Math.max(30, Number(process.env.SLACK_CHANNEL_CACHE_SECONDS || 300) || 300),
      available: mode === "lambda"
        ? Boolean(process.env.MESSAGE_LAMBDA_URL)
        : Boolean(process.env.SLACK_BOT_TOKEN),
    },
    systemRouting: {
      slackAllEvents: process.env.SYSTEM_EVENT_SLACK_ENABLED === undefined
        ? true
        : truthy(process.env.SYSTEM_EVENT_SLACK_ENABLED),
      providerUnlockAndStatusEmail: process.env.PROVIDER_EVENT_EMAIL_ENABLED === undefined
        ? true
        : truthy(process.env.PROVIDER_EVENT_EMAIL_ENABLED),
      whatsappIntegrated: false,
    },
    lambda: {
      url: Boolean(process.env.MESSAGE_LAMBDA_URL),
      authToken: Boolean(process.env.MESSAGE_LAMBDA_AUTH_TOKEN),
    },
    retention: {
      communicationDays: retentionDays(process.env.COMMUNICATION_LOG_RETENTION_DAYS, 7),
      otpDays: retentionDays(process.env.OTP_RETENTION_DAYS, 7),
    },
    otp: {
      expiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 5),
      resendSeconds: Number(process.env.OTP_RESEND_SECONDS || 60),
      maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
      secret: Boolean(process.env.OTP_SECRET),
      retentionDays: retentionDays(process.env.OTP_RETENTION_DAYS, 7),
    },
  };
};

module.exports = {
  truthy,
  deliveryMode,
  metaApiVersion,
  metaBaseUrl,
  defaultCountryCode,
  configurationStatus,
};
