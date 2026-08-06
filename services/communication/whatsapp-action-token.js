"use strict";

const crypto = require("crypto");
const { validationError } = require("../../utils/validation");

const TOKEN_PREFIX = "findoly_unlock_v1";
const OPAQUE_TOKEN_PREFIX = "fu2_";
const OPAQUE_RANDOM_BYTES = 32;
const MAX_GENERATED_TOKEN_LENGTH = 64;

function signingSecret() {
  const secret = String(process.env.CRM_WHATSAPP_ACTION_SIGNING_SECRET || "").trim();
  if (secret.length < 32) throw validationError("WhatsApp action signing secret is not configured", 503);
  return secret;
}

function signatureFor(payloadPart, secret = signingSecret()) {
  return crypto.createHmac("sha256", secret)
    .update(`${TOKEN_PREFIX}.${payloadPart}`, "utf8")
    .digest().subarray(0, 20).toString("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function actionExpiryMinutes() {
  const value = Number(process.env.CRM_WHATSAPP_ACTION_EXPIRY_MINUTES || 1440);
  return Number.isFinite(value) ? Math.min(10080, Math.max(5, Math.trunc(value))) : 1440;
}

function createUnlockAction({ communicationId } = {}) {
  if (!String(communicationId || "").trim()) {
    throw validationError("WhatsApp unlock action is missing its communication reference");
  }
  const token = `${OPAQUE_TOKEN_PREFIX}${crypto.randomBytes(OPAQUE_RANDOM_BYTES).toString("base64url")}`;
  if (token.length > MAX_GENERATED_TOKEN_LENGTH) {
    throw validationError("Generated WhatsApp unlock action exceeds 64 characters", 500);
  }
  return token;
}

function createLegacyUnlockAction({ communicationId, now = new Date() }) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    c: String(communicationId || ""),
    i: issuedAt,
    x: issuedAt + actionExpiryMinutes() * 60,
    n: crypto.randomBytes(6).toString("base64url"),
  };
  if (!payload.c) throw validationError("WhatsApp unlock action is missing its communication reference");
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${TOKEN_PREFIX}.${payloadPart}.${signatureFor(payloadPart)}`;
}

function isOpaqueUnlockAction(token) {
  return new RegExp(`^${OPAQUE_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(String(token || "").trim());
}

function isLegacyUnlockAction(token) {
  return String(token || "").trim().startsWith(`${TOKEN_PREFIX}.`);
}

function isUnlockActionToken(token) {
  return isOpaqueUnlockAction(token) || isLegacyUnlockAction(token);
}

function verifyUnlockAction(token, { now = new Date() } = {}) {
  const normalized = String(token || "").trim();
  if (isOpaqueUnlockAction(normalized)) {
    return {
      version: 2,
      opaque: true,
      tokenHash: tokenHash(normalized),
    };
  }

  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw validationError("WhatsApp unlock action is invalid", 401);
  }
  if (!safeEqual(parts[2], signatureFor(parts[1]))) {
    throw validationError("WhatsApp unlock action signature is invalid", 401);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (_error) {
    throw validationError("WhatsApp unlock action payload is invalid", 401);
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!payload?.c || !Number.isInteger(payload.i) || !Number.isInteger(payload.x)) {
    throw validationError("WhatsApp unlock action payload is incomplete", 401);
  }
  if (payload.i > nowSeconds + 300 || payload.x < nowSeconds) {
    throw validationError("WhatsApp unlock action has expired", 410);
  }
  return {
    version: 1,
    opaque: false,
    communicationId: String(payload.c),
    issuedAt: new Date(payload.i * 1000),
    expiresAt: new Date(payload.x * 1000),
    nonce: String(payload.n || ""),
  };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

module.exports = {
  TOKEN_PREFIX,
  OPAQUE_TOKEN_PREFIX,
  MAX_GENERATED_TOKEN_LENGTH,
  actionExpiryMinutes,
  createLegacyUnlockAction,
  createUnlockAction,
  isLegacyUnlockAction,
  isOpaqueUnlockAction,
  isUnlockActionToken,
  verifyUnlockAction,
  tokenHash,
};
