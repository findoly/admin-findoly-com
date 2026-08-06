"use strict";

function requestPath(req = {}) {
  const raw = String(req.originalUrl || req.url || req.path || "/");
  const queryIndex = raw.indexOf("?");
  return (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw) || "/";
}

function actorId(req = {}) {
  return String(
    req.admin?.employeeId
      || req.admin?.id
      || req.user?.employeeId
      || req.user?.id
      || "",
  ).slice(0, 120);
}

function responseBytes(res = {}) {
  const raw = typeof res.getHeader === "function" ? res.getHeader("content-length") : "";
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requestLoggingMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const base = {
    requestId: req.requestId || "",
    method: String(req.method || "").toUpperCase(),
    path: requestPath(req),
  };
  console.info({ event: "http_request_started", ...base });

  let completed = false;
  const complete = (event) => {
    if (completed) return;
    completed = true;
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.info({
      event,
      ...base,
      status: Number(res.statusCode || 0),
      durationMs: Number(elapsed.toFixed(2)),
      responseBytes: responseBytes(res),
      actorId: actorId(req),
    });
  };

  res.once("finish", () => complete("http_response_completed"));
  res.once("close", () => complete(res.writableEnded ? "http_response_completed" : "http_response_closed"));
  next();
}

function morganCloudWatchStream() {
  return {
    write(message) {
      const text = String(message || "").trimEnd();
      if (text) console.info(text);
    },
  };
}

module.exports = {
  actorId,
  morganCloudWatchStream,
  requestLoggingMiddleware,
  requestPath,
  responseBytes,
};
