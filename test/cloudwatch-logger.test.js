"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSignedRequest,
  createCloudWatchLogger,
  redactForLog,
  redactString,
} = require("../services/logging/cloudwatch-logger");

function fakeConsole() {
  const calls = { log: [], info: [], debug: [], warn: [], error: [] };
  return {
    calls,
    log(...args) { calls.log.push(args); },
    info(...args) { calls.info.push(args); },
    debug(...args) { calls.debug.push(args); },
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await wait(intervalMs);
  }
}

function putRequests(requests) {
  return requests.filter((request) => Array.isArray(request.logEvents));
}

function parseBatchEvents(request) {
  return request.logEvents.map((event) => JSON.parse(event.message));
}

function env(overrides = {}) {
  return {
    NODE_ENV: "production",
    CLOUDWATCH_LOGS_ENABLED: "true",
    CLOUDWATCH_LOG_GROUP: "/findoly/test/production",
    CLOUDWATCH_LOG_FLUSH_MS: "60000",
    CLOUDWATCH_LOG_BATCH_EVENTS: "20",
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

test("CloudWatch batching defaults to 60 seconds or 20 events", () => {
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env({
      CLOUDWATCH_LOG_FLUSH_MS: undefined,
      CLOUDWATCH_LOG_BATCH_EVENTS: undefined,
    }),
    consoleObject: fakeConsole(),
    fetchImpl: async () => response(200, {}),
  });

  logger.configureFromEnv();
  const state = logger.diagnostics();
  assert.equal(state.flushMs, 60000);
  assert.equal(state.batchEvents, 20);
});

test("a partial batch stays queued and shutdown sends it as one CloudWatch row", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.log("queued event");
  await wait(25);
  assert.equal(requests.length, 0);
  assert.equal(logger.diagnostics().queueLength, 1);

  await logger.shutdown();
  const uploaded = putRequests(requests);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].logEvents.length, 1);
  const [batch] = parseBatchEvents(uploaded[0]);
  assert.equal(batch.event, "test-service_log_batch");
  assert.equal(batch.batchSize, 1);
  assert.equal(batch.entryCount, 1);
  assert.equal(batch.entries[0].message, "queued event");
});

test("20 queued events become one CloudWatch row and later partial events wait", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  for (let index = 0; index < 45; index += 1) {
    consoleObject.log("message", index);
  }

  await waitFor(() => putRequests(requests).length === 2);
  await wait(25);

  const immediateBatches = putRequests(requests);
  assert.deepEqual(immediateBatches.map((request) => request.logEvents.length), [1, 1]);
  assert.deepEqual(
    immediateBatches.flatMap(parseBatchEvents).map((batch) => batch.entryCount),
    [20, 20],
  );
  assert.equal(logger.diagnostics().queueLength, 5);

  await logger.shutdown();
  const allBatches = putRequests(requests);
  assert.deepEqual(allBatches.map((request) => request.logEvents.length), [1, 1, 1]);
  assert.deepEqual(
    allBatches.flatMap(parseBatchEvents).map((batch) => batch.entryCount),
    [20, 20, 5],
  );
});

test("the time threshold sends a partial batch as one CloudWatch row", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env({ CLOUDWATCH_LOG_FLUSH_MS: "250" }),
    consoleObject,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.info("time-based batch");
  await waitFor(() => putRequests(requests).length === 1, { timeoutMs: 1000 });

  const uploaded = putRequests(requests);
  assert.equal(uploaded[0].logEvents.length, 1);
  const [batch] = parseBatchEvents(uploaded[0]);
  assert.equal(batch.entryCount, 1);
  assert.equal(batch.entries[0].message, "time-based batch");
  logger.uninstall();
});

test("console output is preserved while CloudWatch receives one redacted batch row", async () => {
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
    now: () => new Date("2026-08-01T05:00:00.000Z"),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.error("Open enquiry failed", {
    token: "same-console-value",
    uri: "mongodb://user:pass@localhost/db",
  });

  assert.equal(consoleObject.calls.error.length, 1);
  assert.deepEqual(consoleObject.calls.error[0], [
    "Open enquiry failed",
    {
      token: "same-console-value",
      uri: "mongodb://user:pass@localhost/db",
    },
  ]);

  const result = await logger.flush();
  assert.equal(result.sent, 1);
  const uploaded = putRequests(requests);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].logEvents.length, 1);
  const [batch] = parseBatchEvents(uploaded[0]);
  assert.equal(batch.hostname, "test-host");
  assert.equal(batch.pid, 123);
  assert.equal(batch.entryCount, 1);
  assert.match(batch.entries[0].message, /Open enquiry failed/);
  assert.doesNotMatch(batch.entries[0].message, /same-console-value|user:pass/);
  assert.match(batch.entries[0].message, /REDACTED/);
  logger.uninstall();
});

