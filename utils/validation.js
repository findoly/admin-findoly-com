function validationError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function isMissing(value) {
  return value === undefined || value === null;
}

function textValue(value, options = {}) {
  const {
    label = "Value",
    required = false,
    fallback = "",
    minLength = 0,
    maxLength = 1000,
    preserveWhitespace = false,
  } = options;

  const candidate = isMissing(value) ? fallback : value;
  if (
    typeof candidate === "object" ||
    typeof candidate === "function" ||
    typeof candidate === "symbol"
  ) {
    throw validationError(`${label} must be text`);
  }

  const normalized = preserveWhitespace
    ? String(candidate ?? "")
    : String(candidate ?? "").trim();

  const meaningful = normalized.trim();
  if (required && !meaningful) {
    throw validationError(`${label} is required`);
  }
  if (meaningful && meaningful.length < minLength) {
    throw validationError(
      `${label} must contain at least ${minLength} characters`,
    );
  }
  if (normalized.length > maxLength) {
    throw validationError(
      `${label} must not exceed ${maxLength} characters`,
    );
  }
  if (/\0/.test(normalized)) {
    throw validationError(`${label} contains an invalid character`);
  }
  return normalized;
}

const EMOJI_PATTERN = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u20E3]/u;
const HTML_CODE_PATTERN = /<\/?[A-Za-z][^>]*>|&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/u;

function assertHumanText(value, options = {}) {
  const { label = "Value", allowEmoji = false, allowHtml = false } = options;
  const normalized = String(value ?? "");
  if (!allowEmoji && EMOJI_PATTERN.test(normalized)) {
    throw validationError(`${label} must not contain emoji`);
  }
  if (!allowHtml && HTML_CODE_PATTERN.test(normalized)) {
    throw validationError(`${label} must not contain HTML tags or encoded HTML`);
  }
  return normalized;
}

function humanTextValue(value, options = {}) {
  const normalized = textValue(value, options);
  assertHumanText(normalized, options);
  return normalized;
}

function emailValue(value, options = {}) {
  const { label = "Email", required = false, fallback = "" } = options;
  const email = textValue(value, {
    label,
    required,
    fallback,
    maxLength: 254,
  }).toLowerCase();
  if (!email) return "";

  // Deliberately practical rather than fully RFC-complete. It rejects spaces,
  // missing local/domain parts and domains without a dot.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email)) {
    throw validationError(`${label} is invalid`);
  }
  return email;
}

function enumValue(value, allowed, options = {}) {
  const {
    label = "Value",
    required = true,
    fallback,
    normalize = true,
  } = options;
  const candidate = isMissing(value) || value === "" ? fallback : value;
  if (isMissing(candidate) || candidate === "") {
    if (required) throw validationError(`${label} is required`);
    return "";
  }

  let normalized = textValue(candidate, { label, required: true, maxLength: 80 });
  if (normalize) normalized = normalized.toLowerCase();
  if (!allowed.includes(normalized)) {
    throw validationError(
      `${label} must be one of: ${allowed.join(", ")}`,
    );
  }
  return normalized;
}

function booleanValue(value, options = {}) {
  const { label = "Value", fallback = false } = options;
  if (isMissing(value) || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "on"].includes(normalized)) return true;
  if (["false", "no", "off"].includes(normalized)) return false;
  throw validationError(`${label} must be true or false`);
}

function numberValue(value, options = {}) {
  const {
    label = "Value",
    required = true,
    fallback,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  } = options;

  const candidate = isMissing(value) || value === "" ? fallback : value;
  if (isMissing(candidate) || candidate === "") {
    if (required) throw validationError(`${label} is required`);
    return undefined;
  }
  if (typeof candidate === "boolean") {
    throw validationError(`${label} must be a number`);
  }

  const normalized = Number(candidate);
  if (!Number.isFinite(normalized)) {
    throw validationError(`${label} must be a valid number`);
  }
  if (integer && !Number.isInteger(normalized)) {
    throw validationError(`${label} must be a whole number`);
  }
  if (normalized < min) {
    throw validationError(`${label} must be at least ${min}`);
  }
  if (normalized > max) {
    throw validationError(`${label} must not exceed ${max}`);
  }
  return normalized;
}

function dateOnlyValue(value, options = {}) {
  const { label = "Date", required = false, fallback = "" } = options;
  const normalized = textValue(value, {
    label,
    required,
    fallback,
    maxLength: 10,
  });
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw validationError(`${label} must use YYYY-MM-DD format`);
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw validationError(`${label} is invalid`);
  }
  return normalized;
}

function dateTimeValue(value, options = {}) {
  const { label = "Date and time", required = false, fallback = "" } = options;
  const normalized = textValue(value, {
    label,
    required,
    fallback,
    maxLength: 40,
  });
  if (!normalized) return "";
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw validationError(`${label} is invalid`);
  }
  return normalized;
}

