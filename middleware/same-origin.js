"use strict";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch (_error) {
    return "";
  }
}

function configuredAdminOrigin(env = process.env) {
  const explicit = normalizeOrigin(env.CRM_ADMIN_ORIGIN || env.APP_BASE_URL);
  if (explicit) return explicit;
  return env.NODE_ENV === "production" ? "https://admin.findoly.com" : "";
}

function requestOrigin(req) {
  const origin = normalizeOrigin(req.get("origin"));
  if (origin) return origin;
  const referer = normalizeOrigin(req.get("referer"));
  return referer;
}

function sameOriginAdminMutation(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase()) || !req.admin) return next();

  const expected = configuredAdminOrigin();
  const actual = requestOrigin(req);
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_CROSS_SITE_REQUEST_BLOCKED",
      message: "Cross-site admin requests are not allowed",
    });
  }

  if (expected && actual !== expected) {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ORIGIN_REQUIRED",
      message: "Admin request origin validation failed",
    });
  }

  if (!expected && process.env.NODE_ENV === "production") {
    return res.status(503).json({
      success: false,
      code: "ADMIN_ORIGIN_NOT_CONFIGURED",
      message: "Admin request protection is not configured",
    });
  }

  const contentType = String(req.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return res.status(415).json({
      success: false,
      code: "ADMIN_CONTENT_TYPE_NOT_ALLOWED",
      message: "Unsupported content type",
    });
  }
  return next();
}

module.exports = {
  SAFE_METHODS,
  configuredAdminOrigin,
  normalizeOrigin,
  requestOrigin,
  sameOriginAdminMutation,
};
