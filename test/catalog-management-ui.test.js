"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Catalog has separate permission-protected Category and Subcategory pages", () => {
  const routes = read("routes/frontend.js");
  const controller = read("controllers/frontendController.js");

  assert.match(routes, /router\.get\("\/categories", \.\.\.protectedPage\("categories\.view"\), page\.categories\)/);
  assert.match(routes, /router\.get\("\/service-types", \.\.\.protectedPage\("categories\.view"\), page\.serviceTypes\)/);
  assert.match(controller, /categories: render\("category\/index", "Categories"\)/);
  assert.match(controller, /serviceTypes: render\("category\/service-types", "Subcategories"\)/);
});

test("Website Content sidebar is expandable and keeps Category/Subcategory navigation", () => {
  const sidebar = read("views/partials/sidebar.ejs");
  const scripts = read("views/partials/scripts.ejs");

  assert.match(sidebar, /aria-controls="catalogSubmenu"/);
  assert.match(sidebar, />Website Content<\/span>/);
  assert.match(sidebar, /href="\/categories"[\s\S]{0,220}>Categories<\/span>/);
  assert.match(sidebar, /href="\/service-types"[\s\S]{0,220}>Subcategories<\/span>/);
  assert.match(sidebar, /pathIs\('\/categories'\) \|\| pathIs\('\/service-types'\) \|\| pathIs\('\/website-content'\)/);
  assert.match(sidebar, /:aria-current="pathIs\('\/categories'\) \? 'page' : null"/);
  assert.match(sidebar, /:aria-current="pathIs\('\/service-types'\) \? 'page' : null"/);
  assert.match(scripts, /catalogMenuOpen:[^\n]+\/service-types/);
});

test("Category page manages only Categories and links to Subcategories", () => {
  const view = read("views/category/index.ejs");

  assert.match(view, /Catalog \/ Categories/);
  assert.match(view, /Create category/);
  assert.match(view, /Manage subcategories/);
  assert.match(view, /Search name, slug, or description/);
  assert.match(view, /All statuses/);
  assert.match(view, /Rows/);
  assert.match(view, /\/service-types\?categorySlug=/);
  assert.doesNotMatch(view, /saveServiceType\(/);
});

test("Subcategory page provides guided Category selection and independent filtering", () => {
  const view = read("views/category/service-types.ejs");

  assert.match(view, /Catalog \/ Subcategories/);
  assert.match(view, /Parent Category/);
  assert.match(view, /Add subcategory/);
  assert.match(view, /Display order/);
  assert.match(view, /All Categories/);
  assert.match(view, /Search Subcategories/);
  assert.match(view, /\/api\/catalog\/service-types\?/);
  assert.match(view, /'\/api\/catalog\/categories\/' \+ encodeURIComponent\(selectedCategoryId\) \+ '\/service-types'/);
  assert.match(view, /Subcategories are stored as Service Types/);
});

test("Catalog service supports status and friendly sort filters without changing API routes", () => {
  const service = read("services/catalog/catalog-service.js");
  const routes = read("routes/catalog.js");

  assert.match(service, /activeFilter === "true"/);
  assert.match(service, /activeFilter === "false"/);
  assert.match(service, /name_asc: \{ name: 1, _id: 1 \}/);
  assert.match(service, /order_asc: \{ displayOrder: 1, name: 1, _id: 1 \}/);
  assert.match(routes, /router\.get\("\/service-types"/);
  assert.match(routes, /router\.post\("\/categories\/:categoryId\/service-types"/);
});

test("duplicate contact errors describe every possible account owner", () => {
  const service = read("services/contact-identity/contact-identity-service.js");

  assert.match(service, /existing Employee, Agent, Provider, or Provider joining request/);
  assert.doesNotMatch(service, /assigned to an existing \$\{entity\}/);
  assert.match(service, /CONTACT_ALREADY_EXISTS/);
  assert.match(service, /entityType: conflict\.entityType/);
});

test("Catalog guidance is responsive and keeps the existing Findoly shell", () => {
  const css = read("public/css/app.css");

  assert.match(css, /Catalog management — separate Category and Subcategory workspace/);
  assert.match(css, /\.crm-catalog-definition-grid/);
  assert.match(css, /@media \(max-width: 767\.98px\)[\s\S]*\.crm-catalog-definition-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.crm-catalog-form-card \{[\s\S]*position: sticky/);
});
