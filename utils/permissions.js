const PERMISSION_GROUPS = Object.freeze([
  {
    key: "dashboard",
    label: "Dashboard",
    permissions: [{ key: "dashboard.view", label: "View dashboard" }],
  },
  {
    key: "requirements",
    label: "Requirements",
    permissions: [
      { key: "requirements.view", label: "View requirements" },
      { key: "requirements.create", label: "Create requirements" },
      { key: "requirements.edit", label: "Edit requirements" },
      { key: "requirements.manage", label: "Change status, notes and distribution" },
    ],
  },
  {
    key: "providers",
    label: "Providers",
    permissions: [
      { key: "providers.view", label: "View providers" },
      { key: "providers.create", label: "Create providers" },
      { key: "providers.edit", label: "Edit and sync providers" },
      { key: "provider_credits.add", label: "Add provider credits" },
    ],
  },
  {
    key: "agents",
    label: "Agents",
    permissions: [
      { key: "agents.view", label: "View agents" },
      { key: "agents.create", label: "Create agents" },
      { key: "agents.edit", label: "Edit agents" },
    ],
  },
  {
    key: "partnerPayouts",
    label: "Partner payouts",
    permissions: [
      { key: "partnerPayouts.view", label: "View payouts" },
      { key: "partnerPayouts.manage", label: "Approve and process payouts" },
    ],
  },
  {
    key: "categories",
    label: "Categories",
    permissions: [
      { key: "categories.view", label: "View categories" },
      { key: "categories.manage", label: "Create and edit categories" },
    ],
  },
  {
    key: "distributions",
    label: "Distribution",
    permissions: [{ key: "distributions.view", label: "View lead distribution" }],
  },
  {
    key: "followUps",
    label: "Follow-ups",
    permissions: [
      { key: "followUps.view", label: "View follow-ups" },
      { key: "followUps.create", label: "Create follow-ups" },
      { key: "followUps.edit", label: "Edit follow-ups" },
    ],
  },
  {
    key: "communications",
    label: "Communication Center",
    permissions: [
      { key: "communications.view", label: "View communication records" },
      { key: "communications.send", label: "Send messages" },
      { key: "communications.manage", label: "Manage templates, rules and settings" },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    permissions: [
      { key: "billing.view", label: "View invoices" },
      { key: "billing.create", label: "Create invoices" },
      { key: "billing.edit", label: "Edit invoices" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    permissions: [{ key: "reports.view", label: "View reports" }],
  },
  {
    key: "storage",
    label: "File Manager",
    permissions: [
      { key: "storage.view", label: "Browse and download S3 files" },
      { key: "storage.manage", label: "Upload, replace and create S3 folders" },
    ],
  },
  {
    key: "employees",
    label: "Employees",
    permissions: [
      { key: "employees.view", label: "View employees" },
      { key: "employees.create", label: "Create employees" },
      { key: "employees.edit", label: "Edit and activate employees" },
    ],
  },
  {
    key: "roles",
    label: "Roles and permissions",
    permissions: [
      { key: "roles.view", label: "View roles" },
      { key: "roles.create", label: "Create roles" },
      { key: "roles.edit", label: "Edit roles and permissions" },
    ],
  },
]);

const ALL_PERMISSIONS = Object.freeze(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key)),
);

const DEFAULT_ROLES = Object.freeze([
  {
    name: "Super Admin",
    slug: "super-admin",
    description: "Complete CRM access, including employee and role management.",
    permissions: ["*"],
    isSuperAdmin: true,
  },
  {
    name: "Admin",
    slug: "admin",
    description: "Full operational access with employee and role management.",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    name: "Manager",
    slug: "manager",
    description: "Operational oversight, reporting and team visibility.",
    permissions: [
      "dashboard.view",
      "requirements.view",
      "requirements.create",
      "requirements.edit",
      "requirements.manage",
      "providers.view",
      "providers.edit",
      "agents.view",
      "partnerPayouts.view",
      "categories.view",
      "distributions.view",
      "followUps.view",
      "followUps.create",
      "followUps.edit",
      "communications.view",
      "communications.send",
      "billing.view",
      "reports.view",
      "employees.view",
      "roles.view",
    ],
  },
  {
    name: "Sales Executive",
    slug: "sales-executive",
    description: "Lead handling, follow-ups and customer communication.",
    permissions: [
      "dashboard.view",
      "requirements.view",
      "requirements.create",
      "requirements.edit",
      "requirements.manage",
      "providers.view",
      "followUps.view",
      "followUps.create",
      "followUps.edit",
      "communications.view",
      "communications.send",
    ],
  },
  {
    name: "Support Executive",
    slug: "support-executive",
    description: "Customer support, follow-ups and communication access.",
    permissions: [
      "dashboard.view",
      "requirements.view",
      "requirements.edit",
      "providers.view",
      "agents.view",
      "followUps.view",
      "followUps.create",
      "followUps.edit",
      "communications.view",
      "communications.send",
    ],
  },
]);

function isKnownPermission(value) {
  return value === "*" || ALL_PERMISSIONS.includes(value);
}

function hasPermission(user, permission) {
  if (!user || !permission) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes("*") || permissions.includes(permission);
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  isKnownPermission,
  hasPermission,
};
