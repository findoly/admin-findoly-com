const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.CRM_OTP_BASE_URL = "https://api.findoly.com/otp";
delete process.env.CRM_OTP_SEND_URL;
delete process.env.CRM_OTP_VERIFY_URL;

const authController = require("../services/access/otp-proxy-client");

test("server-side Findoly OTP endpoints use the OTP namespace", () => {
  assert.equal(authController.SEND_OTP_URL, "https://api.findoly.com/otp/send-otp");
  assert.equal(authController.VERIFY_OTP_URL, "https://api.findoly.com/otp/verify-otp");
  assert.doesNotMatch(authController.VERIFY_OTP_URL, /\/api\/auth\/verify-otp$/);
});

test("login browser calls only same-origin CRM auth routes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../views/auth/login.ejs"), "utf8");
  assert.match(source, /fetch\('\/api\/auth\/send-otp'/);
  assert.match(source, /fetch\('\/api\/auth\/verify-otp'/);
  assert.doesNotMatch(source, /api\.findoly\.com/);
  assert.doesNotMatch(source, /localhost:\d+/);
});
