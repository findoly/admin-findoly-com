const crypto = require("crypto");
const path = require("path");
const {
  textValue,
  numberValue,
  booleanValue,
  validationError,
} = require("../../utils/validation");

const PLACEHOLDER_VALUE_PATTERN = /(?:^|[_\s-])(replace|placeholder|example|dummy|your)(?:$|[_\s-])/i;

function sessionTokenConfigurationError(auth = {}) {
  const accessKeyId = String(auth.accessKeyId || "").trim();
  const sessionToken = String(auth.sessionToken || "").trim();
  if (!sessionToken) {
    return accessKeyId.startsWith("ASIA")
      ? "AWS_SESSION_TOKEN is required when using temporary AWS credentials."
      : "";
  }
  if (
    PLACEHOLDER_VALUE_PATTERN.test(sessionToken) ||
    /[\s\u0000-\u001f\u007f]/.test(sessionToken) ||
    sessionToken.length < 16 ||
    sessionToken.length > 4096 ||
    !/^[A-Za-z0-9/+=._-]+$/.test(sessionToken)
  ) {
    return "AWS_SESSION_TOKEN is invalid. Remove it when using long-lived IAM credentials, or provide the exact matching token for temporary AWS credentials.";
  }
  return "";
}

function normalizedRoot(value, fallback) {
  const raw = String(value || fallback || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!raw) return "";
  if (raw.split("/").some((part) => part === "..")) throw new Error("Invalid S3 prefix configuration");
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function csvValues(value, fallback) {
  return String(value || fallback || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function credentials() {
  return {
    accessKeyId: String(process.env.AWS_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.AWS_SECRET_ACCESS_KEY || "").trim(),
    sessionToken: String(process.env.AWS_SESSION_TOKEN || "").trim(),
  };
}

function config() {
  const publicPrefix = normalizedRoot(process.env.AWS_S3_PUBLIC_PREFIX, "public/");
  const privatePrefix = normalizedRoot(process.env.AWS_S3_PRIVATE_PREFIX, "private/");
  const roots = [...new Set([publicPrefix, privatePrefix].filter(Boolean))];
  const maxUploadMb = Math.min(Math.max(Number(process.env.S3_MAX_UPLOAD_MB || 20) || 20, 1), 500);
  const cloudFrontDomain = String(
    process.env.AWS_CLOUDFRONT_DOMAIN || process.env.S3_PUBLIC_BASE_URL || "",
  ).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const auth = credentials();
  const credentialError = sessionTokenConfigurationError(auth);
  const region = String(process.env.AWS_REGION || "").trim();
  const bucket = String(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "").trim();
  return {
    region,
    bucket,
    credentials: auth,
    publicPrefix,
    privatePrefix,
    roots,
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    allowedExtensions: csvValues(
      process.env.S3_ALLOWED_EXTENSIONS,
      ".jpg,.jpeg,.png,.webp,.gif,.svg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip",
    ).map((extension) => (extension.startsWith(".") ? extension : `.${extension}`)),
    allowedMimeTypes: csvValues(
      process.env.S3_ALLOWED_MIME_TYPES,
      "image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/zip,application/x-zip-compressed,application/octet-stream",
    ),
    cloudFrontDomain,
    uploadUrlExpiresSeconds: Math.min(Math.max(Number(process.env.S3_UPLOAD_URL_EXPIRES_SECONDS || 300) || 300, 60), 3600),
    downloadUrlExpiresSeconds: Math.min(Math.max(Number(process.env.S3_DOWNLOAD_URL_EXPIRES_SECONDS || 300) || 300, 60), 3600),
    endpoint: String(process.env.AWS_S3_ENDPOINT || "").trim().replace(/\/+$/, ""),
    forcePathStyle: String(process.env.AWS_S3_FORCE_PATH_STYLE || "").toLowerCase() === "true",
    requestTimeoutMs: Math.min(Math.max(Number(process.env.AWS_S3_TIMEOUT_MS || 15000) || 15000, 1000), 60000),
    credentialError,
    configured: Boolean(region && bucket && auth.accessKeyId && auth.secretAccessKey && !credentialError),
  };
}

function publicConfig() {
  const value = config();
  return {
    configured: value.configured,
    region: value.region,
    bucket: value.bucket,
    publicPrefix: value.publicPrefix,
    privatePrefix: value.privatePrefix,
    roots: value.roots,
    maxUploadMb: value.maxUploadMb,
    allowedExtensions: value.allowedExtensions,
    cloudFrontDomain: value.cloudFrontDomain,
    uploadUrlExpiresSeconds: value.uploadUrlExpiresSeconds,
    downloadUrlExpiresSeconds: value.downloadUrlExpiresSeconds,
    configurationMessage: value.configured
      ? ""
      : value.credentialError || "Add AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to enable File Manager.",
  };
}

function assertConfigured() {
  const value = config();
  if (!value.configured) {
    const credentialError = value.credentialError;
    throw Object.assign(
      new Error(credentialError || "Amazon S3 is not configured. Add the S3 region, bucket and restricted IAM credentials to the server environment."),
      { status: 503, code: credentialError ? "S3_CREDENTIALS_INVALID" : "S3_NOT_CONFIGURED", expose: true },
    );
  }
  return value;
}

function hasAllowedRoot(value, roots) {
  return roots.some((root) => value === root || value.startsWith(root));
}

function normalizePrefix(value, options = {}) {
  const settings = config();
  let prefix = String(value || "").trim().replace(/\\/g, "/");
  if (!prefix && options.allowRoot !== false) return "";
  if (prefix.startsWith("/") || prefix.includes("\0")) throw validationError("Folder path is invalid");
  const parts = prefix.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw validationError("Folder path is invalid");
  }
  prefix = `${parts.join("/")}/`;
  if (!hasAllowedRoot(prefix, settings.roots)) {
    throw validationError("Folder is outside the approved S3 locations");
  }
  return prefix;
}

function safeName(value, label) {
  const name = textValue(value, { label, required: true, maxLength: 255 }).trim();
  if (
    name === "." || name === ".." || name.startsWith(".") ||
    /[\\/\0\r\n]/.test(name) || /[<>:"|?*]/.test(name)
  ) {
    throw validationError(`${label} contains unsupported characters`);
  }
  return name;
}

function objectKey(prefix, fileName) {
  return `${normalizePrefix(prefix)}${safeName(fileName, "File name")}`;
}

function folderPrefix(prefix, folderName) {
  return `${normalizePrefix(prefix)}${safeName(folderName, "Folder name")}/`;
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKey(key) {
  return String(key).split("/").map(awsEncode).join("/");
}

function publicUrl(key, settings = config()) {
  if (!settings.cloudFrontDomain || !key.startsWith(settings.publicPrefix)) return "";
  return `https://${settings.cloudFrontDomain}/${encodeKey(key)}`;
}

function validateUpload(input = {}) {
  const settings = assertConfigured();
  const prefix = normalizePrefix(input.prefix);
  const fileName = safeName(input.fileName, "File name");
  const extension = path.extname(fileName).toLowerCase();
  if (!extension || !settings.allowedExtensions.includes(extension)) {
    throw validationError(`File type is not allowed. Allowed extensions: ${settings.allowedExtensions.join(", ")}`);
  }
  const contentType = textValue(input.contentType, {
    label: "File content type",
    required: true,
    maxLength: 200,
  }).toLowerCase();
  if (!settings.allowedMimeTypes.includes(contentType)) {
    throw validationError("File content type is not allowed");
  }
  const sizeBytes = numberValue(input.sizeBytes, {
    label: "File size",
    min: 1,
    max: settings.maxUploadBytes,
    integer: true,
  });
  return {
    settings,
    prefix,
    fileName,
    key: `${prefix}${fileName}`,
    contentType,
    sizeBytes,
    replace: booleanValue(input.replace, { label: "Replace file", fallback: false }),
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function timestamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function endpointFor(settings, key = "") {
  const encoded = encodeKey(key);
  if (settings.endpoint) {
    const base = new URL(settings.endpoint);
    if (settings.forcePathStyle) {
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/${awsEncode(settings.bucket)}${encoded ? `/${encoded}` : ""}`;
    } else {
      base.hostname = `${settings.bucket}.${base.hostname}`;
      base.pathname = encoded ? `/${encoded}` : "/";
    }
    return base;
  }
  if (settings.forcePathStyle) {
    return new URL(`https://s3.${settings.region}.amazonaws.com/${awsEncode(settings.bucket)}${encoded ? `/${encoded}` : ""}`);
  }
  return new URL(`https://${settings.bucket}.s3.${settings.region}.amazonaws.com${encoded ? `/${encoded}` : "/"}`);
}

function normalizedHeaders(headers = {}, host) {
  const values = { host };
  for (const [name, value] of Object.entries(headers)) {
    const lower = String(name).trim().toLowerCase();
    if (!lower || lower === "authorization" || lower === "host") continue;
    values[lower] = String(value).trim().replace(/\s+/g, " ");
  }
  const names = Object.keys(values).sort();
  return {
    values,
    names,
    canonical: names.map((name) => `${name}:${values[name]}\n`).join(""),
    signed: names.join(";"),
  };
}

function compareCanonicalValues(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalQuery(searchParams) {
  const entries = [...searchParams.entries()].map(([key, value]) => [awsEncode(key), awsEncode(value)]);
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyComparison = compareCanonicalValues(leftKey, rightKey);
    return keyComparison || compareCanonicalValues(leftValue, rightValue);
  });
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

function canonicalUrl(url) {
  const query = canonicalQuery(url.searchParams);
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

function rfc5987Value(value) {
  return encodeURIComponent(String(value)).replace(/[\'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function signedRequest(settings, method, key, options = {}) {
  const url = endpointFor(settings, key);
  for (const [name, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.append(name, String(value));
  }
  const body = options.body === undefined || options.body === null ? "" : options.body;
  const payloadHash = sha256(body);
  const { amzDate, dateStamp } = timestamp();
  const requestHeaders = {
    ...(options.headers || {}),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (settings.credentials.sessionToken) requestHeaders["x-amz-security-token"] = settings.credentials.sessionToken;
  const headers = normalizedHeaders(requestHeaders, url.host);
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url.searchParams),
    headers.canonical,
    headers.signed,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(
    signingKey(settings.credentials.secretAccessKey, dateStamp, settings.region),
    stringToSign,
    "hex",
  );
  requestHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${settings.credentials.accessKeyId}/${scope}, SignedHeaders=${headers.signed}, Signature=${signature}`;
  return { url: canonicalUrl(url), headers: requestHeaders, body };
}

function presignedUrl(settings, method, key, options = {}) {
  const url = endpointFor(settings, key);
  for (const [name, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.append(name, String(value));
  }
  const { amzDate, dateStamp } = timestamp();
  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const requestHeaders = { ...(options.headers || {}) };
  const headers = normalizedHeaders(requestHeaders, url.host);
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${settings.credentials.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(options.expiresIn));
  url.searchParams.set("X-Amz-SignedHeaders", headers.signed);
  if (settings.credentials.sessionToken) url.searchParams.set("X-Amz-Security-Token", settings.credentials.sessionToken);
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url.searchParams),
    headers.canonical,
    headers.signed,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(
    signingKey(settings.credentials.secretAccessKey, dateStamp, settings.region),
    stringToSign,
    "hex",
  );
  url.searchParams.set("X-Amz-Signature", signature);
  return canonicalUrl(url);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function xmlBlocks(xml, tag) {
  return [...String(xml || "").matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => match[1]);
}

function s3Error(status, body) {
  const upstreamCode = xmlValue(body, "Code") || "S3_REQUEST_FAILED";
  const upstreamMessage = xmlValue(body, "Message") || `Amazon S3 request failed with status ${status}`;
  const authenticationCodes = new Set([
    "InvalidToken",
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "TokenRefreshRequired",
  ]);
  let code = "S3_REQUEST_FAILED";
  let message = upstreamMessage;
  let responseStatus = status === 404 ? 404 : status === 403 ? 403 : status >= 500 ? 503 : 400;

  if (authenticationCodes.has(upstreamCode)) {
    code = "S3_CREDENTIALS_INVALID";
    message = "Amazon S3 credentials are invalid. Check the configured access key, secret key, and session token.";
    responseStatus = 503;
  } else if (upstreamCode === "ExpiredToken") {
    code = "S3_TOKEN_EXPIRED";
    message = "Amazon S3 temporary credentials have expired.";
    responseStatus = 503;
  } else if (upstreamCode === "AccessDenied") {
    code = "S3_ACCESS_DENIED";
    message = "Amazon S3 access was denied. Check the IAM policy and bucket permissions.";
    responseStatus = 503;
  } else if (["NoSuchKey", "NotFound"].includes(upstreamCode)) {
    code = upstreamCode;
    message = "File not found";
    responseStatus = 404;
  }

  return Object.assign(new Error(message), {
    status: responseStatus,
    code,
    upstreamCode,
    upstreamStatus: status,
    expose: true,
  });
}

function logS3Failure(settings, method, error, operation) {
  const safeOperation = String(operation || method || "request").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const safeCode = String(error?.upstreamCode || error?.code || "S3_REQUEST_FAILED").replace(/[^A-Za-z0-9_:-]/g, "_");
  const safeStatus = Number(error?.upstreamStatus || error?.status || 503);
  console.error(
    `S3 request failed: operation=${safeOperation} code=${safeCode} status=${safeStatus} region=${settings.region} bucket=${settings.bucket}`,
  );
  error.logged = true;
}

async function fetchS3(settings, method, key, options = {}) {
  const request = signedRequest(settings, method, key, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  try {
    const response = await fetch(request.url, {
      method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : request.body,
      signal: controller.signal,
    });
    const body = method.toUpperCase() === "HEAD"
      ? ""
      : options.responseType === "buffer"
        ? Buffer.from(await response.arrayBuffer())
        : await response.text().catch(() => "");
    if (!response.ok) throw s3Error(response.status, Buffer.isBuffer(body) ? "" : body);
    return { response, body };
  } catch (error) {
    const normalized = error?.status
      ? error
      : Object.assign(
        new Error(error?.name === "AbortError" ? "Amazon S3 did not respond in time" : "Unable to connect to Amazon S3"),
        { status: 503, code: "S3_REQUEST_FAILED", expose: true, cause: error },
      );
    const expectedNotFound = options.suppressNotFoundLog &&
      (normalized?.status === 404 || ["NoSuchKey", "NotFound"].includes(normalized?.upstreamCode));
    if (!expectedNotFound) logS3Failure(settings, method, normalized, options.operation);
    throw normalized;
  } finally {
    clearTimeout(timer);
  }
}

async function exists(key) {
  const settings = assertConfigured();
  try {
    await fetchS3(settings, "HEAD", key, { operation: "head_object", suppressNotFoundLog: true });
    return true;
  } catch (error) {
    if (error?.status === 404 || ["NoSuchKey", "NotFound"].includes(error?.upstreamCode)) return false;
    throw error;
  }
}

function rootListing(settings) {
  return {
    prefix: "",
    folders: settings.roots.map((prefix) => ({
      name: prefix.replace(/\/$/, "").split("/").pop(),
      prefix,
    })),
    files: [],
    nextToken: "",
    publicPrefix: settings.publicPrefix,
  };
}

async function list(input = {}) {
  const settings = assertConfigured();
  const prefix = normalizePrefix(input.prefix, { allowRoot: true });
  if (!prefix) return rootListing(settings);
  const limit = numberValue(input.limit, {
    label: "File list limit",
    fallback: 200,
    min: 1,
    max: 500,
    integer: true,
  });
  const continuationToken = textValue(input.continuationToken, {
    label: "Continuation token",
    maxLength: 4000,
  });
  const { body } = await fetchS3(settings, "GET", "", {
    operation: "list_objects",
    query: {
      "list-type": "2",
      delimiter: "/",
      "max-keys": limit,
      prefix,
      ...(continuationToken ? { "continuation-token": continuationToken } : {}),
    },
  });
  const folders = xmlBlocks(body, "CommonPrefixes")
    .map((block) => xmlValue(block, "Prefix"))
    .filter(Boolean)
    .map((folder) => ({ prefix: folder, name: folder.slice(prefix.length).replace(/\/$/, "") }));
  const files = xmlBlocks(body, "Contents")
    .map((block) => ({
      key: xmlValue(block, "Key"),
      sizeBytes: Number(xmlValue(block, "Size") || 0),
      lastModified: xmlValue(block, "LastModified") || null,
      etag: xmlValue(block, "ETag").replace(/^"|"$/g, ""),
    }))
    .filter((row) => row.key && row.key !== prefix && !row.key.endsWith("/"))
    .map((row) => ({
      ...row,
      name: row.key.slice(prefix.length),
      publicUrl: publicUrl(row.key, settings),
      isPublic: row.key.startsWith(settings.publicPrefix),
    }));
  const truncated = xmlValue(body, "IsTruncated").toLowerCase() === "true";
  return {
    prefix,
    folders,
    files,
    nextToken: truncated ? xmlValue(body, "NextContinuationToken") : "",
    publicPrefix: settings.publicPrefix,
  };
}

async function createFolder(input = {}) {
  const settings = assertConfigured();
  const key = folderPrefix(input.prefix, input.folderName);
  await fetchS3(settings, "PUT", key, {
    operation: "create_folder",
    headers: { "Content-Type": "application/x-directory" },
    body: "",
  });
  return { key, prefix: key };
}

function encryptionHeaders() {
  const headers = {};
  const encryption = String(process.env.AWS_S3_SERVER_SIDE_ENCRYPTION || "").trim();
  if (encryption) headers["x-amz-server-side-encryption"] = encryption;
  const kmsKeyId = String(process.env.AWS_S3_KMS_KEY_ID || "").trim();
  if (kmsKeyId) headers["x-amz-server-side-encryption-aws-kms-key-id"] = kmsKeyId;
  return headers;
}

function normalizeObjectKey(value, settings = config()) {
  const key = String(value || "").trim().replace(/\\/g, "/");
  if (!key || key.endsWith("/") || key.startsWith("/") || key.includes("\0") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw validationError("File key is invalid");
  }
  if (!hasAllowedRoot(key, settings.roots)) throw validationError("File is outside the approved S3 locations");
  return key;
}

async function putObject(input = {}) {
  const settings = assertConfigured();
  const key = normalizeObjectKey(input.key, settings);
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body || "");
  if (!body.length) throw validationError("File content is required");
  if (body.length > settings.maxUploadBytes) {
    throw Object.assign(new Error(`File exceeds the ${settings.maxUploadMb} MB upload limit`), {
      status: 413,
      code: "S3_FILE_TOO_LARGE",
      expose: true,
    });
  }
  const contentType = textValue(input.contentType || "application/octet-stream", {
    label: "File content type",
    required: true,
    maxLength: 200,
  }).toLowerCase();
  const headers = {
    "Content-Type": contentType,
    ...encryptionHeaders(),
  };
  const result = await fetchS3(settings, "PUT", key, {
    operation: "put_object",
    headers,
    body,
  });
  return {
    key,
    contentType,
    sizeBytes: body.length,
    etag: String(result.response.headers.get("etag") || "").replace(/^"|"$/g, ""),
  };
}

async function deleteObject(input = {}) {
  const settings = assertConfigured();
  const key = normalizeObjectKey(input.key, settings);
  await fetchS3(settings, "DELETE", key, { operation: "delete_object" });
  return { key, deleted: true };
}

async function createUploadUrl(input = {}) {
  const upload = validateUpload(input);
  if (!upload.replace && (await exists(upload.key))) {
    throw Object.assign(new Error("A file with this name already exists. Enable Replace existing file to overwrite it."), { status: 409 });
  }
  const headers = { "Content-Type": upload.contentType, ...encryptionHeaders() };
  return {
    key: upload.key,
    fileName: upload.fileName,
    method: "PUT",
    url: presignedUrl(upload.settings, "PUT", upload.key, {
      headers,
      expiresIn: upload.settings.uploadUrlExpiresSeconds,
    }),
    headers,
    expiresIn: upload.settings.uploadUrlExpiresSeconds,
    publicUrl: publicUrl(upload.key, upload.settings),
    replacing: upload.replace,
  };
}


async function getObject(input = {}) {
  const settings = assertConfigured();
  const key = normalizeObjectKey(input.key, settings);
  const maxBytes = numberValue(input.maxBytes, {
    label: "Maximum download size",
    fallback: settings.maxUploadBytes,
    min: 1,
    max: 500 * 1024 * 1024,
    integer: true,
  });
  let metadata;
  try {
    metadata = await fetchS3(settings, "HEAD", key, { operation: "head_object", suppressNotFoundLog: true });
  } catch (error) {
    if (error?.status === 404) throw Object.assign(new Error("File not found"), { status: 404 });
    throw error;
  }
  const declaredSize = Number(metadata.response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) {
    throw Object.assign(new Error("File exceeds the allowed processing size"), {
      status: 413,
      code: "S3_FILE_TOO_LARGE",
      expose: true,
    });
  }
  const result = await fetchS3(settings, "GET", key, { operation: "get_object", responseType: "buffer" });
  if (!Buffer.isBuffer(result.body) || !result.body.length) {
    throw Object.assign(new Error("Downloaded file is empty"), { status: 422, code: "S3_FILE_EMPTY", expose: true });
  }
  if (result.body.length > maxBytes) {
    throw Object.assign(new Error("File exceeds the allowed processing size"), {
      status: 413,
      code: "S3_FILE_TOO_LARGE",
      expose: true,
    });
  }
  return {
    key,
    body: result.body,
    sizeBytes: result.body.length,
    contentType: metadata.response.headers.get("content-type") || result.response.headers.get("content-type") || "application/octet-stream",
    lastModified: metadata.response.headers.get("last-modified") || null,
    publicUrl: publicUrl(key, settings),
  };
}

async function createDownloadUrl(input = {}) {
  const settings = assertConfigured();
  const key = normalizeObjectKey(input.key, settings);
  let metadata;
  try {
    metadata = await fetchS3(settings, "HEAD", key, { operation: "head_object", suppressNotFoundLog: true });
  } catch (error) {
    if (error?.status === 404) throw Object.assign(new Error("File not found"), { status: 404 });
    throw error;
  }
  const disposition = String(input.disposition || "attachment").toLowerCase() === "inline" ? "inline" : "attachment";
  const fileName = key.split("/").pop() || "download";
  const url = presignedUrl(settings, "GET", key, {
    query: { "response-content-disposition": `${disposition}; filename*=UTF-8''${rfc5987Value(fileName)}` },
    expiresIn: settings.downloadUrlExpiresSeconds,
  });
  return {
    key,
    url,
    expiresIn: settings.downloadUrlExpiresSeconds,
    contentType: metadata.response.headers.get("content-type") || "application/octet-stream",
    sizeBytes: Number(metadata.response.headers.get("content-length") || 0),
    lastModified: metadata.response.headers.get("last-modified") || null,
    publicUrl: publicUrl(key, settings),
  };
}

module.exports = {
  config,
  publicConfig,
  normalizePrefix,
  safeName,
  objectKey,
  folderPrefix,
  publicUrl,
  validateUpload,
  list,
  createFolder,
  createUploadUrl,
  createDownloadUrl,
  getObject,
  deleteObject,
  putObject,
  normalizeObjectKey,
  exists,
  presignedUrl,
  signedRequest,
  sessionTokenConfigurationError,
};
