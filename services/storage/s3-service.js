const path = require("path");
const {
  textValue,
  numberValue,
  booleanValue,
  validationError,
} = require("../../utils/validation");

let awsModules;
let s3Client;

function loadAwsModules() {
  if (awsModules) return awsModules;
  try {
    const client = require("@aws-sdk/client-s3");
    const presigner = require("@aws-sdk/s3-request-presigner");
    awsModules = { ...client, ...presigner };
    return awsModules;
  } catch (error) {
    const missing = Object.assign(
      new Error("Amazon S3 packages are not installed. Run npm install before using File Manager."),
      { status: 503, cause: error },
    );
    throw missing;
  }
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

function config() {
  const publicPrefix = normalizedRoot(process.env.AWS_S3_PUBLIC_PREFIX, "public/");
  const privatePrefix = normalizedRoot(process.env.AWS_S3_PRIVATE_PREFIX, "private/");
  const roots = [...new Set([publicPrefix, privatePrefix].filter(Boolean))];
  const maxUploadMb = Math.min(
    Math.max(Number(process.env.S3_MAX_UPLOAD_MB || 20) || 20, 1),
    500,
  );
  const cloudFrontDomain = String(
    process.env.AWS_CLOUDFRONT_DOMAIN || process.env.S3_PUBLIC_BASE_URL || "",
  )
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return {
    region: String(process.env.AWS_REGION || "").trim(),
    bucket: String(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "").trim(),
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
    uploadUrlExpiresSeconds: 300,
    downloadUrlExpiresSeconds: 300,
    configured: Boolean(process.env.AWS_REGION && (process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME)),
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
  };
}

function assertConfigured() {
  const value = config();
  if (!value.configured) {
    throw Object.assign(
      new Error("Amazon S3 is not configured. Add AWS_REGION and AWS_S3_BUCKET to the server environment."),
      { status: 503 },
    );
  }
  return value;
}

function client() {
  const value = assertConfigured();
  if (!s3Client) {
    const { S3Client } = loadAwsModules();
    const options = { region: value.region };
    if (process.env.AWS_S3_ENDPOINT) options.endpoint = process.env.AWS_S3_ENDPOINT;
    if (String(process.env.AWS_S3_FORCE_PATH_STYLE || "").toLowerCase() === "true") {
      options.forcePathStyle = true;
    }
    s3Client = new S3Client(options);
  }
  return s3Client;
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
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    /[\\/\0\r\n]/.test(name) ||
    /[<>:"|?*]/.test(name)
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

function encodeKey(key) {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
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

function notFound(error) {
  return ["NotFound", "NoSuchKey", "NoSuchBucket"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;
}

async function exists(key) {
  const settings = assertConfigured();
  const { HeadObjectCommand } = loadAwsModules();
  try {
    await client().send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    return true;
  } catch (error) {
    if (notFound(error)) return false;
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
  const { ListObjectsV2Command } = loadAwsModules();
  const result = await client().send(
    new ListObjectsV2Command({
      Bucket: settings.bucket,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: limit,
      ContinuationToken: continuationToken || undefined,
    }),
  );
  const folders = (result.CommonPrefixes || [])
    .map((row) => row.Prefix || "")
    .filter(Boolean)
    .map((folder) => ({
      prefix: folder,
      name: folder.slice(prefix.length).replace(/\/$/, ""),
    }));
  const files = (result.Contents || [])
    .filter((row) => row.Key && row.Key !== prefix && !row.Key.endsWith("/"))
    .map((row) => ({
      key: row.Key,
      name: row.Key.slice(prefix.length),
      sizeBytes: Number(row.Size || 0),
      lastModified: row.LastModified || null,
      etag: String(row.ETag || "").replace(/^"|"$/g, ""),
      publicUrl: publicUrl(row.Key, settings),
      isPublic: row.Key.startsWith(settings.publicPrefix),
    }));
  return {
    prefix,
    folders,
    files,
    nextToken: result.IsTruncated ? result.NextContinuationToken || "" : "",
    publicPrefix: settings.publicPrefix,
  };
}

async function createFolder(input = {}) {
  const settings = assertConfigured();
  const key = folderPrefix(input.prefix, input.folderName);
  const { PutObjectCommand } = loadAwsModules();
  await client().send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: "",
      ContentType: "application/x-directory",
    }),
  );
  return { key, prefix: key };
}

async function createUploadUrl(input = {}) {
  const upload = validateUpload(input);
  if (!upload.replace && (await exists(upload.key))) {
    throw Object.assign(new Error("A file with this name already exists. Enable Replace existing file to overwrite it."), { status: 409 });
  }
  const { PutObjectCommand, getSignedUrl } = loadAwsModules();
  const commandInput = {
    Bucket: upload.settings.bucket,
    Key: upload.key,
    ContentType: upload.contentType,
  };
  const encryption = String(process.env.AWS_S3_SERVER_SIDE_ENCRYPTION || "").trim();
  if (encryption) commandInput.ServerSideEncryption = encryption;
  const kmsKeyId = String(process.env.AWS_S3_KMS_KEY_ID || "").trim();
  if (kmsKeyId) commandInput.SSEKMSKeyId = kmsKeyId;
  const url = await getSignedUrl(client(), new PutObjectCommand(commandInput), {
    expiresIn: upload.settings.uploadUrlExpiresSeconds,
  });
  const headers = { "Content-Type": upload.contentType };
  if (encryption) headers["x-amz-server-side-encryption"] = encryption;
  if (kmsKeyId) headers["x-amz-server-side-encryption-aws-kms-key-id"] = kmsKeyId;
  return {
    key: upload.key,
    fileName: upload.fileName,
    method: "PUT",
    url,
    headers,
    expiresIn: upload.settings.uploadUrlExpiresSeconds,
    publicUrl: publicUrl(upload.key, upload.settings),
    replacing: upload.replace,
  };
}

async function createDownloadUrl(input = {}) {
  const settings = assertConfigured();
  const key = String(input.key || "").trim().replace(/\\/g, "/");
  if (!key || key.endsWith("/") || key.startsWith("/") || key.split("/").some((part) => part === "..")) {
    throw validationError("File key is invalid");
  }
  if (!hasAllowedRoot(key, settings.roots)) {
    throw validationError("File is outside the approved S3 locations");
  }
  const { HeadObjectCommand, GetObjectCommand, getSignedUrl } = loadAwsModules();
  let metadata;
  try {
    metadata = await client().send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
  } catch (error) {
    if (notFound(error)) throw Object.assign(new Error("File not found"), { status: 404 });
    throw error;
  }
  const disposition = String(input.disposition || "attachment").toLowerCase() === "inline" ? "inline" : "attachment";
  const fileName = key.split("/").pop() || "download";
  const command = new GetObjectCommand({
    Bucket: settings.bucket,
    Key: key,
    ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  return {
    key,
    url: await getSignedUrl(client(), command, { expiresIn: settings.downloadUrlExpiresSeconds }),
    expiresIn: settings.downloadUrlExpiresSeconds,
    contentType: metadata.ContentType || "application/octet-stream",
    sizeBytes: Number(metadata.ContentLength || 0),
    lastModified: metadata.LastModified || null,
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
};
