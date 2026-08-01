"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const util = require("node:util");

const {
  buildSignedRequest,
  createCloudWatchLogger,
  redactForLog,
  redactString,
} = require("../services/logging/cloudwatch-logger");

function fakeConsole() {
  const calls = { log: [], warn: [], error: [] };
  return {
    calls,
    log(...args) { calls.log.push(args); },
    warn(...args) { calls.warn.push(args); },
    error(...args) { calls.error.push(args); },
  };
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

function env(overrides = {}) {
  return {
    NODE_ENV: "production",
    CLOUDWATCH_LOGS_ENABLED: "true",
    CLOUDWATCH_LOG_GROUP: "/findoly/test/production",
    CLOUDWATCH_LOG_FLUSH_MS: "60000",
    CLOUDWATCH_LOG_MAX_QUEUE: "100",
    TEST_SECRETS_REGION: "ap-south-1",
    TEST_SECRETS_ACCESS_KEY_ID: "AKIAEXAMPLE000000000",
    TEST_SECRETS_SECRET_ACCESS_KEY: "example-secret-access-key",
    ...overrides,
  };
}

test("CloudWatch request signing does not expose the secret access key", () => {
  const request = buildSignedRequest({
    region: "ap-south-1",
    accessKeyId: "AKIAEXAMPLE000000000",
    secretAccessKey: "example-secret-access-key",
    target: "Logs_20140328.PutLogEvents",
    payload: {
      logGroupName: "/findoly/test/production",
      logStreamName: "test/stream",
      logEvents: [{ timestamp: 1, message: "hello" }],
    },
    now: new Date("2026-08-01T05:00:00.000Z"),
  });

  assert.equal(request.endpoint, "https://logs.ap-south-1.amazonaws.com/");
  assert.equal(
    request.headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE000000000/20260801/ap-south-1/logs/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, Signature=fd7bcac639691de2f003c0a6dcdff0ebd7efed02889d0ccd44a5eb9809397038",
  );
  assert.doesNotMatch(request.body, /example-secret-access-key/);
  assert.equal(request.headers["x-amz-target"], "Logs_20140328.PutLogEvents");
});

test("redaction removes credentials, tokens, cookies, request bodies and MongoDB passwords", () => {
  const redacted = redactForLog({
    password: "plain-password",
    authorization: "Bearer top-secret-token",
    cookie: "session=secret",
    body: { phone: "9999999999" },
    nested: {
      MONGODB_URI: "mongodb+srv://admin:password@example.mongodb.net/findoly_prod",
      safe: "visible",
    },
  });

  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.cookie, "[REDACTED]");
  assert.equal(redacted.body, "[REDACTED]");
  assert.equal(redacted.nested.MONGODB_URI, "[REDACTED]");
  assert.equal(redacted.nested.safe, "visible");
  assert.equal(
    redactString("mongodb://admin:password@localhost/db Bearer abc.def.ghi"),
    "mongodb://[REDACTED]@localhost/db Bearer [REDACTED]",
  );
});

test("console output is preserved and exact plain text is forwarded to CloudWatch", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    hostname: "test-host",
    pid: 123,
    randomId: "abcd1234",
    now: () => new Date("2026-08-01T05:00:00.000Z"),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.error("Unlock failed", {
    token: "same-console-value",
    uri: "mongodb://user:pass@localhost/db",
  });

  assert.equal(consoleObject.calls.error.length, 1);
  assert.deepEqual(consoleObject.calls.error[0], [
    "Unlock failed",
    {
      token: "same-console-value",
      uri: "mongodb://user:pass@localhost/db",
    },
  ]);

  const result = await logger.flush();
  assert.equal(result.sent, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].logGroupName, "/findoly/test/production");
  assert.equal(requests[1].logEvents.length, 1);
  assert.equal(
    requests[1].logEvents[0].message,
    util.format("Unlock failed", {
      token: "same-console-value",
      uri: "mongodb://user:pass@localhost/db",
    }),
  );
  assert.doesNotMatch(requests[1].logEvents[0].message, /^\{\"timestamp\"/);
  logger.uninstall();
});

test("CloudWatch failures never throw through console and do not recursively enqueue internal errors", async () => {
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    fetchImpl: async () => { throw new Error("network unavailable"); },
  });

  logger.install();
  assert.doesNotThrow(() => consoleObject.warn("still available"));
  const result = await logger.flush();
  assert.equal(result.failed, true);
  assert.equal(logger.diagnostics().queueLength, 1);
  assert.equal(consoleObject.calls.warn.length, 1);
  assert.equal(consoleObject.calls.error.length, 1);
  assert.match(String(consoleObject.calls.error[0][0]), /CloudWatch logger/);
  logger.uninstall();
});

test("queue limits drop the oldest CloudWatch entries without affecting console output", () => {
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env({ CLOUDWATCH_LOG_MAX_QUEUE: "100" }),
    consoleObject,
    fetchImpl: async () => response(200, {}),
  });

  logger.install();
  for (let index = 0; index < 110; index += 1) {
    consoleObject.log("message", index);
  }
  const state = logger.diagnostics();
  assert.equal(consoleObject.calls.log.length, 110);
  assert.equal(state.queueLength, 100);
  assert.equal(state.droppedCount, 10);
  logger.uninstall();
});

test("logging can be disabled without changing normal console behavior", () => {
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env({ CLOUDWATCH_LOGS_ENABLED: "false" }),
    consoleObject,
    fetchImpl: async () => assert.fail("must not call CloudWatch"),
  });

  logger.install();
  consoleObject.error("local only");
  assert.equal(consoleObject.calls.error.length, 1);
  assert.equal(logger.diagnostics().queueLength, 0);
  logger.uninstall();
});
