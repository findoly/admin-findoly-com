function present(value) {
  return Boolean(String(value || "").trim());
}

function invalidAwsSessionToken(env = {}) {
  const accessKeyId = String(env.AWS_ACCESS_KEY_ID || "").trim();
  const token = String(env.AWS_SESSION_TOKEN || "").trim();
  if (!token) return accessKeyId.startsWith("ASIA")
    ? "AWS_SESSION_TOKEN is required when using temporary AWS credentials"
    : "";
  if (
    /(?:^|[_\s-])(replace|placeholder|example|dummy|your)(?:$|[_\s-])/i.test(token) ||
    /[\s\u0000-\u001f\u007f]/.test(token) ||
    token.length < 16 ||
    token.length > 4096 ||
    !/^[A-Za-z0-9/+=._-]+$/.test(token)
  ) {
    return "AWS_SESSION_TOKEN is invalid; remove it for long-lived IAM credentials or provide the exact matching temporary session token";
  }
  return "";
}

function validHttpUrl(value, { httpsOnly = false } = {}) {
  try {
    const url = new URL(String(value || ""));
    return httpsOnly ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol);
  } catch (_error) {
    return false;
  }
}

function validOrigin(value, { httpsOnly = false } = {}) {
  try {
    const url = new URL(String(value || ""));
    if (httpsOnly && url.protocol !== "https:") return false;
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return url.pathname === "/" && !url.search && !url.hash && Boolean(url.hostname);
  } catch (_error) {
    return false;
  }
}

function databaseNameFromMongoUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["mongodb:", "mongodb+srv:"].includes(url.protocol)) return "";
    return decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] || "").trim();
  } catch (_error) {
    return "";
  }
}


function integerSettingError(env, key, { min, max, optional = true } = {}) {
  const raw = env[key];
  if ((raw === undefined || raw === null || String(raw).trim() === "") && optional) return "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return `${key} must be a whole number between ${min} and ${max}`;
  }
  return "";
}

function strongToken(value, minimum = 32) {
  const text = String(value || "").trim();
  return text.length >= minimum && !/(replace|placeholder|example|dummy|your[_ -]?(?:token|secret|key))/i.test(text);
}

function validateRuntimeConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  if (env.SKIP_DB !== "true" && !present(env.MONGODB_URI)) {
    errors.push("MONGODB_URI is required");
  } else if (env.SKIP_DB !== "true" && !databaseNameFromMongoUri(env.MONGODB_URI)) {
    errors.push("MONGODB_URI must include an explicit database name");
  }

  const sessionSecret = String(
    env.AUTH_COOKIE_SECRET || env.SESSION_SECRET || env.OTP_SECRET || "",
  );
  if (production && sessionSecret.length < 32) {
    errors.push("Set AUTH_COOKIE_SECRET (or SESSION_SECRET) to a random value of at least 32 characters");
  } else if (!production && sessionSecret.length < 32) {
    warnings.push("Development session secret is weak; configure AUTH_COOKIE_SECRET before production");
  }

  const otpUrls = [env.CRM_OTP_BASE_URL, env.CRM_OTP_SEND_URL, env.CRM_OTP_VERIFY_URL].filter(present);
  for (const url of otpUrls) {
    if (!validHttpUrl(url, { httpsOnly: production })) {
      errors.push(`OTP service URL is invalid${production ? " or is not HTTPS" : ""}: ${url}`);
    }
  }

  const corsOrigins = String(env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (production && !corsOrigins.length) {
    errors.push("CORS_ORIGINS must contain at least the CRM browser origin");
  }
  for (const origin of corsOrigins) {
    if (!validOrigin(origin, { httpsOnly: production })) {
      errors.push(`CORS origin is invalid${production ? " or is not HTTPS" : ""}: ${origin}`);
    }
  }

  const adminOrigin = env.CRM_ADMIN_ORIGIN || (production ? "https://admin.findoly.com" : "");
  if (production && !validOrigin(adminOrigin, { httpsOnly: true })) {
    errors.push("CRM_ADMIN_ORIGIN must be a valid HTTPS origin without a path");
  }

  const integerSettings = [
    ["MONGO_MAX_POOL_SIZE", 1, 500],
    ["MONGO_MIN_POOL_SIZE", 0, 100],
    ["MONGO_MAX_IDLE_TIME_MS", 1000, 600000],
    ["MONGO_SERVER_SELECTION_TIMEOUT_MS", 1000, 120000],
    ["CRM_QUERY_MAX_TIME_MS", 1000, 60000],
    ["CRM_OTP_RESEND_SECONDS", 1, 3600],
    ["CRM_OTP_MAX_SENDS_PER_MINUTE", 1, 20],
    ["CRM_OTP_RATE_WINDOW_SECONDS", 10, 3600],
    ["CRM_OTP_MAX_IP_REQUESTS_PER_HOUR", 5, 1000],
    ["CRM_OTP_IP_RATE_WINDOW_SECONDS", 60, 86400],
    ["CRM_OTP_MAX_IP_VERIFY_ATTEMPTS_PER_HOUR", 5, 5000],
    ["CRM_OTP_IP_VERIFY_WINDOW_SECONDS", 60, 86400],
    ["PUBLIC_INTAKE_RATE_MAX", 10, 10000],
    ["PUBLIC_INTAKE_RATE_WINDOW_MS", 60000, 86400000],
    ["CRM_PROVIDER_ACTION_API_TIMEOUT_MS", 3000, 30000],
    ["CRM_WHATSAPP_ACTION_EXPIRY_MINUTES", 5, 10080],
    ["CRM_OPENAI_TIMEOUT_MS", 1500, 30000],
  ];
  for (const [key, min, max] of integerSettings) {
    const message = integerSettingError(env, key, { min, max });
    if (message) errors.push(message);
  }
  const maxPool = Number(env.MONGO_MAX_POOL_SIZE || 30);
  const minPool = Number(env.MONGO_MIN_POOL_SIZE || 2);
  if (Number.isFinite(maxPool) && Number.isFinite(minPool) && minPool > maxPool) {
    errors.push("MONGO_MIN_POOL_SIZE cannot be greater than MONGO_MAX_POOL_SIZE");
  }

  const s3Values = {
    AWS_REGION: env.AWS_REGION,
    AWS_S3_BUCKET: env.AWS_S3_BUCKET || env.S3_BUCKET_NAME,
    AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY,
  };
  const configuredS3Parts = Object.entries(s3Values).filter(([, value]) => present(value));
  if (configuredS3Parts.length > 0 && configuredS3Parts.length < Object.keys(s3Values).length) {
    const missing = Object.entries(s3Values).filter(([, value]) => !present(value)).map(([key]) => key);
    warnings.push(`S3 configuration is incomplete; File Manager will stay disabled until ${missing.join(", ")} is configured`);
  }

  const sessionTokenError = invalidAwsSessionToken(env);
  if (configuredS3Parts.length === Object.keys(s3Values).length && sessionTokenError) {
    warnings.push(`${sessionTokenError}; File Manager will stay disabled`);
  }

  if (env.AWS_CLOUDFRONT_DOMAIN && /[/?#]/.test(String(env.AWS_CLOUDFRONT_DOMAIN).replace(/^https?:\/\//, ""))) {
    errors.push("AWS_CLOUDFRONT_DOMAIN must be a hostname without a path");
  }

  if (production && !strongToken(env.PUBLIC_INTAKE_API_TOKEN, 32)) {
    errors.push("PUBLIC_INTAKE_API_TOKEN must be a non-placeholder random value of at least 32 characters");
  }
  for (const key of ["COMMUNICATION_EVENT_API_TOKEN", "COMMUNICATION_OTP_API_TOKEN", "CUSTOMER_PORTAL_API_TOKEN"]) {
    if (present(env[key]) && !strongToken(env[key], 32)) {
      errors.push(`${key} must be a non-placeholder random value of at least 32 characters when configured`);
    }
  }
  if (production && !present(env.COMMUNICATION_EVENT_API_TOKEN)) {
    errors.push("COMMUNICATION_EVENT_API_TOKEN is required for the linked Provider CRM integration");
  }
  if (production && !present(env.COMMUNICATION_OTP_API_TOKEN)) {
    warnings.push("COMMUNICATION_OTP_API_TOKEN is not configured; unauthenticated communication OTP APIs will return 503");
  }
  if (production && !present(env.CUSTOMER_PORTAL_API_TOKEN)) {
    warnings.push("CUSTOMER_PORTAL_API_TOKEN is not configured; customer portal APIs will return 503");
  }

  if (present(env.CRM_OPENAI_API_KEY) && !strongToken(env.CRM_OPENAI_API_KEY, 32)) {
    errors.push("CRM_OPENAI_API_KEY must be a non-placeholder key of at least 32 characters when configured");
  }
  if (!present(env.CRM_OPENAI_API_KEY)) {
    warnings.push("CRM_OPENAI_API_KEY is not configured; AI-assisted customer requirement approval will be unavailable");
  }

  if (production) {
    if (!validHttpUrl(env.CRM_PROVIDER_ACTION_API_URL, { httpsOnly: true })) {
      errors.push("CRM_PROVIDER_ACTION_API_URL must be a valid HTTPS URL");
    }
    if (!strongToken(env.CRM_PROVIDER_ACTION_API_TOKEN, 32)) {
      errors.push("CRM_PROVIDER_ACTION_API_TOKEN must be a non-placeholder random value of at least 32 characters");
    }
    if (!strongToken(env.CRM_WHATSAPP_ACTION_SIGNING_SECRET, 32)) {
      errors.push("CRM_WHATSAPP_ACTION_SIGNING_SECRET must be a non-placeholder random value of at least 32 characters");
    }
    if (!strongToken(env.CRM_GUPSHUP_WEBHOOK_TOKEN, 32)) {
      errors.push("CRM_GUPSHUP_WEBHOOK_TOKEN must be a non-placeholder random value of at least 32 characters");
    }
    for (const key of [
      "CRM_GUPSHUP_API_KEY",
      "CRM_GUPSHUP_APP_ID",
      "CRM_GUPSHUP_APP_NAME",
      "CRM_GUPSHUP_SOURCE_NUMBER",
    ]) {
      if (!present(env[key])) errors.push(`${key} is required for Gupshup WhatsApp integration`);
    }
  }
  if (present(env.PROVIDER_PORTAL_BASE_URL) && !validOrigin(env.PROVIDER_PORTAL_BASE_URL, { httpsOnly: production })) {
    errors.push(`PROVIDER_PORTAL_BASE_URL must be a valid${production ? " HTTPS" : ""} origin without a path`);
  }

  return { production, errors, warnings };
}

function assertRuntimeConfig(env = process.env) {
  const result = validateRuntimeConfig(env);
  result.warnings.forEach((warning) => console.warn(`Configuration warning: ${warning}`));
  if (result.errors.length) {
    const error = new Error(`Invalid runtime configuration:\n- ${result.errors.join("\n- ")}`);
    error.code = "INVALID_RUNTIME_CONFIG";
    throw error;
  }
  return result;
}

module.exports = {
  validateRuntimeConfig,
  assertRuntimeConfig,
  validHttpUrl,
  validOrigin,
  databaseNameFromMongoUri,
  strongToken,
  invalidAwsSessionToken,
  integerSettingError,
};
