const Role = require("../../models/Role");
const Employee = require("../../models/Employee");
const { DEFAULT_ROLES } = require("../../utils/permissions");
const { validateMobile } = require("../../utils/mobile");

async function ensureDefaultRoles() {
  const roles = [];
  for (const definition of DEFAULT_ROLES) {
    let role = await Role.findOneAndUpdate(
      { slug: definition.slug },
      {
        $setOnInsert: {
          name: definition.name,
          slug: definition.slug,
          description: definition.description,
          permissions: definition.permissions,
          active: true,
          isSystem: true,
          isSuperAdmin: Boolean(definition.isSuperAdmin),
          createdBy: "system",
          updatedBy: "system",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    if (
      definition.slug === "admin" &&
      definition.permissions.some((permission) => !(role.permissions || []).includes(permission))
    ) {
      role = await Role.findOneAndUpdate(
        { slug: definition.slug },
        {
          $addToSet: { permissions: { $each: definition.permissions } },
          $set: { updatedBy: "system-permission-sync" },
        },
        { new: true },
      ).lean();
    }

    roles.push(role);
  }
  return roles;
}

function bootstrapMobile() {
  const raw = process.env.CRM_BOOTSTRAP_MOBILE || process.env.ADMIN_MOBILE || "";
  if (!raw) return "";
  const mobile = validateMobile(raw, { label: "CRM bootstrap mobile" });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    throw Object.assign(new Error("CRM bootstrap mobile must be a valid Indian mobile number"), { status: 400 });
  }
  return mobile;
}

async function findActiveEmployeeByMobile(mobile) {
  return Employee.findOne({ normalizedMobile: mobile, status: "active" }).lean();
}

async function resolveEmployeeAccess(employee) {
  if (!employee || employee.status !== "active") return null;
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
  };
}

async function canUseBootstrap(mobile) {
  const configured = bootstrapMobile();
  if (!configured || configured !== mobile) return false;
  return (await Employee.countDocuments({})) === 0;
}

async function createBootstrapEmployee(mobile) {
  const configured = bootstrapMobile();
  if (!configured || configured !== mobile) return null;
  if ((await Employee.countDocuments({})) > 0) return null;
  const roles = await ensureDefaultRoles();
  const superAdmin = roles.find((role) => role.slug === "super-admin");
  if (!superAdmin) throw Object.assign(new Error("Super Admin role could not be created"), { status: 500 });
  try {
    return await Employee.create({
      name: process.env.CRM_BOOTSTRAP_NAME || "CRM Administrator",
      mobile,
      normalizedMobile: mobile,
      email: String(process.env.CRM_BOOTSTRAP_EMAIL || "").trim().toLowerCase(),
      employeeCode: process.env.CRM_BOOTSTRAP_CODE || "ADMIN",
      designation: "Administrator",
      department: "Administration",
      roleId: superAdmin.roleId,
      status: "active",
      createdBy: "system-bootstrap",
      updatedBy: "system-bootstrap",
    });
  } catch (error) {
    if (error?.code === 11000) return Employee.findOne({ normalizedMobile: mobile });
    throw error;
  }
}

module.exports = {
  ensureDefaultRoles,
  bootstrapMobile,
  findActiveEmployeeByMobile,
  resolveEmployeeAccess,
  canUseBootstrap,
  createBootstrapEmployee,
};
