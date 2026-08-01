const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  applySecretValues,
  buildSignedRequest,
  loadAwsSecrets,
  parseSecretPayload,
  requiredBootstrapConfig,
} = require("../config/load-aws-secrets");

function bootstrapEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    PORT: "3200",
    CRM_SECRETS_REGION: "ap-south-1",
    CRM_SECRETS_SECRET_ID: "findoly/crm/production",
    CRM_SECRETS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    CRM_SECRETS_SECRET_ACCESS_KEY: "example-secret-access-key",
    ...overrides,
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("signed request targets AWS Secrets Manager without exposing credentials in its body", () => {
  const request = buildSignedRequest({
    region: "ap-south-1",
    secretId: "findoly/crm/production",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "example-secret-access-key",
    now: new Date("2026-07-31T18:00:00.000Z"),
  });

  assert.equal(request.endpoint, "https://secretsmanager.ap-south-1.amazonaws.com/");
  assert.equal(request.body, '{"SecretId":"findoly/crm/production"}');
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
  assert.match(request.headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target/);
  assert.doesNotMatch(request.body, /example-secret-access-key/);
});

test("secret values overwrite application env while Hostinger bootstrap values stay protected", () => {
  const env = bootstrapEnv({ MONGODB_URI: "old-value" });
  const result = applySecretValues({
    MONGODB_URI: "mongodb://new-value",
    AUTH_COOKIE_SECRET: "x".repeat(40),
    DASHBOARD_CACHE_TTL_MS: 60000,
    SYSTEM_EVENT_SLACK_ENABLED: false,
    NODE_ENV: "development",
    PORT: 9999,
    CRM_SECRETS_REGION: "us-east-1",
  }, env);

  assert.equal(env.MONGODB_URI, "mongodb://new-value");
  assert.equal(env.AUTH_COOKIE_SECRET, "x".repeat(40));
  assert.equal(env.DASHBOARD_CACHE_TTL_MS, "60000");
  assert.equal(env.SYSTEM_EVENT_SLACK_ENABLED, "false");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.PORT, "3200");
  assert.equal(env.CRM_SECRETS_REGION, "ap-south-1");
  assert.deepEqual(result, { loaded: 4, protectedCount: 3 });
});

test("loader fetches one JSON secret and applies it before application startup", async () => {
  const env = bootstrapEnv();
  let fetchCall;
  const result = await loadAwsSecrets({
    env,
    now: () => new Date("2026-07-31T18:00:00.000Z"),
    fetchImpl: async (url, options) => {
      fetchCall = { url, options };
      return response(200, {
        SecretString: JSON.stringify({
          MONGODB_URI: "mongodb://findoly",
          AUTH_COOKIE_SECRET: "s".repeat(40),
          CORS_ORIGINS: "https://admin.findoly.com",
        }),
      });
    },
  });

  assert.equal(fetchCall.url, "https://secretsmanager.ap-south-1.amazonaws.com/");
  assert.equal(fetchCall.options.method, "POST");
  assert.equal(fetchCall.options.headers["x-amz-target"], "secretsmanager.GetSecretValue");
  assert.equal(env.MONGODB_URI, "mongodb://findoly");
  assert.equal(env.AUTH_COOKIE_SECRET, "s".repeat(40));
  assert.equal(result.loaded, 3);
  assert.equal(result.skipped, false);
});

test("development can keep local dotenv configuration when no secret id is configured", async () => {
  const env = { NODE_ENV: "development", MONGODB_URI: "mongodb://local" };
  const result = await loadAwsSecrets({ env, fetchImpl: async () => assert.fail("must not fetch") });
  assert.deepEqual(result, { loaded: 0, protectedCount: 0, skipped: true });
  assert.equal(env.MONGODB_URI, "mongodb://local");
});

test("production requires the Hostinger secret identifier", () => {
  assert.throws(
    () => requiredBootstrapConfig({ NODE_ENV: "production" }),
    /CRM_SECRETS_SECRET_ID is required in production/,
  );
});

test("invalid secret JSON and nested values fail closed without partial env changes", () => {
  assert.throws(
    () => parseSecretPayload({ SecretString: "not-json" }),
    /must contain valid JSON/,
  );
  const env = { MONGODB_URI: "mongodb://original" };
  assert.throws(
    () => applySecretValues({
      MONGODB_URI: "mongodb://new",
      INVALID_NESTED_VALUE: { value: "not-supported" },
    }, env),
    /must be a string, number, or boolean/,
  );
  assert.equal(env.MONGODB_URI, "mongodb://original");
  assert.equal(env.INVALID_NESTED_VALUE, undefined);
});

test("AWS access failures stop startup without applying partial configuration", async () => {
  const env = bootstrapEnv();
  await assert.rejects(
    loadAwsSecrets({
      env,
      fetchImpl: async () => response(403, {
        __type: "AccessDeniedException",
        message: "User is not authorised",
      }),
    }),
    /AccessDeniedException.*not authorised/,
  );
  assert.equal(env.MONGODB_URI, undefined);
});

test("start.js remains a minimal Hostinger launcher and bin/www owns server startup", () => {
  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "bin", "www"), "utf8");

  assert.match(startSource, /require\(["']\.\/bin\/www["']\)/);
  assert.doesNotMatch(startSource, /require\(["']\.\/app["']\)/);
  assert.match(serverSource, /const secretResult = await loadSecrets\(\)/);
  assert.match(serverSource, /const app = loadApp\(\)/);
  assert.match(serverSource, /await app\.locals\.databasePromise/);
  assert.match(serverSource, /await listen\(server, port\)/);
  assert.ok(
    serverSource.indexOf("await loadSecrets()") < serverSource.indexOf("const app = loadApp()"),
    "Secrets Manager must load before app.js",
  );
  assert.ok(
    serverSource.indexOf("await listen(server, port)") < serverSource.indexOf("await loadSecrets()"),
    "Hostinger listener must bind before remote bootstrap work",
  );
  assert.ok(
    serverSource.indexOf("await loadSecrets()") < serverSource.indexOf("const app = loadApp()"),
    "Secrets Manager must still load before Express",
  );
  assert.match(serverSource, /CRM_STARTING/);
});

test("dotenv is loaded once by bin/www and is not reloaded by app.js", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "bin", "www"), "utf8");
  assert.doesNotMatch(appSource, /require\(["']dotenv["']\)/);
  assert.match(serverSource, /require\(["']dotenv["']\)\.config\(\)/);
  assert.equal((serverSource.match(/require\(["']dotenv["']\)/g) || []).length, 1);
});

test("package scripts use start.js and bootstrap production maintenance commands", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node ./start.js");
  assert.equal(packageJson.scripts.dev, "nodemon ./start.js");
  for (const name of [
    "seed",
    "migrate:structure",
    "migrate:agent-payouts",
    "migrate:marketplace-location",
    "ensure:indexes",
    "cleanup:marketplace-leads",
  ]) {
    assert.match(packageJson.scripts[name], /^node scripts\/run-with-runtime\.js scripts\//);
  }
});

test("CRM startup failures are logged and CloudWatch is flushed without importing app early", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "bin", "www"), "utf8");
  assert.doesNotMatch(serverSource, /^const app = require\(["']\.\.\/app["']\)/m);
  assert.match(serverSource, /console\.error\(["']CRM startup failed:/);
  assert.match(serverSource, /await cloudwatchLogger\.flush\(\{ timeoutMs: 2000 \}\)/);
});
