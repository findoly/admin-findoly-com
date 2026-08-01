"use strict";

const crypto = require("node:crypto");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function requestIdMiddleware(req, res, next) {
  const supplied = String(req.get("x-request-id") || "").trim();
  const requestId = REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
  req.requestId = requestId;
  res.set("X-Request-Id", requestId);
  return next();
}

module.exports = { REQUEST_ID_PATTERN, requestIdMiddleware };
