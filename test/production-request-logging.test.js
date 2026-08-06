"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  morganCloudWatchStream,
  requestLoggingMiddleware,
  requestPath,
} = require("../middleware/request-logging");

test("request logging emits safe request and response records without query secrets", () => {
  const records = [];
  const originalInfo = console.info;
  console.info = (...args) => records.push(args);
  try {
    const req = {
      requestId: "request-1",
      method: "POST",
      originalUrl: "/api/webhooks/whatsapp?token=top-secret",
      admin: { employeeId: "employee-1" },
    };
    const res = new EventEmitter();
    res.statusCode = 202;
    res.writableEnded = true;
    res.getHeader = (name) => String(name).toLowerCase() === "content-length" ? "42" : undefined;
    let continued = false;
    requestLoggingMiddleware(req, res, () => { continued = true; });
    res.emit("finish");

    assert.equal(continued, true);
    assert.equal(requestPath(req), "/api/webhooks/whatsapp");
    assert.equal(records[0][0].event, "http_request_started");
    assert.equal(records[0][0].path, "/api/webhooks/whatsapp");
    assert.equal(records[1][0].event, "http_response_completed");
    assert.equal(records[1][0].status, 202);
    assert.equal(records[1][0].responseBytes, 42);
    assert.equal(records[1][0].actorId, "employee-1");
    assert.doesNotMatch(JSON.stringify(records), /top-secret/);
  } finally {
    console.info = originalInfo;
  }
});

test("Morgan output is routed through console.info for CloudWatch interception", () => {
  const records = [];
  const originalInfo = console.info;
  console.info = (...args) => records.push(args);
  try {
    morganCloudWatchStream().write("GET /api/health 200 2.1 ms\n");
    assert.deepEqual(records, [["GET /api/health 200 2.1 ms"]]);
  } finally {
    console.info = originalInfo;
  }
});
