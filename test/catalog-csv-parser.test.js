"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const relative of [
  "models/Category.js",
  "models/ServiceType.js",
  "models/WebsiteCatalogItem.js",
  "services/catalog/catalog-service.js",
  "services/website-content/website-content-service.js",
  "services/storage/s3-service.js",
]) {
  const resolved = path.join(root, relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: {} };
}

const importer = require("../services/website-content/catalog-import-service");

test("catalog import ID is readable IST date/time with uniqueness suffix", () => {
  const id = importer.generateImportId(new Date("2026-08-15T16:29:30.847Z"));
  assert.match(id, /^CATALOG-20260815-215930-847-[A-F0-9]{4}$/);
});

test("CSV parser handles quoted commas and the provided template", () => {
  const csv = importer.templateCsv();
  const parsed = importer.parseCsvBuffer(Buffer.from(csv, "utf8"));
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].raw.action, "CREATE");
  assert.equal(parsed.records[0].raw.type, "service");
  assert.match(parsed.records[0].raw.description, /wooden door repair, alignment/);
});

test("CSV parser handles quoted newlines without splitting the logical row", () => {
  const csv = 'action,type,category,subcategory,name,description\nCREATE,service,Carpenter,Door Carpenter,Door Repair,"Line one\nLine two"\n';
  const parsed = importer.parseCsvBuffer(Buffer.from(csv));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].raw.description, "Line one\nLine two");
});

test("row normalization accepts CREATE/UPDATE and rejects DELETE", () => {
  const create = importer.normalizeRow({ rowNumber: 2, raw: {
    action: "create", type: "service", category: "Carpenter", subcategory: "Door Carpenter", name: "Door Repair",
  } });
  assert.equal(create.action, "CREATE");
  assert.equal(create.kind, "service");
  assert.equal(create.category.slug, "carpenter");
  assert.equal(create.subcategory.slug, "door-carpenter");
  assert.equal(create.item.slug, "door-repair");

  const update = importer.normalizeRow({ rowNumber: 3, raw: {
    action: "UPDATE", type: "product", category: "Carpenter", subcategory: "Modular Kitchen", name: "Cabinet", slug: "cabinet",
  } });
  assert.equal(update.action, "UPDATE");
  assert.equal(update.kind, "product");

  assert.throws(() => importer.normalizeRow({ rowNumber: 4, raw: {
    action: "DELETE", type: "service", category: "Carpenter", subcategory: "Door Carpenter", name: "Door Repair",
  } }), /action must be CREATE or UPDATE/);
});
