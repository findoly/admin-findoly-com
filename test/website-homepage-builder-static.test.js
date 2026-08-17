"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "services/website-content/website-content-service.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/website-content/homepage.ejs"), "utf8");

test("Homepage manager mirrors current Findoly homepage structure", () => {
  assert.match(service, /DEFAULT_MARKETPLACE_GROUPS/);
  assert.match(service, /id: "home-services", label: "Home"/);
  assert.match(service, /id: "repairs", label: "Repairs"/);
  assert.match(service, /marketplaceGroups/);
  assert.match(service, /contentType.*categories/);
  assert.match(service, /contentType.*promotion/);
  assert.match(view, /Findoly Homepage Manager/);
  assert.match(view, /Homepage navigation tabs/);
  assert.match(view, /Live homepage structure/);
  assert.match(view, /\+ Add homepage section/);
  assert.match(view, /Services \/ Products/);
  assert.match(view, /Promotion \/ CTA/);
  assert.doesNotMatch(view, /Categories in this group/);
});

test("Publishing blocks enabled empty Category and Service Product sections", () => {
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
