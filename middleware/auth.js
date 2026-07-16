const crypto = require("crypto");
const Employee = require("../models/Employee");
const Role = require("../models/Role");
const { hasPermission } = require("../utils/permissions");

const cookieName = process.env.AUTH_COOKIE_NAME || "service_crm_admin";
const SESSION_MS = 24 * 60 * 60 * 1000;

function cookieSecret() {
  return String(
    process.env.AUTH_COOKIE_SECRET ||
      process.env.SESSION_SECRET ||
      process.env.OTP_SECRET ||
      "findoly-crm-development-cookie-secret-change-me",
  );
}

function sign(value) {
  return crypto.createHmac("sha256", cookieSecret()).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw) {
  const [payload, signature, extra] = String(raw || "").split(".");
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) {
    throw new Error("Invalid session signature");
  }
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!session || session.v !== 1 || !session.employeeId || !Number.isFinite(session.exp)) {
    throw new Error("Invalid session payload");
  }
  return session;
}

function clearOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function clearAdminCookie(res) {
  res.clearCookie(cookieName, clearOptions());
}

function setAdminCookie(res, employeeAccess) {
  const now = Date.now();
  const session = {
    v: 1,
    employeeId: employeeAccess.employeeId,
    mobile: employeeAccess.mobile,
    name: employeeAccess.name,
    email: employeeAccess.email || "",
    employeeCode: employeeAccess.employeeCode || "",
    designation: employeeAccess.designation || "",
    department: employeeAccess.department || "",
    roleId: employeeAccess.roleId,
    roleName: employeeAccess.roleName,
    permissions: Array.isArray(employeeAccess.permissions) ? employeeAccess.permissions : [],
    iat: now,
    exp: now + SESSION_MS,
  };
  res.cookie(cookieName, encodeSession(session), {
    ...clearOptions(),
    maxAge: SESSION_MS,
  });
  return session;
}

async function loadCurrentAccess(session) {
  if (process.env.SKIP_DB === "true") return session;
  const employee = await Employee.findOne({
    employeeId: session.employeeId,
    status: "active",
  }).lean();
  if (!employee) return null;
  const role = await Role.findOne({ roleId: employee.roleId, active: true }).lean();
  if (!role) return null;
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    mobile: employee.mobile,
    email: employee.email || "",
    employeeCode: employee.employeeCode || "",
    designation: employee.designation || "",
    department: employee.department || "",
    roleId: role.roleId,
    roleName: role.name,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    iat: session.iat,
    exp: session.exp,
  };
}

async function attachAdmin(req, res, next) {
  req.admin = null;
  res.locals.currentAdmin = null;
  res.locals.can = () => false;
  const raw = req.cookies?.[cookieName];
  if (!raw) return next();
  try {
    const session = decodeSession(raw);
    if (session.exp <= Date.now()) {
      clearAdminCookie(res);
      return next();
    }
    const current = await loadCurrentAccess(session);
    if (!current) {
      clearAdminCookie(res);
      return next();
    }
    req.admin = current;
    res.locals.currentAdmin = current;
    res.locals.can = (permission) => hasPermission(current, permission);
    return next();
  } catch (error) {
    clearAdminCookie(res);
    return next();
  }
}

function pageAuth(req, res, next) {
  if (req.admin) return next();
  return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl || "/dashboard")}`);
}

function apiAuth(req, res, next) {
  if (req.admin) return next();
  return res.status(401).json({ success: false, message: "Authentication required" });
}

function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (permissions.some((permission) => hasPermission(req.admin, permission))) return next();
    if (req.originalUrl.startsWith("/api")) {
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
    }
    return res.status(403).render("error", {
      title: "Access denied",
      message: "You do not have permission to access this feature.",
    });
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (hasPermission(req.admin, permission)) return next();
    if (req.originalUrl.startsWith("/api")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }
    return res.status(403).render("error", {
      title: "Access denied",
      message: "You do not have permission to access this feature.",
    });
  };
}

module.exports = {
  attachAdmin,
  pageAuth,
  apiAuth,
  requirePermission,
  requireAnyPermission,
  hasPermission,
  setAdminCookie,
  clearAdminCookie,
  encodeSession,
  decodeSession,
  SESSION_MS,
};
