"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { isExplicitOtpVerificationSuccess } = require("../services/access/otp-proxy-client");

function loadController(verificationBody) {
  const controllerPath = path.join(__dirname, "..", "controllers", "authController.js");
  const calls = { employeeUpdates: 0, cookies: 0 };
  const employee = {
    employeeId: "employee-1",
    status: "active",
    toObject() { return { ...this }; },
  };
  const mocks = {
    "../models/Employee": {
      async updateOne() { calls.employeeUpdates += 1; },
    },
    "../middleware/auth": {
      setAdminCookie() {
        calls.cookies += 1;
        return {
          employeeId: "employee-1",
          name: "Admin",
          mobile: "9876543210",
          email: "admin@example.com",
          roleId: "role-1",
          roleName: "Admin",
          permissions: ["all"],
          exp: Date.now() + 60000,
        };
      },
      clearAdminCookie() {},
    },
    "../utils/mobile": {
      validateMobile(value) { return String(value || "").replace(/\D/g, "").slice(-10); },
    },
    "../utils/validation": {
      textValue(value) { return String(value || "").trim(); },
    },
    "../services/access/access-service": {
      async findActiveEmployeeByMobile() { return employee; },
      async resolveEmployeeAccess() { return { employeeId: "employee-1" }; },
      async canUseBootstrap() { return false; },
      async createBootstrapEmployee() { return employee; },
      async ensureDefaultRoles() {},
    },
    "../services/access/otp-rate-limit-service": {
      async claimSendSlot() { return {}; },
      async releaseSendSlot() {},
      async claimIpSendSlot() { return {}; },
      async claimIpVerifySlot() {},
      async releaseIpSendSlot() {},
    },
    "../services/access/otp-proxy-client": {
      OTP_SERVICE_BASE_URL: "https://api.findoly.com/otp",
      SEND_OTP_URL: "https://api.findoly.com/otp/send-otp",
      VERIFY_OTP_URL: "https://api.findoly.com/otp/verify-otp",
      async requestOtpApi() { return verificationBody; },
      isExplicitOtpVerificationSuccess,
    },
  };
  const controllerModule = new Module(controllerPath, module);
  controllerModule.filename = controllerPath;
  controllerModule.paths = Module._nodeModulePaths(path.dirname(controllerPath));
  controllerModule.require = (request) => (
    Object.prototype.hasOwnProperty.call(mocks, request)
      ? mocks[request]
      : Module.createRequire(controllerPath)(request)
  );
  controllerModule._compile(fs.readFileSync(controllerPath, "utf8"), controllerPath);
  return { controller: controllerModule.exports, calls };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return body; },
  };
}

test("CRM OTP verification rejects ambiguous 2xx bodies before session creation", async () => {
  const { controller, calls } = loadController({ success: true, message: "request processed" });
  const res = responseRecorder();
  await controller.verifyOtp(
    { body: { mobile: "9876543210", otp: "000000" }, ip: "127.0.0.1" },
    res,
    (error) => { throw error; },
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "OTP_VERIFICATION_FAILED");
  assert.equal(calls.cookies, 0);
  assert.equal(calls.employeeUpdates, 0);
});

test("CRM OTP verification accepts only explicit boolean verified true", async () => {
  for (const body of [
    { verified: "true" },
    { verified: 1 },
    {},
    { data: { verified: null } },
    { verified: true, data: { verified: false } },
  ]) {
    assert.equal(isExplicitOtpVerificationSuccess(body), false);
  }
  const { controller, calls } = loadController({ data: { verified: true } });
  const res = responseRecorder();
  await controller.verifyOtp(
    { body: { mobile: "9876543210", otp: "654321" }, ip: "127.0.0.1" },
    res,
    (error) => { throw error; },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(calls.cookies, 1);
  assert.equal(calls.employeeUpdates, 1);
});
