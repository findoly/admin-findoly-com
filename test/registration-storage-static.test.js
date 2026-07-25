const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("registration events and recipients are available in Communication Center", () => {
  const rules = source("services/communication/notification-service.js");
  const model = source("models/CommunicationRule.js");
  const view = source("views/communication/rules.ejs");
  for (const event of ["provider_created", "agent_created", "employee_created"]) {
    assert.match(rules, new RegExp(event));
    assert.match(view, new RegExp(event));
  }
  assert.match(model, /"employee"/);
  assert.match(view, /value="employee"/);
});

test("account create services dispatch registration events after creation", () => {
  assert.match(source("services/provider/provider-service.js"), /dispatch\(\s*"provider_created"/);
  assert.match(source("services/agent/agent-service.js"), /dispatch\(\s*"agent_created"/);
  assert.match(source("services/access/employee-service.js"), /dispatch\(\s*"employee_created"/);
  assert.match(source("services/communication/account-registration-service.js"), /catch \(error\)/);
});

test("S3 paths stay inside approved public and private prefixes", () => {
  process.env.AWS_S3_PUBLIC_PREFIX = "public/";
  process.env.AWS_S3_PRIVATE_PREFIX = "private/";
  const storage = require("../services/storage/s3-service");
  assert.equal(storage.normalizePrefix("public/website"), "public/website/");
  assert.equal(storage.objectKey("private/reports/", "monthly.pdf"), "private/reports/monthly.pdf");
  assert.throws(() => storage.normalizePrefix("other/"), /outside the approved/);
  assert.throws(() => storage.normalizePrefix("public/../private/"), /invalid/);
  assert.throws(() => storage.safeName("../secret.pdf", "File name"), /unsupported/);
});

test("storage routes enforce separate view and manage permissions", () => {
  const routes = source("routes/storage.js");
  assert.match(routes, /storage\.view/);
  assert.match(routes, /storage\.manage/);
  assert.match(source("utils/permissions.js"), /storage\.manage/);
  assert.match(source("services/access/role-service.js"), /"storage\.manage": \["storage\.view"\]/);
});

test("S3 presigned GET URLs use AWS canonical ordering and encoding", () => {
  const crypto = require("crypto");
  const previous = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
  };
  Object.assign(process.env, {
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET: "findoly-prod",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "secret-example",
  });
  delete process.env.AWS_SESSION_TOKEN;

  function awsEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }
  function compare(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }
  function canonicalQuery(entries) {
    return entries
      .map(([key, value]) => [awsEncode(key), awsEncode(value)])
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        compare(leftKey, rightKey) || compare(leftValue, rightValue),
      )
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
  }
  function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }
  function hmac(key, value, encoding) {
    return crypto.createHmac("sha256", key).update(value).digest(encoding);
  }

  try {
    delete require.cache[require.resolve("../services/storage/s3-service")];
    const storage = require("../services/storage/s3-service");
    const settings = storage.config();
    const signedUrl = storage.presignedUrl(settings, "GET", "public/test/provider document.pdf", {
      query: {
        "response-content-disposition": "inline; filename*=UTF-8''provider%20document.pdf",
      },
      expiresIn: 300,
    });

    assert.doesNotMatch(signedUrl, /\+/);
    assert.match(signedUrl, /provider%2520document\.pdf/);

    const parsed = new URL(signedUrl);
    const rawNames = parsed.search.slice(1).split("&").map((part) => part.split("=", 1)[0]);
    assert.equal(rawNames[0], "X-Amz-Algorithm");
    assert.equal(rawNames.at(-1), "response-content-disposition");

    const suppliedSignature = parsed.searchParams.get("X-Amz-Signature");
    const unsignedEntries = [...parsed.searchParams.entries()].filter(([key]) => key !== "X-Amz-Signature");
    const amzDate = parsed.searchParams.get("X-Amz-Date");
    const credential = parsed.searchParams.get("X-Amz-Credential");
    const scope = credential.slice(credential.indexOf("/") + 1);
    const [dateStamp, region] = scope.split("/");
    const canonicalRequest = [
      "GET",
      parsed.pathname,
      canonicalQuery(unsignedEntries),
      `host:${parsed.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const dateKey = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const expectedSignature = hmac(signingKey, stringToSign, "hex");

    assert.equal(suppliedSignature, expectedSignature);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve("../services/storage/s3-service")];
  }
});
