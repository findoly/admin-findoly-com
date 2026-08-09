const { textValue } = require("../../utils/validation");

const truthy = function (value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
};

const deliveryMode = function () {
  const mode = String(process.env.MESSAGE_DELIVERY_MODE || "local").toLowerCase();
  return mode === "lambda" ? "lambda" : "local";
};

const gupshupBaseUrl = function () {
  return textValue(process.env.CRM_GUPSHUP_API_BASE_URL || "https://api.gupshup.io", {
    label: "Gupshup API base URL",
    required: true,
    maxLength: 500,
  }).replace(/\/+$/, "");
};

const defaultCountryCode = function () {
  return String(process.env.CRM_WHATSAPP_DEFAULT_COUNTRY_CODE || process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91")
    .replace(/\D/g, "") || "91";
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
      provider: "gupshup",
      apiKey: Boolean(process.env.CRM_GUPSHUP_API_KEY),
      appId: Boolean(process.env.CRM_GUPSHUP_APP_ID),
      appName: Boolean(process.env.CRM_GUPSHUP_APP_NAME),
      sourceNumber: Boolean(process.env.CRM_GUPSHUP_SOURCE_NUMBER),
      webhookToken: Boolean(process.env.CRM_GUPSHUP_WEBHOOK_TOKEN),
      apiBaseUrl: gupshupBaseUrl(),
      defaultCountryCode: defaultCountryCode(),
    },
    email: {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
      credentials: Boolean(
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
          || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
          || process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
      ),
      fromEmail: Boolean(process.env.SES_FROM_EMAIL),
      fromName: process.env.SES_FROM_NAME || process.env.APP_NAME || "Findoly",
      configurationSet: process.env.SES_CONFIGURATION_SET || "",
    },
    systemRouting: {
      internalAlertEmail: process.env.INTERNAL_ALERT_EMAIL || "alert@findoly.com",
      internalAlertEmailEnabled: process.env.INTERNAL_ALERT_EMAIL_ENABLED === undefined ? true : truthy(process.env.INTERNAL_ALERT_EMAIL_ENABLED),
      providerUnlockAndStatusEmail: process.env.PROVIDER_EVENT_EMAIL_ENABLED === undefined ? true : truthy(process.env.PROVIDER_EVENT_EMAIL_ENABLED),
      whatsappIntegrated: Boolean(
        process.env.CRM_GUPSHUP_API_KEY
          && process.env.CRM_GUPSHUP_APP_ID
          && process.env.CRM_GUPSHUP_APP_NAME
          && process.env.CRM_GUPSHUP_SOURCE_NUMBER,
      ),
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

module.exports = { truthy, deliveryMode, gupshupBaseUrl, defaultCountryCode, configurationStatus };
