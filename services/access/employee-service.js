const Employee = require("../../models/Employee");
const Role = require("../../models/Role");
const { validateMobile } = require("../../utils/mobile");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  textValue,
  emailValue,
  enumValue,
  identifierValue,
  queryTextValue,
  validationError,
} = require("../../utils/validation");
const { ensureDefaultRoles } = require("./access-service");
const accountRegistrationService = require("../communication/account-registration-service");

const STATUSES = Object.freeze(["active", "inactive", "suspended"]);

function employeeMobile(value) {
  const mobile = validateMobile(value, { label: "Employee mobile number" });
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    throw validationError("Employee mobile number must be a valid Indian mobile number");
  }
  return mobile;
}

function actorValue(actor) {
  return actor?.employeeId || actor?.mobile || actor?.name || "crm-admin";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function activeRole(roleId) {
  const value = identifierValue(roleId, { label: "Role" });
  const role = await Role.findOne({ roleId: value, active: true }).lean();
  if (!role) throw validationError("Select an active role");
  return role;
}

function presentEmployee(employee = {}, role) {
  return {
    ...employee,
    employeeId: employee.employeeId || "",
    roleName: role?.name || "Unassigned",
    roleActive: Boolean(role?.active),
  };
}

async function list(filters = {}) {
  await ensureDefaultRoles();
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) {
    query.status = enumValue(filters.status, STATUSES, { label: "Employee status" });
  }
  if (filters.roleId) query.roleId = identifierValue(filters.roleId, { label: "Role" });
  const q = queryTextValue(filters.q, { label: "Employee search", maxLength: 100 });
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { employeeId: search },
      { employeeCode: search },
      { name: search },
      { mobile: search },
      { email: search },
      { designation: search },
      { department: search },
    ];
  }
  applyDateRange(query, filters, { fields: { createdAt: "Created date", updatedAt: "Updated date", lastLoginAt: "Last login" } });
  const result = await cursorPaginate(Employee, {
    query,
    sort: dateSort(filters, { fields: ["createdAt", "updatedAt", "lastLoginAt"] }),
    limit,
    cursor,
  });
  const roleIds = [...new Set(result.data.map((row) => row.roleId).filter(Boolean))];
  const roles = await Role.find({ roleId: { $in: roleIds } }).lean();
  const roleMap = new Map(roles.map((role) => [role.roleId, role]));
  return {
    ...result,
    data: result.data.map((employee) => presentEmployee(employee, roleMap.get(employee.roleId))),
  };
}

async function get(employeeId) {
  const value = identifierValue(employeeId, { label: "Employee ID" });
  const employee = await Employee.findOne({ employeeId: value }).lean();
  if (!employee) throw Object.assign(new Error("Employee not found"), { status: 404 });
  const role = await Role.findOne({ roleId: employee.roleId }).lean();
  return presentEmployee(employee, role);
}

async function create(input = {}, actor) {
  await ensureDefaultRoles();
  const mobile = employeeMobile(input.mobile);
  const role = await activeRole(input.roleId);
  let employee;
  try {
    employee = await Employee.create({
      name: textValue(input.name, { label: "Employee name", required: true, maxLength: 120 }),
      mobile,
      normalizedMobile: mobile,
      email: emailValue(input.email, { label: "Employee email", required: false }),
      employeeCode: textValue(input.employeeCode, { label: "Employee code", maxLength: 40 }).toUpperCase(),
      designation: textValue(input.designation, { label: "Designation", maxLength: 120 }),
      department: textValue(input.department, { label: "Department", maxLength: 120 }),
      roleId: role.roleId,
      status: enumValue(input.status, STATUSES, { label: "Employee status", fallback: "active" }),
      notes: textValue(input.notes, { label: "Employee notes", maxLength: 5000 }),
      createdBy: actorValue(actor),
      updatedBy: actorValue(actor),
    });
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.normalizedMobile || error?.keyPattern?.mobile)) {
      throw Object.assign(new Error("An employee already uses this mobile number"), { status: 409 });
    }
    throw error;
  }
  const created = presentEmployee(employee.toObject(), role);
  await accountRegistrationService.dispatch(
    "employee_created",
    { employee: created, registrationDate: created.createdAt, idempotencySuffix: created.createdAt },
    actorValue(actor),
  );
  return created;
}

async function update(employeeId, input = {}, actor) {
  const current = await get(employeeId);
  if (input.employeeId !== undefined && String(input.employeeId) !== current.employeeId) {
    throw validationError("Employee ID cannot be changed");
  }
  const nextStatus = enumValue(input.status, STATUSES, {
    label: "Employee status",
    fallback: current.status,
  });
  const nextRole = await activeRole(input.roleId ?? current.roleId);
  if (current.employeeId === actor?.employeeId) {
    if (nextStatus !== "active") throw validationError("You cannot deactivate your own employee account");
    if (nextRole.roleId !== current.roleId) throw validationError("You cannot change your own role");
  }
  const mobile = employeeMobile(input.mobile ?? current.mobile);
  let updated;
  try {
    updated = await Employee.findOneAndUpdate(
      { employeeId: current.employeeId },
      {
        $set: {
          name: textValue(input.name ?? current.name, { label: "Employee name", required: true, maxLength: 120 }),
          mobile,
          normalizedMobile: mobile,
          email: emailValue(input.email ?? current.email, { label: "Employee email", required: false }),
          employeeCode: textValue(input.employeeCode ?? current.employeeCode, { label: "Employee code", maxLength: 40 }).toUpperCase(),
          designation: textValue(input.designation ?? current.designation, { label: "Designation", maxLength: 120 }),
          department: textValue(input.department ?? current.department, { label: "Department", maxLength: 120 }),
          roleId: nextRole.roleId,
          status: nextStatus,
          notes: textValue(input.notes ?? current.notes, { label: "Employee notes", maxLength: 5000 }),
          updatedBy: actorValue(actor),
        },
      },
      { new: true, runValidators: true },
    ).lean();
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.normalizedMobile || error?.keyPattern?.mobile)) {
      throw Object.assign(new Error("An employee already uses this mobile number"), { status: 409 });
    }
    throw error;
  }
  return presentEmployee(updated, nextRole);
}

async function metadata() {
  await ensureDefaultRoles();
  const roles = await Role.find({ active: true }).sort({ isSuperAdmin: -1, name: 1 }).lean();
  return { roles: roles.map((role) => ({ roleId: role.roleId, name: role.name, description: role.description })) };
}

module.exports = { list, get, create, update, metadata, STATUSES };
