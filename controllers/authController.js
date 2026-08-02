const Employee = require("../models/Employee");
const { setAdminCookie, clearAdminCookie } = require("../middleware/auth");
const { validateMobile } = require("../utils/mobile");
const { textValue } = require("../utils/validation");
const {
  findActiveEmployeeByMobile,
  resolveEmployeeAccess,
  canUseBootstrap,
  createBootstrapEmployee,
  ensureDefaultRoles,
} = require("../services/access/access-service");
const {
  claimSendSlot,
  releaseSendSlot,
  claimIpSendSlot,
  claimIpVerifySlot,
  releaseIpSendSlot,
} = require("../services/access/otp-rate-limit-service");

const {
  requestOtpApi,
  OTP_SERVICE_BASE_URL,
  SEND_OTP_URL,
  VERIFY_OTP_URL,
  isExplicitOtpVerificationSuccess,
} = require("../services/access/otp-proxy-client");

function employeeMobile(value, label = "Mobile number") {
  const mobile = validateMobile(value, { label });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    throw Object.assign(new Error(`${label} must be a valid Indian mobile number`), { status: 400 });
  }
  return mobile;
}

async function assertLoginAllowed(mobile) {
  const employee = await findActiveEmployeeByMobile(mobile);
  if (employee) return employee;
  if (await canUseBootstrap(mobile)) return null;
  throw Object.assign(new Error("OTP verification failed or employee access is unavailable"), {
    status: 401,
    code: "CRM_LOGIN_NOT_AVAILABLE",
  });
}

function genericSendMessage() {
  return "If this mobile number is authorized, an OTP will be sent.";
}

function requestAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 200);
}

