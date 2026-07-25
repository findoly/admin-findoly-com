const Role = require("../../models/Role");
const Employee = require("../../models/Employee");
const {
  textValue,
  booleanValue,
  stringArrayValue,
  identifierValue,
  validationError,
} = require("../../utils/validation");
const {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  isKnownPermission,
} = require("../../utils/permissions");
const { ensureDefaultRoles } = require("./access-service");

function actorValue(actor) {
  return actor?.employeeId || actor?.mobile || actor?.name || "crm-admin";
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw validationError("Role name must contain letters or numbers");
  return slug;
}

function normalizePermissions(value, current = []) {
  const selected = stringArrayValue(value, {
    label: "Permissions",
    fallback: current,
    maxItems: ALL_PERMISSIONS.length + 1,
    itemMaxLength: 80,
    itemValidator: (permission) => {
      if (!isKnownPermission(permission)) throw validationError(`Unknown permission: ${permission}`);
      return permission;
    },
  });
  if (selected.includes("*")) return ["*"];
  const implied = {
    "requirements.create": ["requirements.view"],
    "requirements.edit": ["requirements.view"],
    "requirements.manage": ["requirements.view"],
    "providers.create": ["providers.view", "categories.view"],
    "providers.edit": ["providers.view", "categories.view"],
    "provider_credits.add": ["providers.view"],
    "agents.create": ["agents.view", "categories.view"],
    "agents.edit": ["agents.view", "categories.view"],
    "partnerPayouts.manage": ["partnerPayouts.view"],
    "categories.manage": ["categories.view"],
    "followUps.create": ["followUps.view"],
    "followUps.edit": ["followUps.view"],
    "communications.send": ["communications.view"],
    "communications.manage": ["communications.view"],
    "storage.manage": ["storage.view"],
    "billing.create": ["billing.view"],
    "billing.edit": ["billing.view"],
    "employees.create": ["employees.view"],
    "employees.edit": ["employees.view"],
    "roles.create": ["roles.view"],
    "roles.edit": ["roles.view"],
  };
  const expanded = new Set(selected);
  selected.forEach((permission) => (implied[permission] || []).forEach((dependency) => expanded.add(dependency)));
  return [...expanded];
}

function presentRole(role = {}, employeeCount = 0) {
  return {
    ...role,
    roleId: role.roleId || "",
    employeeCount,
  };
}

async function list() {
  await ensureDefaultRoles();
  const roles = await Role.find({}).sort({ isSuperAdmin: -1, isSystem: -1, name: 1 }).lean();
  const counts = await Employee.aggregate([
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((row) => [row._id, row.count]));
  return roles.map((role) => presentRole(role, countMap.get(role.roleId) || 0));
}

async function get(roleId) {
  await ensureDefaultRoles();
  const value = identifierValue(roleId, { label: "Role ID" });
  const role = await Role.findOne({ roleId: value }).lean();
  if (!role) throw Object.assign(new Error("Role not found"), { status: 404 });
  const employeeCount = await Employee.countDocuments({ roleId: role.roleId });
  return presentRole(role, employeeCount);
}

async function create(input = {}, actor) {
  const name = textValue(input.name, { label: "Role name", required: true, maxLength: 120 });
  const permissions = normalizePermissions(input.permissions, []);
  if (!permissions.length) throw validationError("Select at least one permission");
  let role;
  try {
    role = await Role.create({
      name,
      slug: slugify(input.slug || name),
      description: textValue(input.description, { label: "Role description", maxLength: 1000 }),
      permissions,
      active: booleanValue(input.active, { label: "Role active status", fallback: true }),
      isSystem: false,
      isSuperAdmin: false,
      createdBy: actorValue(actor),
      updatedBy: actorValue(actor),
    });
  } catch (error) {
    if (error?.code === 11000) throw Object.assign(new Error("A role with this name or slug already exists"), { status: 409 });
    throw error;
  }
  return presentRole(role.toObject(), 0);
}

async function update(roleId, input = {}, actor) {
  const current = await get(roleId);
  if (current.isSuperAdmin) {
    if (input.permissions !== undefined || input.active === false || String(input.active).toLowerCase() === "false") {
      throw Object.assign(new Error("The Super Admin role permissions and active status cannot be changed"), { status: 400 });
    }
  }
  const name = textValue(input.name ?? current.name, { label: "Role name", required: true, maxLength: 120 });
  const permissions = current.isSuperAdmin ? ["*"] : normalizePermissions(input.permissions, current.permissions);
  if (!permissions.length) throw validationError("Select at least one permission");
  const active = current.isSuperAdmin
    ? true
    : booleanValue(input.active, { label: "Role active status", fallback: current.active !== false });
  if (!active && current.employeeCount > 0) {
    throw Object.assign(new Error("Move employees to another role before deactivating this role"), { status: 409 });
  }
  let updated;
  try {
    updated = await Role.findOneAndUpdate(
      { roleId: current.roleId },
      {
        $set: {
          name,
          slug: current.isSystem ? current.slug : slugify(input.slug || name),
          description: textValue(input.description ?? current.description, { label: "Role description", maxLength: 1000 }),
          permissions,
          active,
          updatedBy: actorValue(actor),
        },
      },
      { new: true, runValidators: true },
    ).lean();
  } catch (error) {
    if (error?.code === 11000) throw Object.assign(new Error("A role with this name or slug already exists"), { status: 409 });
    throw error;
  }
  return presentRole(updated, current.employeeCount);
}

function metadata() {
  return { groups: PERMISSION_GROUPS, allPermissions: ALL_PERMISSIONS };
}

module.exports = { list, get, create, update, metadata, slugify, normalizePermissions };