test("console.info and console.debug remain separate entries inside one row", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "test-service",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });
  logger.install();
  consoleObject.info("request completed", 200);
  consoleObject.debug("provider skipped", "outside_radius");
  await logger.flush();
  assert.equal(consoleObject.calls.info.length, 1);
  assert.equal(consoleObject.calls.debug.length, 1);
  const entries = putRequests(requests)
    .flatMap(parseBatchEvents)
    .flatMap((batch) => batch.entries);
  assert.deepEqual(entries.map((entry) => entry.message), [
    "request completed 200",
    "provider skipped outside_radius",
  ]);
  logger.uninstall();
});

test("structured events keep their fields inside the merged entries array", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "crm",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    now: () => new Date("2026-08-01T05:00:00.000Z"),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.info({
    event: "http_response_completed",
    requestId: "request-123",
    status: 200,
    authorization: "Bearer hidden",
  });
  await logger.flush();

  const [batch] = parseBatchEvents(putRequests(requests)[0]);
  assert.equal(batch.event, "crm_log_batch");
  assert.equal(batch.entries[0].event, "http_response_completed");
  assert.equal(batch.entries[0].requestId, "request-123");
  assert.equal(batch.entries[0].status, 200);
  assert.equal(batch.entries[0].authorization, "[REDACTED]");
  assert.equal(batch.entries[0].level, "info");
  assert.equal(batch.entries[0].timestamp, "2026-08-01T05:00:00.000Z");
  logger.uninstall();
});

test("oversized batches split into the minimum safe number of CloudWatch rows", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  const logger = createCloudWatchLogger({
    service: "crm",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env({ CLOUDWATCH_LOG_BATCH_EVENTS: "3" }),
    consoleObject,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, {});
    },
  });

  logger.install();
  const largeMessage = "x".repeat(150 * 1024);
  consoleObject.log(largeMessage);
  consoleObject.log(largeMessage);
  consoleObject.log(largeMessage);
  await waitFor(() => putRequests(requests).length === 1);

  const [request] = putRequests(requests);
  assert.equal(request.logEvents.length, 3);
  const batches = parseBatchEvents(request);
  assert.deepEqual(batches.map((batch) => batch.entryCount), [1, 1, 1]);
  assert.ok(batches.every((batch) => batch.batchSize === 3));
  assert.ok(batches.every((batch) => batch.partCount === 3));
  assert.ok(request.logEvents.every(
    (event) => Buffer.byteLength(event.message, "utf8") <= 240 * 1024,
  ));
  logger.uninstall();
});

test("a failed merged upload stays queued and retries without losing entries", async () => {
  const requests = [];
  const consoleObject = fakeConsole();
  let failPut = true;
  const logger = createCloudWatchLogger({
    service: "crm",
    credentialPrefix: "TEST_SECRETS_",
    defaultLogGroup: "/findoly/test/production",
    env: env(),
    consoleObject,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.logEvents && failPut) throw new Error("temporary network failure");
      return response(200, {});
    },
  });

  logger.install();
  consoleObject.warn("retry me");
  const failed = await logger.flush();
  assert.equal(failed.failed, true);
  assert.equal(logger.diagnostics().queueLength, 1);

  failPut = false;
  const retried = await logger.flush();
  assert.equal(retried.sent, 1);
  assert.equal(logger.diagnostics().queueLength, 0);
  const attempts = putRequests(requests);
  assert.equal(attempts.length, 2);
  const firstBatch = parseBatchEvents(attempts[0])[0];
  const secondBatch = parseBatchEvents(attempts[1])[0];
  assert.equal(firstBatch.batchId, secondBatch.batchId);
  assert.equal(secondBatch.entries[0].message, "retry me");
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
    env: env({
      CLOUDWATCH_LOG_BATCH_EVENTS: "10000",
      CLOUDWATCH_LOG_MAX_QUEUE: "100",
    }),
    consoleObject,
    fetchImpl: async () => response(200, {}),
  });

  logger.install();
  for (let index = 0; index < 110; index += 1) {
    consoleObject.log("message", index);
  }
  const state = logger.diagnostics();
  assert.equal(consoleObject.calls.log.length, 110);
  assert.ok(state.queueLength <= 100);
  assert.ok(state.droppedCount >= 0);
  assert.ok(state.queueLength + state.droppedCount <= 110);
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