function shortDelay(milliseconds = 450) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendOtp(req, res, next) {
  let mobile = "";
  let rateLimitClaim = null;
  let ipRateLimitClaim = null;
  try {
    mobile = employeeMobile(req.body?.mobile);
    ipRateLimitClaim = await claimIpSendSlot(requestAddress(req));
    const employee = await findActiveEmployeeByMobile(mobile);
    const bootstrapAllowed = employee ? false : await canUseBootstrap(mobile);
    if (!employee && !bootstrapAllowed) {
      await shortDelay(400 + Math.floor(Math.random() * 250));
      return res.json({
        success: true,
        data: { sessionId: "", message: genericSendMessage(), mobile },
      });
    }
    rateLimitClaim = await claimSendSlot(mobile);
    const response = await requestOtpApi(SEND_OTP_URL, { mobile });
    return res.json({
      success: true,
      data: {
        sessionId: response?.data?.sessionId || response?.sessionId || "",
        message: genericSendMessage(),
        mobile,
      },
    });
  } catch (error) {
    const deliveryUncertain = [502, 504].includes(Number(error?.status)) && error?.requestMayHaveSucceeded;
    if (rateLimitClaim && error?.code !== "CRM_OTP_SEND_RATE_LIMIT" && !deliveryUncertain) {
      await releaseSendSlot(mobile, rateLimitClaim.requestId).catch(() => {});
    }
    if (ipRateLimitClaim && !["CRM_OTP_IP_RATE_LIMIT", "CRM_OTP_SEND_RATE_LIMIT"].includes(error?.code) && !deliveryUncertain) {
      await releaseIpSendSlot(ipRateLimitClaim.keyHash, ipRateLimitClaim.requestId).catch(() => {});
    }
    if (error?.code === "CRM_OTP_IP_RATE_LIMIT") {
      res.set("Retry-After", String(error.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "OTP_NETWORK_RATE_LIMIT",
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error?.code === "CRM_OTP_SEND_RATE_LIMIT") {
      res.set("Retry-After", String(error.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "OTP_RESEND_WAIT",
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error?.status === 429) {
      const retryAfterSeconds = Number(error.retryAfterSeconds || 0);
      if (retryAfterSeconds > 0) res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "OTP_SERVICE_RATE_LIMIT",
        message: error.message || "The OTP service has temporarily limited requests. Please try again shortly.",
        ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
      });
    }
    if ([502, 504].includes(Number(error?.status))) {
      const allowUnconfirmed = String(process.env.CRM_OTP_SEND_ALLOW_UNCONFIRMED || "true").toLowerCase() !== "false";
      if (allowUnconfirmed && error?.requestMayHaveSucceeded) {
        // Some OTP gateways deliver the message but close or time out before a
        // usable acknowledgement reaches the CRM. Do not trap the employee on
        // the mobile step; verification remains authoritative and secure.
        return res.status(202).json({
          success: true,
          data: {
            sessionId: "",
            mobile,
            deliveryUnconfirmed: true,
            message: genericSendMessage(),
          },
        });
      }
      return res.status(503).json({
        success: false,
        code: "OTP_SERVICE_UNAVAILABLE",
        message: error.status === 504
          ? "The OTP service took too long to respond. Please try again."
          : "We could not send an OTP because the OTP service is temporarily unavailable. Please try again shortly.",
      });
    }
    return next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const mobile = employeeMobile(req.body?.mobile);
    const otp = textValue(req.body?.otp, {
      label: "OTP",
      required: true,
      minLength: 4,
      maxLength: 8,
    });
    if (!/^\d{4,8}$/.test(otp)) {
      throw Object.assign(new Error("OTP must contain 4 to 8 digits"), { status: 400 });
    }

    await claimIpVerifySlot(requestAddress(req));
    const verification = await requestOtpApi(VERIFY_OTP_URL, { mobile, otp });
    if (!isExplicitOtpVerificationSuccess(verification)) {
      throw Object.assign(new Error("Invalid or expired OTP"), { status: 401, code: "OTP_INVALID" });
    }
    await assertLoginAllowed(mobile);

    await ensureDefaultRoles();
    let employee = await findActiveEmployeeByMobile(mobile);
    if (!employee) employee = await createBootstrapEmployee(mobile);
    if (!employee || employee.status !== "active") {
      throw Object.assign(new Error("Employee access is inactive"), { status: 403 });
    }

    const access = await resolveEmployeeAccess(employee.toObject ? employee.toObject() : employee);
    if (!access) {
      throw Object.assign(new Error("The assigned employee role is inactive or unavailable"), { status: 403 });
    }

    await Employee.updateOne(
      { employeeId: employee.employeeId },
      { $set: { lastLoginAt: new Date() } },
    );
    const session = setAdminCookie(res, access);
    return res.json({
      success: true,
      data: {
        employeeId: session.employeeId,
        name: session.name,
        mobile: session.mobile,
        email: session.email,
        roleId: session.roleId,
        roleName: session.roleName,
        permissions: session.permissions,
        expiresAt: new Date(session.exp).toISOString(),
      },
    });
  } catch (error) {
    if (error?.code === "CRM_LOGIN_NOT_AVAILABLE" || [400, 401, 403].includes(Number(error?.status))) {
      return res.status(401).json({
        success: false,
        code: "OTP_VERIFICATION_FAILED",
        message: "OTP verification failed or employee access is unavailable",
      });
    }
    if (error?.status === 429) {
      const retryAfterSeconds = Number(error.retryAfterSeconds || 0);
      if (retryAfterSeconds > 0) res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "OTP_VERIFICATION_RESTRICTED",
        message: error.message || "OTP verification is temporarily restricted. Please try again later.",
        ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
      });
    }
    if ([502, 504].includes(Number(error?.status))) {
      return res.status(503).json({
        success: false,
        code: "OTP_SERVICE_UNAVAILABLE",
        message: error.status === 504
          ? "The OTP service took too long to verify your code. Please try again."
          : "We could not verify your OTP because the OTP service is temporarily unavailable. Please try again shortly.",
      });
    }
    return next(error);
  }
}

function me(req, res) {
  return res.json({ success: true, data: req.admin });
}

function logout(req, res) {
  clearAdminCookie(res);
  return res.json({ success: true, message: "Logged out" });
}

module.exports = {
  sendOtp,
  verifyOtp,
  me,
  logout,
  requestOtpApi,
  OTP_SERVICE_BASE_URL,
  SEND_OTP_URL,
  VERIFY_OTP_URL,
  assertLoginAllowed,
  genericSendMessage,
  requestAddress,
};