function pincodeValue(value, options = {}) {
  const { label = "Pincode", required = false, fallback = "" } = options;
  const normalized = textValue(value, {
    label,
    required,
    fallback,
    maxLength: 6,
  });
  if (!normalized) return "";
  if (!/^[1-9]\d{5}$/.test(normalized)) {
    throw validationError(`${label} must contain exactly 6 digits`);
  }
  return normalized;
}

function tokenValue(value, options = {}) {
  const {
    label = "Value",
    required = true,
    fallback = "",
    maxLength = 80,
    lowercase = false,
  } = options;
  let normalized = textValue(value, {
    label,
    required,
    fallback,
    maxLength,
  });
  if (!normalized) return "";
  if (lowercase) normalized = normalized.toLowerCase();
  if (!/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(normalized)) {
    throw validationError(
      `${label} may contain only letters, numbers, hyphens and underscores`,
    );
  }
  return normalized;
}

function identifierValue(value, options = {}) {
  const { label = "Identifier", required = true, fallback = "" } = options;
  const normalized = textValue(value, {
    label,
    required,
    fallback,
    maxLength: 128,
  });
  if (!normalized) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(normalized)) {
    throw validationError(`${label} is invalid`);
  }
  return normalized;
}

function stringArrayValue(value, options = {}) {
  const {
    label = "Values",
    required = false,
    fallback = [],
    maxItems = 50,
    itemMaxLength = 100,
    itemValidator,
  } = options;
  const candidate = isMissing(value) ? fallback : value;
  let items;
  if (Array.isArray(candidate)) items = candidate;
  else if (typeof candidate === "string") items = candidate.split(",");
  else throw validationError(`${label} must be a list`);

  const output = [];
  const seen = new Set();
  for (const item of items) {
    if (
      item !== null &&
      typeof item === "object"
    ) {
      throw validationError(`${label} contains an invalid item`);
    }
    let normalized = textValue(item, {
      label: `${label} item`,
      required: false,
      maxLength: itemMaxLength,
    });
    if (!normalized) continue;
    if (itemValidator) normalized = itemValidator(normalized);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  if (output.length > maxItems) {
    throw validationError(`${label} must not contain more than ${maxItems} items`);
  }
  if (required && !output.length) {
    throw validationError(`${label} must contain at least one item`);
  }
  return output;
}

function assertSafeKey(key, label) {
  if (
    key === "__proto__" ||
    key === "prototype" ||
    key === "constructor" ||
    key.startsWith("$") ||
    key.includes(".") ||
    /\0/.test(key)
  ) {
    throw validationError(`${label} contains an unsafe field name`);
  }
}

function cloneJsonValue(value, state, label, depth) {
  if (depth > state.maxDepth) {
    throw validationError(`${label} is nested too deeply`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw validationError(`${label} contains an invalid number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > state.maxArrayLength) {
      throw validationError(`${label} contains too many list items`);
    }
    return value.map((item) => cloneJsonValue(item, state, label, depth + 1));
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw validationError(`${label} must contain JSON-compatible values`);
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > state.maxKeys) {
      throw validationError(`${label} contains too many fields`);
    }
    assertSafeKey(key, label);
    result[key] = cloneJsonValue(item, state, label, depth + 1);
  }
  return result;
}

function plainObjectValue(value, options = {}) {
  const {
    label = "Object",
    fallback = {},
    maxKeys = 100,
    maxDepth = 6,
    maxArrayLength = 100,
    maxBytes = 50_000,
  } = options;
  const candidate = isMissing(value) ? fallback : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw validationError(`${label} must be an object`);
  }
  if (Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw validationError(`${label} must be a plain object`);
  }
  const cloned = cloneJsonValue(
    candidate,
    { keys: 0, maxKeys, maxDepth, maxArrayLength },
    label,
    0,
  );
  const size = Buffer.byteLength(JSON.stringify(cloned), "utf8");
  if (size > maxBytes) {
    throw validationError(`${label} is too large`);
  }
  return cloned;
}

function queryTextValue(value, options = {}) {
  const { label = "Search", maxLength = 100 } = options;
  if (isMissing(value) || value === "") return "";
  return textValue(value, { label, maxLength });
}

function assertImmutableFields(existing = {}, input = {}, fields = []) {
  for (const field of fields) {
    if (isMissing(input[field])) continue;
    if (String(input[field]) !== String(existing[field] ?? "")) {
      throw validationError(`${field} cannot be changed`);
    }
  }
}

module.exports = {
  validationError,
  textValue,
  humanTextValue,
  assertHumanText,
  emailValue,
  enumValue,
  booleanValue,
  numberValue,
  dateOnlyValue,
  dateTimeValue,
  pincodeValue,
  tokenValue,
  identifierValue,
  stringArrayValue,
  plainObjectValue,
  queryTextValue,
  assertImmutableFields,
};
