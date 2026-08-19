"use strict";

const crypto = require("crypto");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function scheduledJobAuth(req, res, next) {
  const expected = String(process.env.CRM_SCHEDULED_JOB_SECRET || "").trim();
  if (!expected) {
    return res.status(503).json({ success: false, message: "Scheduled job authentication is not configured" });
  }
  const authorization = String(req.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = String(match?.[1] || "").trim();
  if (!supplied || !safeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, message: "Scheduled job authentication failed" });
  }
  req.scheduledJob = { authenticated: true };
  next();
}

module.exports = { safeEqual, scheduledJobAuth };
