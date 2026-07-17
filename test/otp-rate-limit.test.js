const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.CRM_OTP_RESEND_SECONDS = "30";
process.env.CRM_OTP_MAX_SENDS_PER_MINUTE = "2";
process.env.CRM_OTP_RATE_WINDOW_SECONDS = "60";

const {
  settings,
  rateLimitDecision,
  rateLimitError,
} = require("../services/access/otp-rate-limit-service");

test("CRM OTP send policy defaults to two sends per minute with a 30-second wait", () => {
  assert.deepEqual(settings(), {
    resendSeconds: 30,
    maxSendsPerWindow: 2,
    windowSeconds: 60,
  });
});

test("first OTP send is allowed", () => {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const decision = rateLimitDecision(null, now, settings());
  assert.equal(decision.allowed, true);
  assert.equal(decision.nextCount, 1);
});

test("OTP resend is blocked with the exact remaining wait", () => {
  const now = new Date("2026-07-17T10:00:10.000Z");
  const decision = rateLimitDecision({
    windowStartedAt: new Date("2026-07-17T10:00:00.000Z"),
    sendCount: 1,
    nextAllowedAt: new Date("2026-07-17T10:00:30.000Z"),
  }, now, settings());
  assert.equal(decision.allowed, false);
  assert.equal(decision.waitSeconds, 20);
});

test("third OTP send in the same minute waits until the window resets", () => {
  const now = new Date("2026-07-17T10:00:45.000Z");
  const decision = rateLimitDecision({
    windowStartedAt: new Date("2026-07-17T10:00:00.000Z"),
    sendCount: 2,
    nextAllowedAt: new Date("2026-07-17T10:00:40.000Z"),
  }, now, settings());
  assert.equal(decision.allowed, false);
  assert.equal(decision.waitSeconds, 15);
});

test("customer rate-limit error explains why and how long to wait", () => {
  const error = rateLimitError(17);
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterSeconds, 17);
  assert.match(error.message, /requested an OTP too recently/i);
  assert.match(error.message, /wait 17 seconds/i);
});

test("login page contains no browser countdown or browser request counter", () => {
  const source = fs.readFileSync(path.join(__dirname, "../views/auth/login.ejs"), "utf8");
  assert.doesNotMatch(source, /resendSeconds|resendTimer|startCountdown|setInterval/);
  assert.match(source, /:disabled="loading" @click="sendOtp\(true\)"/);
});
