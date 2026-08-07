"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const util = require("node:util");

const SERVICE = "logs";
const ALGORITHM = "AWS4-HMAC-SHA256";
const CONTENT_TYPE = "application/x-amz-json-1.1";
const MAX_EVENT_BYTES = 240 * 1024;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_MERGED_BATCH_ENTRY_BYTES = 800 * 1024;
const MAX_BATCH_EVENTS = 10000;
const EVENT_OVERHEAD_BYTES = 26;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|jwt|otp|razorpay|whatsapp|mongodb[_-]?uri|session|credential|body)/i;
const LEVEL_WEIGHT = Object.freeze({ debug: 5, info: 10, warn: 20, error: 30 });

function present(value) {
  return Boolean(String(value || "").trim());
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function signingKey(secretAccessKey, dateStamp, region) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function awsDates(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function endpointForRegion(region) {
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return `https://${SERVICE}.${region}.${suffix}/`;
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function buildSignedRequest({
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  target,
  payload,
  now = new Date(),
}) {
  const endpoint = endpointForRegion(region);
  const url = new URL(endpoint);
  const body = JSON.stringify(payload);
  const payloadHash = hash(body);
  const { amzDate, dateStamp } = awsDates(now);
  const signingHeaders = {
    "content-type": CONTENT_TYPE,
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };

  if (present(sessionToken)) {
    signingHeaders["x-amz-security-token"] = String(sessionToken).trim();
  }

  const sortedHeaders = Object.entries(signingHeaders).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const canonicalHeaders = `${sortedHeaders
    .map(([key, value]) => `${key}:${normalizeHeaderValue(value)}`)
    .join("\n")}\n`;
  const signedHeaders = sortedHeaders.map(([key]) => key).join(";");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(secretAccessKey, dateStamp, region),
    stringToSign,
    "hex",
  );

  const headers = {
    "content-type": CONTENT_TYPE,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-target": target,
    authorization: `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (signingHeaders["x-amz-security-token"]) {
    headers["x-amz-security-token"] = signingHeaders["x-amz-security-token"];
  }

  return { endpoint, body, headers };
}

function redactString(value) {
  return String(value)
    .replace(/(mongodb(?:\+srv)?:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|jwt|otp|cookie)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}

function redactForLog(value, { depth = 0, seen = new WeakSet(), key = "" } = {}) {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (["number", "boolean", "bigint"].includes(typeof value)) return value;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message || ""),
      ...(value.code ? { code: redactString(value.code) } : {}),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    };
  }

  if (typeof value !== "object") return redactString(value);
  if (depth >= 6) return "[MaxDepth]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((entry) => redactForLog(entry, { depth: depth + 1, seen }));
  }

  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    output[entryKey] = redactForLog(entryValue, {
      depth: depth + 1,
      seen,
      key: entryKey,
    });
  }
  return output;
}

function truncateUtf8(value, maxBytes = MAX_EVENT_BYTES) {
  const text = String(value);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const suffix = "…[truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  let low = 0;
  let high = text.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, midpoint), "utf8") + suffixBytes <= maxBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  return `${text.slice(0, low)}${suffix}`;
}

function safeJsonStringify(value) {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
}

function isStructuredLogValue(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Date) &&
    !(value instanceof Error),
  );
}

function serializeLogMessage({ args }) {
  const values = Array.isArray(args) ? args : [args];
  const redactedValues = values.map((entry) => redactForLog(entry));
  return truncateUtf8(redactString(util.format(...redactedValues)));
}

function serializeLogEntry({ level, args, timestamp, metadata = {} }) {
  const values = Array.isArray(args) ? args : [args];
  const isoTimestamp = new Date(timestamp).toISOString();
  let entry;

  if (values.length === 1 && isStructuredLogValue(values[0])) {
    entry = {
      ...redactForLog(values[0]),
      timestamp: isoTimestamp,
      level: normalizeLogLevel(level),
    };
  } else {
    entry = {
      timestamp: isoTimestamp,
      level: normalizeLogLevel(level),
      message: serializeLogMessage({ args: values }),
    };
  }

  if (present(metadata.source) && !present(entry.source)) {
    entry.source = String(metadata.source);
  }
  return entry;
}

function truncateStrings(value, maxBytes) {
  if (typeof value === "string") return truncateUtf8(value, maxBytes);
  if (Array.isArray(value)) return value.map((entry) => truncateStrings(entry, maxBytes));
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = truncateStrings(entry, maxBytes);
  }
  return output;
}

function normalizeLogLevel(value) {
  const level = String(value || "info").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, level) ? level : "info";
}

function validLogGroup(value) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= 512 && !/[\:*]/.test(text);
}

function createCloudWatchLogger({
  service,
  credentialPrefix,
  defaultLogGroup,
  env = process.env,
  fetchImpl = global.fetch,
  consoleObject = console,
  now = () => new Date(),
  hostname = os.hostname(),
  pid = process.pid,
  randomId = crypto.randomBytes(4).toString("hex"),
} = {}) {
  if (!present(service)) throw new Error("CloudWatch logger service is required");
  if (!present(credentialPrefix)) throw new Error("CloudWatch logger credentialPrefix is required");
  if (!validLogGroup(defaultLogGroup)) throw new Error("CloudWatch logger defaultLogGroup is invalid");

  const bindConsoleMethod = (name, fallback = "log") => {
    const method = typeof consoleObject[name] === "function"
      ? consoleObject[name]
      : consoleObject[fallback];
    return typeof method === "function" ? method.bind(consoleObject) : () => {};
  };
  const originals = {
    log: bindConsoleMethod("log"),
    info: bindConsoleMethod("info"),
    debug: bindConsoleMethod("debug"),
    warn: bindConsoleMethod("warn"),
    error: bindConsoleMethod("error"),
  };
  const safeHost = String(hostname || "host").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  const safeService = String(service).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);

  let installed = false;
  let timer = null;
  let queue = [];
  let flushPromise = null;
  const readyStreams = new Set();
  let droppedCount = 0;
  let lastInternalWarningAt = 0;
  let config = {};

  function readConfig(source = env) {
    const prefix = credentialPrefix;
    const productionDefault = String(source.NODE_ENV || "").trim() === "production";
    const logGroup = String(source.CLOUDWATCH_LOG_GROUP || defaultLogGroup).trim();
    const streamPrefix = String(source.CLOUDWATCH_LOG_STREAM_PREFIX || safeService)
      .trim()
      .replace(/[:*]/g, "-")
      .replace(/^\/+|\/+$/g, "") || safeService;
    return {
      enabled: parseBoolean(source.CLOUDWATCH_LOGS_ENABLED, productionDefault),
      region: String(source.CLOUDWATCH_LOGS_REGION || source[`${prefix}REGION`] || "").trim(),
      accessKeyId: String(source[`${prefix}ACCESS_KEY_ID`] || "").trim(),
      secretAccessKey: String(source[`${prefix}SECRET_ACCESS_KEY`] || "").trim(),
      sessionToken: String(source[`${prefix}SESSION_TOKEN`] || "").trim(),
      logGroup: validLogGroup(logGroup) ? logGroup : defaultLogGroup,
      streamPrefix: streamPrefix.slice(0, 180),
      level: normalizeLogLevel(source.CLOUDWATCH_LOG_LEVEL),
      flushMs: clampNumber(source.CLOUDWATCH_LOG_FLUSH_MS, 60000, 250, 60000),
      batchEvents: clampNumber(
        source.CLOUDWATCH_LOG_BATCH_EVENTS,
        20,
        1,
        MAX_BATCH_EVENTS,
      ),
      maxQueue: clampNumber(source.CLOUDWATCH_LOG_MAX_QUEUE, 1000, 100, 10000),
      requestTimeoutMs: clampNumber(source.CLOUDWATCH_LOG_TIMEOUT_MS, 5000, 1000, 15000),
    };
  }

  function canSend() {
    return (
      config.enabled &&
      typeof fetchImpl === "function" &&
      /^[a-z0-9-]+$/.test(config.region || "") &&
      present(config.accessKeyId) &&
      present(config.secretAccessKey) &&
      validLogGroup(config.logGroup) &&
      present(config.streamPrefix)
    );
  }

  function internalWarning(message) {
    const current = Date.now();
    if (current - lastInternalWarningAt < 60000) return;
    lastInternalWarningAt = current;
    originals.error(`[CloudWatch logger] ${redactString(message)}`);
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function scheduleFlush(delay = config.flushMs || 60000) {
    if (!canSend() || timer || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
  }

  function configureFromEnv(source = env) {
    const previousIdentity = `${config.region || ""}|${config.logGroup || ""}|${config.streamPrefix || ""}|${config.accessKeyId || ""}`;
    config = readConfig(source);
    const nextIdentity = `${config.region}|${config.logGroup}|${config.streamPrefix}|${config.accessKeyId}`;
    if (previousIdentity && previousIdentity !== nextIdentity) readyStreams.clear();
    if (!config.enabled) {
      clearTimer();
      queue = [];
    } else {
      while (queue.length > config.maxQueue) {
        queue.shift();
        droppedCount += 1;
      }
      scheduleFlush();
    }
    return {
      enabled: config.enabled,
      region: config.region,
      logGroup: config.logGroup,
      logStream: streamNameFor(now().getTime()),
      level: config.level,
      credentialsAvailable: present(config.accessKeyId) && present(config.secretAccessKey),
    };
  }

  function shouldCapture(level) {
    return canSend() && LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[config.level];
  }

  function capture(level, args, metadata = {}) {
    const normalizedLevel = normalizeLogLevel(level);
    if (!shouldCapture(normalizedLevel)) return false;
    const timestamp = now().getTime();
    const entry = serializeLogEntry({
      level: normalizedLevel,
      args: Array.isArray(args) ? args : [args],
      timestamp,
      metadata,
    });

    while (queue.length >= config.maxQueue) {
      queue.shift();
      droppedCount += 1;
    }
    queue.push({
      timestamp,
      entry,
      estimatedBytes: Buffer.byteLength(safeJsonStringify(entry), "utf8") + EVENT_OVERHEAD_BYTES,
      streamName: streamNameFor(timestamp),
    });
    if (queue.length >= config.batchEvents) {
      clearTimer();
      void flush({ drainAll: false });
    } else {
      scheduleFlush();
    }
    return true;
  }

  function install(source = env) {
    if (installed) {
      configureFromEnv(source);
      return api;
    }
    configureFromEnv(source);
    consoleObject.log = (...args) => {
      originals.log(...args);
      capture("info", args, { source: "console" });
    };
    consoleObject.info = (...args) => {
      originals.info(...args);
      capture("info", args, { source: "console" });
    };
    consoleObject.debug = (...args) => {
      originals.debug(...args);
      capture("info", args, { source: "console" });
    };
    consoleObject.warn = (...args) => {
      originals.warn(...args);
      capture("warn", args, { source: "console" });
    };
    consoleObject.error = (...args) => {
      originals.error(...args);
      capture("error", args, { source: "console" });
    };
    installed = true;
    return api;
  }

  function uninstall() {
    if (!installed) return;
    consoleObject.log = originals.log;
    consoleObject.info = originals.info;
    consoleObject.debug = originals.debug;
    consoleObject.warn = originals.warn;
    consoleObject.error = originals.error;
    installed = false;
    clearTimer();
  }

  async function sendAwsRequest(target, payload) {
    const request = buildSignedRequest({
      ...config,
      target,
      payload,
      now: now(),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    let response;
    try {
      response = await fetchImpl(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    let responseBody = {};
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch (_error) {
        responseBody = {};
      }
    }

    if (!response.ok) {
      const type = String(responseBody.__type || responseBody.code || "AWS_ERROR")
        .split("#")
        .pop();
      const message = String(responseBody.message || responseBody.Message || `HTTP ${response.status}`);
      const error = new Error(`CloudWatch Logs request failed (${type}): ${message}`);
      error.awsType = type;
      throw error;
    }
    return responseBody;
  }

  function streamNameFor(timestamp) {
    const date = new Date(timestamp);
    const minuteBucket = Math.floor(date.getUTCMinutes() / 15) * 15;
    const day = date.toISOString().slice(0, 10);
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(minuteBucket).padStart(2, "0");
    return `${config.streamPrefix || safeService}/${day}/${hour}-${minute}/${safeHost}`.slice(0, 512);
  }

  async function ensureStream(streamName) {
    if (readyStreams.has(streamName)) return;
    try {
      await sendAwsRequest("Logs_20140328.CreateLogStream", {
        logGroupName: config.logGroup,
        logStreamName: streamName,
      });
    } catch (error) {
      if (error.awsType !== "ResourceAlreadyExistsException") throw error;
    }
    readyStreams.add(streamName);
  }

  function createBatchEnvelope({
    entries,
    batchId,
    batchSize,
    part = 1,
    partCount = 1,
  }) {
    return {
      event: `${safeService}_log_batch`,
      service: safeService,
      hostname: safeHost,
      pid,
      batchId,
      batchSize,
      entryCount: entries.length,
      part,
      partCount,
      startedAt: entries[0]?.timestamp || null,
      completedAt: entries[entries.length - 1]?.timestamp || null,
      entries,
    };
  }

  function envelopeBytes(entries, batchId, batchSize) {
    return Buffer.byteLength(
      safeJsonStringify(createBatchEnvelope({
        entries,
        batchId,
        batchSize,
        part: MAX_BATCH_EVENTS,
        partCount: MAX_BATCH_EVENTS,
      })),
      "utf8",
    );
  }

  function compactEntryToFit(entry, batchId, batchSize) {
    if (envelopeBytes([entry], batchId, batchSize) <= MAX_EVENT_BYTES) return entry;

    const originalBytes = Buffer.byteLength(safeJsonStringify(entry), "utf8");
    for (const maxStringBytes of [65536, 16384, 4096, 1024, 256]) {
      const compacted = {
        ...truncateStrings(entry, maxStringBytes),
        entryTruncated: true,
        originalEntryBytes: originalBytes,
      };
      if (envelopeBytes([compacted], batchId, batchSize) <= MAX_EVENT_BYTES) {
        return compacted;
      }
    }

    const fallbackText = entry.message || entry.error?.message || "[oversized log entry]";
    return {
      timestamp: entry.timestamp || null,
      level: entry.level || "info",
      ...(present(entry.event) ? { event: truncateUtf8(entry.event, 512) } : {}),
      message: truncateUtf8(fallbackText, 4096),
      entryTruncated: true,
      originalEntryBytes: originalBytes,
    };
  }

  function mergeBatch(batch) {
    if (!batch.length) return [];
    const batchSize = batch.length;
    const batchId = hash(safeJsonStringify(
      batch.map(({ timestamp, entry }) => ({
        timestamp,
        event: entry.event || "",
        requestId: entry.requestId || "",
        message: entry.message || "",
      })),
    )).slice(0, 24);
    const groups = [];
    let current = [];

    for (const item of batch) {
      const entry = compactEntryToFit(item.entry, batchId, batchSize);
      const candidate = [...current, entry];
      if (current.length && envelopeBytes(candidate, batchId, batchSize) > MAX_EVENT_BYTES) {
        groups.push(current);
        current = [entry];
      } else {
        current = candidate;
      }
    }
    if (current.length) groups.push(current);

    return groups.map((entries, index) => ({
      timestamp: Date.parse(entries[0]?.timestamp) || batch[0].timestamp,
      message: safeJsonStringify(createBatchEnvelope({
        entries,
        batchId,
        batchSize,
        part: index + 1,
        partCount: groups.length,
      })),
    }));
  }

  function takeBatch(maxEvents = config.batchEvents || 20) {
    const batch = [];
    let bytes = 0;
    const eventLimit = Math.min(
      MAX_BATCH_EVENTS,
      Math.max(1, Math.trunc(Number(maxEvents) || 1)),
    );
    const streamName = queue[0]?.streamName || "";
    while (queue.length && batch.length < eventLimit) {
      const candidate = queue[0];
      if (candidate.streamName !== streamName) break;
      const candidateBytes = Math.min(
        Number(candidate.estimatedBytes || 0),
        MAX_EVENT_BYTES,
      ) + EVENT_OVERHEAD_BYTES;
      if (batch.length && bytes + candidateBytes > MAX_MERGED_BATCH_ENTRY_BYTES) break;
      queue.shift();
      batch.push(candidate);
      bytes += candidateBytes;
    }
    batch.sort((left, right) => left.timestamp - right.timestamp);
    return { batch, streamName };
  }

  async function performFlush({ drainAll = true } = {}) {
    clearTimer();
    if (!canSend() || queue.length === 0) return { sent: 0, pending: queue.length };
    let sent = 0;
    let batchesSent = 0;
    const batchLimit = drainAll ? Number.POSITIVE_INFINITY : 1;

    while (queue.length && batchesSent < batchLimit) {
      const { batch, streamName } = takeBatch(config.batchEvents);
      if (!batch.length) break;
      try {
        await ensureStream(streamName);
        const logEvents = mergeBatch(batch);
        const payloadBytes = logEvents.reduce(
          (total, event) => total + Buffer.byteLength(event.message, "utf8") + EVENT_OVERHEAD_BYTES,
          0,
        );
        if (payloadBytes > MAX_BATCH_BYTES) {
          throw new Error("Merged CloudWatch batch exceeds the AWS request size limit");
        }
        await sendAwsRequest("Logs_20140328.PutLogEvents", {
          logGroupName: config.logGroup,
          logStreamName: streamName,
          logEvents,
        });
        sent += batch.length;
        batchesSent += 1;
      } catch (error) {
        if (error.awsType === "ResourceNotFoundException") readyStreams.delete(streamName);
        queue = [...batch, ...queue].slice(0, config.maxQueue);
        throw error;
      }
    }
    return { sent, pending: queue.length };
  }

  function startFlush({ drainAll = true } = {}) {
    if (flushPromise) return flushPromise;

    let failed = false;
    flushPromise = performFlush({ drainAll })
      .catch((error) => {
        failed = true;
        internalWarning(error && error.name === "AbortError" ? "request timed out" : error.message);
        return { sent: 0, pending: queue.length, failed: true };
      })
      .finally(() => {
        flushPromise = null;
        if (!canSend() || queue.length === 0) return;
        if (failed) {
          scheduleFlush(Math.max(config.flushMs || 60000, 5000));
        } else if (queue.length >= config.batchEvents) {
          void startFlush({ drainAll: false });
        } else {
          scheduleFlush();
        }
      });
    return flushPromise;
  }

  async function flushAll() {
    let sent = 0;
    while (queue.length || flushPromise) {
      const result = await startFlush({ drainAll: true });
      sent += Number(result?.sent || 0);
      if (result?.failed || queue.length === 0) {
        return { ...result, sent, pending: queue.length };
      }
    }
    return { sent, pending: queue.length };
  }

  async function flush({ timeoutMs, drainAll = true } = {}) {
    const operation = drainAll
      ? flushAll()
      : startFlush({ drainAll: false });

    if (!Number.isFinite(Number(timeoutMs))) return operation;
    const timeout = Math.max(100, Math.trunc(Number(timeoutMs)));
    return Promise.race([
      operation,
      new Promise((resolve) => {
        const timerHandle = setTimeout(
          () => resolve({ sent: 0, pending: queue.length, timedOut: true }),
          timeout,
        );
        if (typeof timerHandle.unref === "function") timerHandle.unref();
      }),
    ]);
  }

  async function shutdown({ timeoutMs = 2000 } = {}) {
    clearTimer();
    const result = await flush({ timeoutMs });
    uninstall();
    return result;
  }

  function diagnostics() {
    return {
      installed,
      enabled: Boolean(config.enabled),
      region: config.region || "",
      logGroup: config.logGroup || "",
      logStream: streamNameFor(now().getTime()),
      level: config.level || "info",
      queueLength: queue.length,
      flushMs: config.flushMs || 0,
      batchEvents: config.batchEvents || 0,
      maxQueue: config.maxQueue || 0,
      droppedCount,
      streamReady: readyStreams.has(streamNameFor(now().getTime())),
      readyStreamCount: readyStreams.size,
      credentialsAvailable: present(config.accessKeyId) && present(config.secretAccessKey),
    };
  }

  const api = {
    capture,
    configureFromEnv,
    diagnostics,
    flush,
    install,
    shutdown,
    uninstall,
    streamNameFor,
  };
  return api;
}

module.exports = {
  buildSignedRequest,
  createCloudWatchLogger,
  parseBoolean,
  redactForLog,
  redactString,
  serializeLogMessage,
  truncateUtf8,
};
