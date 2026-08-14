const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("customer portal routes are mounted before employee API auth", () => {
  const source = read("routes/main.js");
  const customerIndex = source.indexOf('router.use("/customer-portal"');
  const authIndex = source.indexOf("router.use(apiAuth)");
  assert.ok(customerIndex > -1);
  assert.ok(authIndex > customerIndex);
});

test("customer portal API uses a dedicated shared token", () => {
  const source = read("middleware/customerPortalAuth.js");
  assert.match(source, /CUSTOMER_PORTAL_API_TOKEN/);
  assert.match(source, /timingSafeEqual/);
});

test("customer website submissions are marked verified and direct", () => {
  const source = read("services/customer-portal/customer-portal-service.js");
  assert.match(source, /sourceChannel: "customer-website"/);
  assert.match(source, /customerMobileVerified: true/);
  assert.match(source, /externalEnquiryId/);
});


test("customer portal no longer proxies customer OTP through CRM", () => {
  const routes = read("routes/customer-portal.js");
  const service = read("services/customer-portal/customer-portal-service.js");
  const indexes = read("scripts/ensure-indexes.js");
  assert.doesNotMatch(routes, /\/otp\/send|\/otp\/verify/);
  assert.doesNotMatch(service, /otp-proxy-client|CustomerOtpVerification|requestOtpApi|SEND_OTP_URL|VERIFY_OTP_URL/);
  assert.match(service, /input\.mobileVerified !== true/);
  assert.match(service, /customerVerificationSource: "findoly\.com-direct-otp"/);
  assert.doesNotMatch(indexes, /CustomerOtpVerification/);
});

