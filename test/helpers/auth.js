process.env.AUTH_COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || "test-auth-cookie-secret-with-32-characters";

const { encodeSession } = require("../../middleware/auth");

function adminCookie(exp = Date.now() + 60_000, permissions = ["*"]) {
  const value = encodeSession({
    v: 1,
    employeeId: "testemployee00000000000000000001",
    mobile: "9819595467",
    name: "Test Admin",
    email: "admin@example.com",
    employeeCode: "ADMIN",
    designation: "Administrator",
    department: "Administration",
    roleId: "testrole000000000000000000000001",
    roleName: "Super Admin",
    permissions,
    iat: Date.now(),
    exp,
  });
  return `service_crm_admin=${value}`;
}

module.exports = { adminCookie };
