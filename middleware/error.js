function notFound(req, res) {
  if (req.originalUrl.startsWith("/api")) {
    return res
      .status(404)
      .json({ success: false, message: "API route not found" });
  }
  return res.status(404).render("404", { title: "Page not found" });
}

function normalizedError(error = {}) {
  if (
    error?.type === "entity.parse.failed" ||
    (error instanceof SyntaxError && error?.status === 400 && "body" in error)
  ) {
    return { status: 400, message: "Invalid JSON request body" };
  }
  if (error?.type === "entity.too.large") {
    return { status: 413, message: "Request body is too large" };
  }
  if (error?.code === 11000) {
    return { status: 409, message: "A record with the same unique value already exists" };
  }
  if (error?.name === "ValidationError") {
    const first = Object.values(error.errors || {})[0];
    return { status: 400, message: first?.message || "Validation failed" };
  }
  if (error?.name === "CastError") {
    return {
      status: 400,
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
  return {
    status,
    message: status >= 500 ? "Something went wrong" : error.message || "Request failed",
  };
}

function errorHandler(error, req, res, next) {
  const { status, message } = normalizedError(error);
  if (status >= 500) console.error(error);
  if (req.originalUrl.startsWith("/api")) {
    return res.status(status).json({ success: false, message });
  }
  return res.status(status).render("error", { title: "Error", message });
}

module.exports = { notFound, errorHandler, normalizedError };
