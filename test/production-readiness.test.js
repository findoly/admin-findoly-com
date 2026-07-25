const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function loadWithStubs(relativePath, stubs) {
  const absolute = require.resolve(path.join(__dirname, "..", relativePath));
  delete require.cache[absolute];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolute);
  } finally {
    Module._load = originalLoad;
  }
}

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body || {});
    },
  };
}

test("OTP client accepts successful JSON and plain-text acknowledgements", async () => {
  const previousFetch = global.fetch;
  const clientPath = require.resolve("../services/access/otp-proxy-client");
  delete require.cache[clientPath];
  const client = require(clientPath);
  try {
    global.fetch = async () => fakeResponse(200, { success: true, data: { sessionId: "session-1" } });
    assert.equal((await client.requestOtpApi("https://example.test/send", { mobile: "9876543210" })).data.sessionId, "session-1");

    global.fetch = async () => fakeResponse(202, "OTP accepted");
    assert.equal((await client.requestOtpApi("https://example.test/send", { mobile: "9876543210" })).message, "OTP accepted");
  } finally {
    global.fetch = previousFetch;
  }
});

test("OTP client marks gateway 5xx and timeouts as possibly delivered", async () => {
  const previousFetch = global.fetch;
  const client = require("../services/access/otp-proxy-client");
  try {
    global.fetch = async () => fakeResponse(502, { success: false, message: "gateway error" });
    await assert.rejects(
      client.requestOtpApi("https://example.test/send", { mobile: "9876543210" }),
      (error) => error.status === 502 && error.requestMayHaveSucceeded === true,
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("login OTP send returns accepted state when delivery acknowledgement is uncertain", async () => {
  const previousFetch = global.fetch;
  const controller = loadWithStubs("controllers/authController.js", {
    "../models/Employee": { updateOne: async () => ({ matchedCount: 1 }) },
    "../middleware/auth": { setAdminCookie: () => ({}), clearAdminCookie: () => {} },
    "../services/access/access-service": {
      findActiveEmployeeByMobile: async () => ({ employeeId: "employee-1", status: "active" }),
      resolveEmployeeAccess: async () => ({}),
      canUseBootstrap: async () => false,
      createBootstrapEmployee: async () => null,
      ensureDefaultRoles: async () => {},
    },
    "../services/access/otp-rate-limit-service": {
      claimSendSlot: async () => ({ requestId: "request-1" }),
      releaseSendSlot: async () => {},
    },
  });
  const req = { body: { mobile: "9876543210" } };
  const state = { status: 200, body: null };
  const res = {
    set() {},
    status(value) { state.status = value; return this; },
    json(value) { state.body = value; return value; },
  };
  try {
    global.fetch = async () => fakeResponse(502, { message: "Bad gateway after provider accepted request" });
    await controller.sendOtp(req, res, (error) => { throw error; });
    assert.equal(state.status, 202);
    assert.equal(state.body.success, true);
    assert.equal(state.body.data.deliveryUnconfirmed, true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("provider creation falls back to validated manual city/state and survives background sync failures", async () => {
  let saved = null;
  const emptyCursor = {
    async *[Symbol.asyncIterator]() {},
  };
  const Provider = {
    async exists() { return false; },
    async create(data) {
      saved = {
        ...data,
        providerId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdAt: new Date("2026-07-25T10:00:00.000Z"),
      };
      return saved;
    },
    findOne() { return { lean: async () => saved }; },
    async updateOne() { return { matchedCount: 1 }; },
  };
  const providerService = loadWithStubs("services/provider/provider-service.js", {
    "../../models/Provider": Provider,
    "../../models/Enquiry": { find: () => ({ cursor: () => emptyCursor }) },
    "../../models/LeadDistribution": {
      async updateMany() { throw new Error("simulated post-create lead-sync outage"); },
    },
    "../../models/WalletTransaction": {},
    "../../utils/pagination": {
      getPagination: () => ({ limit: 20, cursor: "" }),
      cursorPaginate: async () => ({ data: [], pagination: { limit: 20, returned: 0, hasNext: false, nextCursor: "" } }),
    },
    "../enquiry/enquiry-service": { distribute: async () => {} },
    "../location/geocoding-service": {
      geocodePincode: async () => { throw Object.assign(new Error("maps unavailable"), { status: 503 }); },
    },
    "../communication/account-registration-service": { dispatch: async () => [] },
  });

  const created = await providerService.create({
    name: "Test Provider",
    mobile: "9876543210",
    email: "provider@example.com",
    categorySlugs: ["painter"],
    servicePincode: "400064",
    city: "Mumbai",
    state: "Maharashtra",
  });
  assert.equal(created.providerId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(created.serviceLocationSource, "manual_pincode");
  assert.equal(created.city, "Mumbai");
  assert.equal(created.state, "Maharashtra");
  await new Promise((resolve) => setImmediate(resolve));
});

test("registration notification failure never fails account creation flow", async () => {
  const service = loadWithStubs("services/communication/account-registration-service.js", {
    "./notification-service": { trigger: async () => { throw new Error("SES unavailable"); } },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await service.dispatch("provider_created", { provider: { providerId: "p1" } }, "qa"), []);
  } finally {
    console.error = originalError;
  }
});

test("communication event integration uses a required constant-time token guard", () => {
  const middleware = require("../middleware/public-api");
  const oldToken = process.env.COMMUNICATION_EVENT_API_TOKEN;
  try {
    process.env.COMMUNICATION_EVENT_API_TOKEN = "event-secret";
    let status = 0;
    let body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return value; } };
    middleware.communicationEventAccess(
      { get: (name) => name.toLowerCase() === "x-communication-token" ? "wrong" : "" },
      res,
      () => assert.fail("must not continue"),
    );
    assert.equal(status, 401);
    assert.equal(body.code, "COMMUNICATION_EVENT_UNAUTHORIZED");

    let continued = false;
    middleware.communicationEventAccess(
      { get: (name) => name.toLowerCase() === "x-communication-token" ? "event-secret" : "" },
      res,
      () => { continued = true; },
    );
    assert.equal(continued, true);
  } finally {
    if (oldToken === undefined) delete process.env.COMMUNICATION_EVENT_API_TOKEN;
    else process.env.COMMUNICATION_EVENT_API_TOKEN = oldToken;
  }
});

test("public integration guards reject missing OTP token and accept authorised CRM employee", () => {
  const middleware = require("../middleware/public-api");
  const oldToken = process.env.COMMUNICATION_OTP_API_TOKEN;
  try {
    delete process.env.COMMUNICATION_OTP_API_TOKEN;
    let status = 0;
    let body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return value; } };
    middleware.communicationOtpAccess({ admin: null, get: () => "" }, res, () => assert.fail("must not continue"));
    assert.equal(status, 503);
    assert.equal(body.code, "COMMUNICATION_OTP_NOT_CONFIGURED");

    let continued = false;
    middleware.communicationOtpAccess(
      { admin: { permissions: ["communications.send"] }, get: () => "" },
      res,
      () => { continued = true; },
    );
    assert.equal(continued, true);
  } finally {
    if (oldToken === undefined) delete process.env.COMMUNICATION_OTP_API_TOKEN;
    else process.env.COMMUNICATION_OTP_API_TOKEN = oldToken;
  }
});

test("runtime configuration keeps optional incomplete S3 disabled without crashing CRM", () => {
  const { validateRuntimeConfig } = require("../utils/runtime-config");
  const result = validateRuntimeConfig({
    NODE_ENV: "production",
    MONGODB_URI: "mongodb://localhost/findoly",
    AUTH_COOKIE_SECRET: "x".repeat(40),
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET: "findoly-storage",
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((message) => message.includes("S3 configuration is incomplete")));
});

test("S3 validator restricts paths, size and file types and creates short-lived signatures", () => {
  const keys = [
    "AWS_REGION", "AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_PUBLIC_PREFIX", "AWS_S3_PRIVATE_PREFIX", "S3_MAX_UPLOAD_MB",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET: "findoly-storage",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "secret-example",
    AWS_S3_PUBLIC_PREFIX: "public/",
    AWS_S3_PRIVATE_PREFIX: "private/",
    S3_MAX_UPLOAD_MB: "2",
  });
  try {
    const storage = require("../services/storage/s3-service");
    const upload = storage.validateUpload({
      prefix: "public/website/",
      fileName: "banner.webp",
      contentType: "image/webp",
      sizeBytes: 1000,
    });
    assert.equal(upload.key, "public/website/banner.webp");
    assert.throws(() => storage.normalizePrefix("public/../private/"), /invalid/);
    assert.throws(() => storage.validateUpload({ prefix: "public/", fileName: "script.exe", contentType: "application/octet-stream", sizeBytes: 10 }), /not allowed/);
    assert.throws(() => storage.validateUpload({ prefix: "private/", fileName: "large.pdf", contentType: "application/pdf", sizeBytes: 3 * 1024 * 1024 }), /must not exceed/);
    const url = storage.presignedUrl(upload.settings, "PUT", upload.key, { headers: { "Content-Type": upload.contentType }, expiresIn: 300 });
    assert.match(url, /^https:\/\/findoly-storage\.s3\.ap-south-1\.amazonaws\.com\//);
    assert.match(url, /X-Amz-Signature=/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("production source contains the critical validation and concurrency protections", () => {
  assert.match(source("services/provider/provider-service.js"), /scheduleProviderSync\(created, actor\)/);
  assert.match(source("services/provider/provider-service.js"), /serviceLocationSource: "manual_pincode"/);
  assert.match(source("services/partner-payout/partner-payout-service.js"), /PAYOUT_ALREADY_PROCESSING/);
  assert.match(source("services/partner-payout/razorpay-service.js"), /RAZORPAY_HTTP_TIMEOUT_MS/);
  assert.match(source("services/invoice/invoice-service.js"), /Invoice number is already in use/);
  assert.match(source("services/communication/rule-service.js"), /Email rule requires an active email template/);
  assert.match(source("routes/main.js"), /communicationOtpAccess/);
  assert.match(source("routes/main.js"), /communicationEventAccess/);
  assert.match(source("services/communication/notification-service.js"), /triggerSafe/);
  assert.match(source("services/enquiry/enquiry-service.js"), /notificationService\.triggerSafe/);
  assert.match(source("services/communication/communication-service.js"), /Communication\.aggregate/);
  assert.match(source("models/Provider.js"), /match: \/\^\[6-9\]\\d\{9\}\$\//);
  assert.match(source("views\/provider\/form\.ejs"), /Provider service PIN code must contain exactly 6 digits/);
});

test("pincode cache ignores invalid coordinates and refreshes the location", async () => {
  const previousFetch = global.fetch;
  const service = loadWithStubs("services/location/geocoding-service.js", {
    "../../models/PincodeLocation": {
      findOne: () => ({ lean: async () => ({ pincode: "400064", latitude: null, longitude: null, country: "India" }) }),
      updateOne: async () => ({ acknowledged: true }),
    },
  });
  const oldKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  try {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          status: "OK",
          results: [{
            formatted_address: "Malad West, Mumbai, Maharashtra 400064, India",
            geometry: { location: { lat: 19.186, lng: 72.848 } },
            address_components: [
              { long_name: "Mumbai", types: ["locality"] },
              { long_name: "Maharashtra", types: ["administrative_area_level_1"] },
              { long_name: "India", short_name: "IN", types: ["country"] },
            ],
          }],
        };
      },
    });
    const location = await service.geocodePincode("400064");
    assert.equal(location.city, "Mumbai");
    assert.equal(location.latitude, 19.186);
  } finally {
    global.fetch = previousFetch;
    if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = oldKey;
  }
});

test("large partner eligibility uses counts and a bounded withdrawal batch", () => {
  const payout = source("services/partner-payout/partner-payout-service.js");
  assert.match(payout, /AGENT_WITHDRAWAL_MAX_REFERRALS/);
  assert.match(payout, /Enquiry\.countDocuments\(query\)/);
  assert.match(payout, /\.limit\(conversionNeeded\)/);
  assert.match(payout, /\.limit\(remaining\)/);
  assert.doesNotMatch(payout, /const rows = await Enquiry\.find\(maturedEligibleQuery/);
});

test("declared Node runtime matches the locked AWS SDK requirement", () => {
  const pkg = JSON.parse(source("package.json"));
  const lock = JSON.parse(source("package-lock.json"));
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(lock.packages[""].engines.node, ">=20");
});
