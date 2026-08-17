"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "services/website-content/website-content-service.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/website-content/homepage.ejs"), "utf8");

test("Homepage manager maps to the fixed sections used by the current Findoly homepage", () => {
  for (const key of ["popular", "featuredCategories", "homeCare", "repairs", "events"]) assert.match(view, new RegExp(key));
  assert.match(view, /Popular near you/);
  assert.match(view, /What do you need help with\?/);
  assert.match(view, /For your home/);
  assert.match(view, /Home repairs/);
  assert.match(view, /Events & occasions/);
  assert.match(view, /sectionOrder/);
});

test("Generic homepage builder controls are removed from the Admin UI", () => {
  assert.doesNotMatch(view, /Homepage navigation tabs/);
  assert.doesNotMatch(view, /\+ Add homepage section/);
  assert.doesNotMatch(view, /Promotion \/ CTA/);
  assert.doesNotMatch(view, /Stable tab ID/);
});

test("Fixed editor preserves compatibility with the existing generic homepage API", () => {
  assert.match(service, /sections,/);
  assert.match(view, /const old=\(this\.draft\.sections\|\|\[\]\)\.find/);
  assert.match(view, /directCount===0&&oldCount>0/);
  assert.match(view, /clone\.sections=clone\.sectionOrder\.map/);
  assert.match(view, /featured-categories/);
  assert.match(view, /home-services/);
});

test("Publishing still blocks enabled empty Category and Service Product sections", () => {
  assert.match(service, /is enabled but has no Categories/);
  assert.match(service, /is enabled but has no Services or Products/);
  assert.match(service, /validateHomepageSelections\(draft, \{ forPublish: true \}\)/);
});

test("Homepage catalog selector supports large imported catalogs", () => {
  assert.match(service, /limit\(5000\)/);
  assert.match(view, /Search name, category or subcategory/);
  assert.match(view, /_categoryFilter/);
  assert.match(view, /_kindFilter/);
});
