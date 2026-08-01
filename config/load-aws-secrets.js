const crypto = require("node:crypto");

const SERVICE = "secretsmanager";
const TARGET = "secretsmanager.GetSecretValue";
const ALGORITHM = "AWS4-HMAC-SHA256";
const PROTECTED_KEYS = new Set(["NODE_ENV", "PORT"]);

function present(value) {
  return Boolean(String(value || "").trim());
}

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function signingKey(secretAccessKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function awsDates(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function endpointForRegion(region) {
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return `https://${SERVICE}.${region}.${suffix}/`;
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function buildSignedRequest({
  region,
  secretId,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  now = new Date(),
}) {
  const endpoint = endpointForRegion(region);
  const url = new URL(endpoint);
  const body = JSON.stringify({ SecretId: secretId });
  const payloadHash = hash(body);
  const { amzDate, dateStamp } = awsDates(now);

  const signingHeaders = {
    "content-type": "application/x-amz-json-1.1",
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-target": TARGET,
  };
  if (present(sessionToken)) signingHeaders["x-amz-security-token"] = String(sessionToken).trim();

  const sortedHeaders = Object.entries(signingHeaders).sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = `${sortedHeaders
    .map(([key, value]) => `${key}:${normalizeHeaderValue(value)}`)
    .join("\n")}\n`;
  const signedHeaders = sortedHeaders.map(([key]) => key).join(";");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp, region), stringToSign, "hex");

  const headers = {
    "content-type": signingHeaders["content-type"],
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-target": TARGET,
    authorization: `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (signingHeaders["x-amz-security-token"]) {
    headers["x-amz-security-token"] = signingHeaders["x-amz-security-token"];
  }

  return { endpoint, body, headers };
}

function parseJson(text, message) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(message);
  }
}

function parseSecretPayload(responseBody) {
  let rawSecret;
  if (typeof responseBody.SecretString === "string") {
    rawSecret = responseBody.SecretString;
  } else if (typeof responseBody.SecretBinary === "string") {
    rawSecret = Buffer.from(responseBody.SecretBinary, "base64").toString("utf8");
  } else {
    throw new Error("AWS Secrets Manager response did not contain SecretString or SecretBinary");
  }

  const values = parseJson(rawSecret, "AWS Secrets Manager secret must contain valid JSON");
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("AWS Secrets Manager secret JSON must be an object of environment key-value pairs");
  }
  return values;
}

function isProtectedKey(key) {
  return PROTECTED_KEYS.has(key) || key.startsWith("CRM_SECRETS_");
}

function applySecretValues(values, env = process.env) {
  const pending = [];
  let protectedCount = 0;

  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`AWS Secrets Manager contains an invalid environment key: ${key}`);
    }
    if (isProtectedKey(key)) {
      protectedCount += 1;
      continue;
    }
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`AWS Secrets Manager value for ${key} must be a string, number, or boolean`);
    }
    pending.push([key, String(value)]);
  }

  for (const [key, value] of pending) env[key] = value;
  return { loaded: pending.length, protectedCount };
}

function requiredBootstrapConfig(env) {
  const config = {
    region: String(env.CRM_SECRETS_REGION || "").trim(),
    secretId: String(env.CRM_SECRETS_SECRET_ID || "").trim(),
    accessKeyId: String(env.CRM_SECRETS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(env.CRM_SECRETS_SECRET_ACCESS_KEY || "").trim(),
    sessionToken: String(env.CRM_SECRETS_SESSION_TOKEN || "").trim(),
  };

  if (!config.secretId) {
    if (env.NODE_ENV === "production") {
      throw new Error("CRM_SECRETS_SECRET_ID is required in production");
    }
    return null;
  }

  const missing = [
    ["CRM_SECRETS_REGION", config.region],
    ["CRM_SECRETS_ACCESS_KEY_ID", config.accessKeyId],
    ["CRM_SECRETS_SECRET_ACCESS_KEY", config.secretAccessKey],
  ].filter(([, value]) => !present(value)).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing AWS Secrets Manager bootstrap variables: ${missing.join(", ")}`);
  }
  if (!/^[a-z0-9-]+$/.test(config.region)) {
    throw new Error("CRM_SECRETS_REGION is invalid");
  }
  return config;
}

function timeoutMs(env) {
  const configured = Number(env.CRM_SECRETS_TIMEOUT_MS || 10000);
  if (!Number.isFinite(configured)) return 10000;
  return Math.min(Math.max(Math.trunc(configured), 1000), 30000);
}

async function loadAwsSecrets({ env = process.env, fetchImpl = global.fetch, now = () => new Date() } = {}) {
  const config = requiredBootstrapConfig(env);
  if (!config) return { loaded: 0, protectedCount: 0, skipped: true };
  if (typeof fetchImpl !== "function") {
    throw new Error("Node.js fetch is unavailable; Node.js 20 or newer is required");
  }

  const request = buildSignedRequest({ ...config, now: now() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(env));
  timer.unref();

  let response;
  try {
    response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("AWS Secrets Manager request timed out");
    }
    throw new Error(`AWS Secrets Manager request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const responseText = await response.text();
  const responseBody = responseText
    ? parseJson(responseText, "AWS Secrets Manager returned an invalid JSON response")
    : {};

  if (!response.ok) {
    const type = String(responseBody.__type || responseBody.code || "AWS_ERROR").split("#").pop();
    const message = String(responseBody.message || responseBody.Message || "Request failed");
    throw new Error(`AWS Secrets Manager request failed (${type}): ${message}`);
  }

  const result = applySecretValues(parseSecretPayload(responseBody), env);
  return { ...result, skipped: false };
}

module.exports = {
  PROTECTED_KEYS,
  applySecretValues,
  buildSignedRequest,
  loadAwsSecrets,
  parseSecretPayload,
  requiredBootstrapConfig,
};
