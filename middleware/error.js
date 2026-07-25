const SAFE_OPERATIONAL_CODES = new Set([
  "GEOCODING_NOT_CONFIGURED",
  "GEOCODING_UNAVAILABLE",
  "GEOCODING_INVALID_RESPONSE",
  "PINCODE_NOT_FOUND",
  "PINCODE_INVALID",
  "OTP_SERVICE_UNAVAILABLE",
  "OTP_SERVICE_RATE_LIMIT",
  "S3_NOT_CONFIGURED",
  "S3_REQUEST_FAILED",
]);

function notFound(req, res) {
  if (req.originalUrl.startsWith("/api")) {
    return res
      .status(404)
      .json({ success: false, code: "ROUTE_NOT_FOUND", message: "API route not found" });
  }
  return res.status(404).render("404", { title: "Page not found" });
}

function normalizedError(error = {}) {
  if (
    error?.type === "entity.parse.failed" ||
    (error instanceof SyntaxError && error?.status === 400 && "body" in error)
  ) {
    return { status: 400, code: "INVALID_JSON", message: "Invalid JSON request body" };
  }
  if (error?.type === "entity.too.large") {
    return { status: 413, code: "REQUEST_TOO_LARGE", message: "Request body is too large" };
  }
  if (error?.code === 11000) {
    return { status: 409, code: "DUPLICATE_RECORD", message: "A record with the same unique value already exists" };
  }
  if (error?.name === "ValidationError") {
    const errors = Object.entries(error.errors || {}).map(([field, detail]) => ({
      field,
      message: detail?.message || "Invalid value",
    }));
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: errors[0]?.message || "Validation failed",
      errors,
    };
  }
  if (error?.name === "CastError") {
    return {
      status: 400,
      code: "INVALID_VALUE",
      message: error.path ? `Invalid value for ${error.path}` : "Invalid value",
    };
  }

  const requestedStatus = Number(error.status || error.statusCode || 500);
  const status =
    Number.isInteger(requestedStatus) &&
    requestedStatus >= 400 &&
    requestedStatus <= 599
      ? requestedStatus
      : 500;
  const code = typeof error.code === "string" && /^[A-Z0-9_:-]{2,80}$/.test(error.code)
    ? error.code
    : status >= 500
      ? "INTERNAL_ERROR"
      : "REQUEST_FAILED";
  const exposeMessage = status < 500 || error.expose === true || SAFE_OPERATIONAL_CODES.has(code);
  return {
    status,
    code,
    message: exposeMessage ? error.message || "Request failed" : "Something went wrong",
  };
}

function errorHandler(error, req, res, next) {
  const normalized = normalizedError(error);
  if (normalized.status >= 500) {
    console.error(`[${normalized.code}] ${req.method} ${req.originalUrl}:`, error);
  }
  if (req.originalUrl.startsWith("/api")) {
    return res.status(normalized.status).json({
      success: false,
      code: normalized.code,
      message: normalized.message,
      ...(normalized.errors ? { errors: normalized.errors } : {}),
    });
  }
  return res.status(normalized.status).render("error", {
    title: "Error",
    message: normalized.message,
  });
}

module.exports = { notFound, errorHandler, normalizedError, SAFE_OPERATIONAL_CODES };
