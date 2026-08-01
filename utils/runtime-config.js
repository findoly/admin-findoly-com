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

function validateRuntimeConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  if (env.SKIP_DB !== "true" && !present(env.MONGODB_URI)) {
    errors.push("MONGODB_URI is required");
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

  if (production && !present(env.PUBLIC_INTAKE_API_TOKEN)) {
    warnings.push("PUBLIC_INTAKE_API_TOKEN is not configured; public enquiry aliases rely on rate limiting only");
  }
  if (production && !present(env.COMMUNICATION_EVENT_API_TOKEN)) {
    warnings.push("COMMUNICATION_EVENT_API_TOKEN is not configured; communication integration events will reject requests");
  }
  if (production && !present(env.COMMUNICATION_OTP_API_TOKEN)) {
    warnings.push("COMMUNICATION_OTP_API_TOKEN is not configured; unauthenticated communication OTP APIs will return 503");
  }
  if (production && !present(env.CUSTOMER_PORTAL_API_TOKEN)) {
    warnings.push("CUSTOMER_PORTAL_API_TOKEN is not configured; customer portal APIs will return 503");
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

module.exports = { validateRuntimeConfig, assertRuntimeConfig, validHttpUrl, invalidAwsSessionToken };
