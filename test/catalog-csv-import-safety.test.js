"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("CSV import is exposed only inside Website Content permissions", () => {
  const frontend = read("routes/frontend.js");
  const api = read("routes/website-content.js");
  const sidebar = read("views/partials/sidebar.ejs");

  assert.match(frontend, /\/website-content\/csv-import.*websiteContent\.view/);
  assert.match(sidebar, /href="\/website-content\/csv-import"[\s\S]{0,180}>CSV Import</);
  assert.match(api, /catalog-import\/template.*websiteContent\.view/);
  assert.match(api, /catalog-import\/history.*websiteContent\.view/);
  assert.match(api, /catalog-import\/preview.*websiteContent\.manage[\s\S]{0,120}categories\.manage/);
  assert.match(api, /catalog-import\/prepare.*websiteContent\.manage[\s\S]{0,120}categories\.manage/);
  assert.match(api, /catalog-import\/:importId\/execute.*websiteContent\.manage[\s\S]{0,120}categories\.manage/);
});

test("CSV contract supports CREATE and UPDATE only for Service/Product rows", () => {
  const service = read("services/website-content/catalog-import-service.js");
  assert.match(service, /\['CREATE', 'UPDATE'\]\.includes\(action\)/);
  assert.match(service, /\['service', 'product'\]\.includes\(kind\)/);
  assert.match(service, /UPDATE requires an existing Category/);
  assert.match(service, /UPDATE requires an existing Subcategory/);
  assert.match(service, /UPDATE cannot move a Service\/Product/);
  assert.doesNotMatch(service, /action[^\n]{0,60}DELETE/);
});

test("pre-import S3 snapshot is mandatory and contains all catalog domains", () => {
  const service = read("services/website-content/catalog-import-service.js");
  assert.match(service, /privatePrefix}website-content\/catalog-imports/);
  assert.match(service, /pre-import-backup\/categories\.json/);
  assert.match(service, /pre-import-backup\/subcategories\.json/);
  assert.match(service, /pre-import-backup\/services\.json/);
  assert.match(service, /pre-import-backup\/products\.json/);
  assert.match(service, /original\.csv/);
  assert.match(service, /preview\.json/);
  assert.match(service, /backup-metadata\.json/);
  assert.match(service, /status: "BACKUP_IN_PROGRESS"/);
  assert.match(service, /status: "BACKUP_COMPLETED"/);
  assert.match(service, /snapshotHashes: snapshotHashes\(snapshot\)/);
  assert.match(service, /assertCatalogMatchesBackup\(metadata\)/);
  assert.match(service, /storage\.exists\(key\)/);
  assert.match(service, /Catalog backup could not be verified\. No changes were made\./);
  assert.match(service, /Catalog changed after the S3 backup was created/);
  assert.match(service, /result\.json/);
  assert.match(service, /import-started\.json/);
  assert.match(service, /already started and cannot be executed again/);
});

test("import IDs use readable India date/time plus milliseconds and random suffix", () => {
  const service = read("services/website-content/catalog-import-service.js");
  assert.match(service, /CATALOG-\\d\{8\}-\\d\{6\}-\\d\{3\}-\[A-F0-9\]\{4\}/);
  assert.match(service, /timeZone: "Asia\/Kolkata"/);
  assert.match(service, /datePart = `\$\{parts\.year}\$\{parts\.month}\$\{parts\.day}`/);
  assert.match(service, /timePart = `\$\{parts\.hour}\$\{parts\.minute}\$\{parts\.second}`/);
  assert.match(service, /crypto\.randomBytes\(2\)/);
});

test("UI cannot execute import before verified backup", () => {
  const view = read("views/website-content/csv-import.ejs");
  assert.match(view, /Upload & validate/);
  assert.match(view, /Create & verify S3 backup/);
  assert.match(view, /:disabled="!prepared \|\| busy \|\| imported"/);
  assert.match(view, /Pre-import catalog backup was created and verified in S3\. Import is now unlocked\./);
  assert.match(view, /Import catalog/);
});

test("Categories cannot be deleted and Subcategories are empty-only deletes", () => {
  const routes = read("routes/catalog.js");
  const service = read("services/catalog/catalog-service.js");
  const categoryView = read("views/category/index.ejs");
  const subcategoryView = read("views/category/service-types.ejs");

  assert.match(routes, /router\.delete\("\/categories\/:categoryId"[\s\S]{0,120}rejectCategoryDelete/);
  assert.match(service, /Categories cannot be deleted\. You can edit or deactivate a Category instead\./);
  assert.doesNotMatch(categoryView, /deleteCategory\(/);
  assert.match(service, /Cannot delete this subcategory\. Delete all Services and Products under it first\./);
  assert.match(service, /if \(usage\.serviceCount \|\| usage\.productCount\)/);
  assert.match(subcategoryView, /Delete Services\/Products first/);
  assert.match(subcategoryView, /:disabled="Number\(item\.serviceCount \|\| 0\) > 0 \|\| Number\(item\.productCount \|\| 0\) > 0"/);
});

test("Services and Products have explicit manual delete controls", () => {
  const routes = read("routes/website-content.js");
  const service = read("services/website-content/website-content-service.js");
  const view = read("views/website-content/items.ejs");

  assert.match(routes, /router\.delete\("\/items\/:itemId"[\s\S]{0,120}websiteContent\.manage/);
  assert.match(service, /async function deleteItem\(itemId\)/);
  assert.match(view, /@click="removeItem\(item\)"/);
});
