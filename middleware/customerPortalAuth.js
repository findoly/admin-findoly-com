const crypto = require("crypto");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const authorization = String(req.get("authorization") || "");
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, "").trim();
  }
  return String(req.get("x-findoly-customer-token") || "").trim();
}

function requireCustomerPortalToken(req, res, next) {
  const configured = String(process.env.CUSTOMER_PORTAL_API_TOKEN || "").trim();
  if (!configured) {
    return res.status(503).json({
      success: false,
      code: "CUSTOMER_PORTAL_NOT_CONFIGURED",
      message: "Customer Portal integration is not configured",
    });
  }

  if (!safeEqual(bearerToken(req), configured)) {
    return res.status(401).json({
      success: false,
      code: "CUSTOMER_PORTAL_UNAUTHORIZED",
      message: "Customer Portal authentication failed",
    });
  }

  return next();
}

module.exports = { requireCustomerPortalToken, bearerToken, safeEqual };
