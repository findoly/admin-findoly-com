"use strict";

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SUMMARY_KEYS = ["id", "status", "type", "event", "code", "message", "reason", "timestamp"];

function primitive(value, maxStringLength) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, maxStringLength);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  return undefined;
}

function cloneBounded(value, options, state, depth = 0) {
  const direct = primitive(value, options.maxStringLength);
  if (direct !== undefined) return direct;
  if (depth >= options.maxDepth) return "[MaxDepth]";
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (!value || typeof value !== "object") return String(value).slice(0, options.maxStringLength);
  if (state.seen.has(value)) return "[Circular]";
  state.seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, options.maxArrayLength)
      .map((entry) => cloneBounded(entry, options, state, depth + 1));
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(output).length >= options.maxKeys) break;
    if (!key || key.startsWith("$") || key.includes(".") || DANGEROUS_KEYS.has(key)) continue;
    output[key] = cloneBounded(entry, options, state, depth + 1);
  }
  return output;
}

function compactSummary(value, options) {
  const summary = { truncated: true };
  if (!value || typeof value !== "object") {
    summary.value = String(value ?? "").slice(0, Math.min(options.maxStringLength, 1000));
    return summary;
  }
  for (const key of SUMMARY_KEYS) {
    const entry = primitive(value[key], Math.min(options.maxStringLength, 1000));
    if (entry !== undefined && entry !== null && entry !== "") summary[key] = entry;
  }
  return summary;
}

function boundedJsonValue(value, options = {}) {
  const config = {
    maxBytes: Math.min(Math.max(Number(options.maxBytes) || 20_000, 1000), 100_000),
    maxDepth: Math.min(Math.max(Number(options.maxDepth) || 5, 1), 10),
    maxArrayLength: Math.min(Math.max(Number(options.maxArrayLength) || 50, 1), 500),
    maxKeys: Math.min(Math.max(Number(options.maxKeys) || 100, 1), 1000),
    maxStringLength: Math.min(Math.max(Number(options.maxStringLength) || 3000, 100), 20_000),
  };
  const cloned = cloneBounded(value, config, { seen: new WeakSet() });
  try {
    if (Buffer.byteLength(JSON.stringify(cloned), "utf8") <= config.maxBytes) return cloned;
  } catch (_error) {
    return compactSummary(value, config);
  }
  return compactSummary(value, config);
}

module.exports = { boundedJsonValue, cloneBounded, compactSummary };
