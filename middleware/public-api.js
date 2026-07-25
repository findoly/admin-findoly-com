const crypto = require("crypto");
const { hasPermission } = require("../utils/permissions");

const buckets = new Map();
let cleanupCounter = 0;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestToken(req) {
  const authorization = String(req.get("authorization") || "");
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, "").trim();
  }
  return String(req.get("x-findoly-intake-token") || "").trim();
}

function optionalIntakeToken(req, res, next) {
  const configured = String(process.env.PUBLIC_INTAKE_API_TOKEN || "").trim();
  if (!configured) return next();
  if (!safeEqual(requestToken(req), configured)) {
    return res.status(401).json({
      success: false,
      code: "PUBLIC_INTAKE_UNAUTHORIZED",
      message: "Public intake authentication failed",
    });
  }
  return next();
}

function communicationOtpAccess(req, res, next) {
  if (req.admin) {
    if (hasPermission(req.admin, "communications.send")) return next();
    return res.status(403).json({
      success: false,
      code: "COMMUNICATION_PERMISSION_REQUIRED",
      message: "You do not have permission to send or verify communication OTPs",
    });
  }

  const configured = String(process.env.COMMUNICATION_OTP_API_TOKEN || "").trim();
  if (!configured) {
    return res.status(503).json({
      success: false,
      code: "COMMUNICATION_OTP_NOT_CONFIGURED",
      message: "Public communication OTP access is not configured",
    });
  }
  const supplied = String(req.get("x-communication-otp-token") || requestToken(req)).trim();
  if (!safeEqual(supplied, configured)) {
    return res.status(401).json({
      success: false,
      code: "COMMUNICATION_OTP_UNAUTHORIZED",
      message: "Communication OTP authentication failed",
    });
  }
  return next();
}


function communicationEventAccess(req, res, next) {
  const configured = String(process.env.COMMUNICATION_EVENT_API_TOKEN || "").trim();
  if (!configured) {
    return res.status(503).json({
      success: false,
      code: "COMMUNICATION_EVENT_NOT_CONFIGURED",
      message: "Communication event integration is not configured",
    });
  }
  const authorization = String(req.get("authorization") || "");
  const supplied = String(
    req.get("x-communication-token") ||
      (/^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : ""),
  ).trim();
  if (!safeEqual(supplied, configured)) {
    return res.status(401).json({
      success: false,
      code: "COMMUNICATION_EVENT_UNAUTHORIZED",
      message: "Communication event authentication failed",
    });
  }
  return next();
}

function cleanupExpired(now) {
  cleanupCounter += 1;
  if (cleanupCounter % 100 !== 0) return;
  for (const [key, entry] of buckets.entries()) {
    if (!entry || entry.resetAt <= now) buckets.delete(key);
  }
}

function publicIntakeRateLimit(req, res, next) {
  const windowMs = Math.min(
    Math.max(Number(process.env.PUBLIC_INTAKE_RATE_WINDOW_MS || 900000) || 900000, 60000),
    86400000,
  );
  const maxRequests = Math.min(
    Math.max(Number(process.env.PUBLIC_INTAKE_RATE_MAX || 120) || 120, 10),
    10000,
  );
  const now = Date.now();
  cleanupExpired(now);
  const address = String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 120);
  const key = `${address}:${req.path}`;
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, maxRequests - entry.count);
  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  res.set("X-RateLimit-Limit", String(maxRequests));
  res.set("X-RateLimit-Remaining", String(remaining));
  res.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count > maxRequests) {
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      code: "PUBLIC_INTAKE_RATE_LIMIT",
      message: "Too many submissions from this network. Please try again later.",
      retryAfterSeconds: retryAfter,
    });
  }
  return next();
}

module.exports = {
  optionalIntakeToken,
  publicIntakeRateLimit,
  requestToken,
  safeEqual,
  communicationOtpAccess,
  communicationEventAccess,
};
