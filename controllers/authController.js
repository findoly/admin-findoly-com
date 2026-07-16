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

const OTP_SERVICE_BASE_URL = String(
  process.env.CRM_OTP_BASE_URL || "https://api.findoly.com/otp",
).replace(/\/+$/, "");
const SEND_OTP_URL = process.env.CRM_OTP_SEND_URL || `${OTP_SERVICE_BASE_URL}/send-otp`;
const VERIFY_OTP_URL = process.env.CRM_OTP_VERIFY_URL || `${OTP_SERVICE_BASE_URL}/verify-otp`;
const REQUEST_TIMEOUT_MS = 12_000;

function employeeMobile(value, label = "Mobile number") {
  const mobile = validateMobile(value, { label });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    throw Object.assign(new Error(`${label} must be a valid Indian mobile number`), { status: 400 });
  }
  return mobile;
}

async function requestOtpApi(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false || ["error", "failed", "fail"].includes(String(body?.status || "").toLowerCase())) {
      const message = body?.message || body?.error || body?.data?.message || "OTP service request failed";
      throw Object.assign(new Error(message), { status: response.status >= 400 && response.status < 500 ? 400 : 502 });
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("OTP service did not respond in time"), { status: 504 });
    }
    if (error?.status) throw error;
    throw Object.assign(new Error("Unable to connect to the OTP service"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function assertLoginAllowed(mobile) {
  const employee = await findActiveEmployeeByMobile(mobile);
  if (employee) return employee;
  if (await canUseBootstrap(mobile)) return null;
  throw Object.assign(new Error("No active employee is registered with this mobile number"), { status: 403 });
}

async function sendOtp(req, res, next) {
  try {
    const mobile = employeeMobile(req.body?.mobile);
    await assertLoginAllowed(mobile);
    const response = await requestOtpApi(SEND_OTP_URL, { mobile });
    return res.json({
      success: true,
      data: {
        sessionId: response?.data?.sessionId || response?.sessionId || "",
        message: response?.data?.message || response?.message || "OTP sent successfully",
        mobile,
      },
    });
  } catch (error) {
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

    await assertLoginAllowed(mobile);
    console.log("verify otp", VERIFY_OTP_URL)
    await requestOtpApi(VERIFY_OTP_URL, { mobile, otp });

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
};
