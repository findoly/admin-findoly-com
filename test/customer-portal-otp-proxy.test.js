"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("customer portal has no OTP delivery or verification routes", () => {
  const routes = read("routes/customer-portal.js");
  const controller = read("controllers/customerPortalController.js");
  assert.doesNotMatch(routes, /otp\/send|otp\/verify/);
  assert.doesNotMatch(controller, /sendOtp|verifyOtp/);
});

test("customer portal enquiry trusts only an explicit server-to-server verified-mobile assertion", () => {
  const service = read("services/customer-portal/customer-portal-service.js");
  assert.match(service, /if \(input\.mobileVerified !== true\)/);
  assert.match(service, /customerMobileVerified: true/);
  assert.match(service, /customerVerificationSource: "findoly\.com-direct-otp"/);
  assert.doesNotMatch(service, /CustomerOtpVerification|otp-proxy-client|requestOtpApi/);
});

test("obsolete CRM customer OTP persistence is removed from index management", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "models/CustomerOtpVerification.js")), false);
  assert.doesNotMatch(read("scripts/ensure-indexes.js"), /CustomerOtpVerification/);
});
