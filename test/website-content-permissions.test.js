const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLES, hasPermission } = require('../utils/permissions');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('website content permissions are registered and inherited by system admin roles', () => {
  const group = PERMISSION_GROUPS.find((entry) => entry.key === 'websiteContent');
  assert.ok(group, 'Website Content permission group must exist');
  assert.deepEqual(
    group.permissions.map((entry) => entry.key),
    ['websiteContent.view', 'websiteContent.manage', 'websiteContent.publish'],
  );
  for (const permission of ['websiteContent.view', 'websiteContent.manage', 'websiteContent.publish']) {
    assert.ok(ALL_PERMISSIONS.includes(permission));
  }

  const admin = DEFAULT_ROLES.find((role) => role.slug === 'admin');
  const manager = DEFAULT_ROLES.find((role) => role.slug === 'manager');
  const superAdmin = DEFAULT_ROLES.find((role) => role.slug === 'super-admin');
  assert.ok(admin.permissions.includes('websiteContent.view'));
  assert.ok(admin.permissions.includes('websiteContent.manage'));
  assert.ok(admin.permissions.includes('websiteContent.publish'));
  assert.equal(manager.permissions.includes('websiteContent.view'), false);
  assert.deepEqual(superAdmin.permissions, ['*']);
  assert.equal(hasPermission({ permissions: ['*'] }, 'websiteContent.publish'), true);
});

test('website content API and pages use dedicated permissions', () => {
  const apiRoutes = source('routes/website-content.js');
  assert.match(apiRoutes, /GET|router\.get/);
  assert.match(apiRoutes, /requirePermission\("websiteContent\.view"\)/);
  assert.match(apiRoutes, /requirePermission\("websiteContent\.manage"\)/);
  assert.match(apiRoutes, /homepage\/publish", requirePermission\("websiteContent\.publish"\)/);
  assert.doesNotMatch(apiRoutes, /categories\.(?:view|manage)/);

  const frontendRoutes = source('routes/frontend.js');
  for (const route of ['homepage', 'services', 'products', 'media']) {
    assert.match(frontendRoutes, new RegExp(`/website-content/${route}.*websiteContent\\.view`));
  }
});

test('role dependencies and UI visibility are separated by action', () => {
  const roleService = source('services/access/role-service.js');
  assert.match(roleService, /"websiteContent\.manage": \["websiteContent\.view"\]/);
  assert.match(roleService, /"websiteContent\.publish": \["websiteContent\.view"\]/);

  const sidebar = source('views/partials/sidebar.ejs');
  assert.match(sidebar, /showWebsiteContent = canAccess\('websiteContent\.view'\) \|\| canAccess\('categories\.view'\)/);
  assert.match(sidebar, /<span>Website Content<\/span>/);
  assert.match(sidebar, /canAccess\('websiteContent\.view'\).*Homepage/);
  assert.match(sidebar, /canAccess\('categories\.view'\).*Categories/);

  const homepage = source('views/website-content/homepage.ejs');
  assert.match(homepage, /canAccess\('websiteContent\.manage'\)/);
  assert.match(homepage, /canAccess\('websiteContent\.publish'\)/);
  assert.doesNotMatch(homepage, /canAccess\('categories\.manage'\)/);

  assert.match(source('views/website-content/items.ejs'), /canAccess\('websiteContent\.manage'\)/);
  assert.match(source('views/website-content/media.ejs'), /canAccess\('websiteContent\.manage'\)/);
});

test('category-only users do not call protected website media APIs', () => {
  for (const file of ['views/category/index.ejs', 'views/category/service-types.ejs']) {
    const body = source(file);
    assert.match(body, /canViewWebsiteMedia = canAccess\('websiteContent\.view'\)/);
    assert.match(body, /if \(<%= canViewWebsiteMedia \? 'true' : 'false' %>\).*apiFetch\('\/api\/website-content\/media/);
  }
});
