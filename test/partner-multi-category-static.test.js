const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { categorySnapshots, withCategoryCompatibility } = require("../utils/agent-categories");

test("legacy single-category Partner remains compatible", () => {
  const normalized = withCategoryCompatibility({
    categoryId: "cat-painter",
    categorySlug: "painter",
    categoryName: "Painter",
  });
  assert.deepEqual(normalized.categorySlugs, ["painter"]);
  assert.equal(normalized.categories[0].categoryName, "Painter");
  assert.equal(normalized.categorySlug, "painter");
});

test("category snapshots deduplicate and keep the primary Category first", () => {
  const categories = categorySnapshots({
    categorySlug: "plumber",
    categoryName: "Plumber",
    categories: [
      { categorySlug: "painter", categoryName: "Painter" },
      { categorySlug: "plumber", categoryName: "Plumber" },
      { categorySlug: "painter", categoryName: "Duplicate" },
    ],
  });
  assert.deepEqual(categories.map((item) => item.categorySlug), ["plumber", "painter"]);
});

test("Agent schema stores multiple Categories and retains legacy primary fields", () => {
  const source = read("models/Agent.js");
  assert.match(source, /categorySlug:\s*\{[^\n]*required:\s*true/);
  assert.match(source, /categories:\s*\{\s*type:\s*\[categorySnapshotSchema\]/);
  assert.match(source, /categorySlugs:\s*\{\s*type:\s*\[/);
  assert.match(source, /agentSchema\.index\(\{ status: 1, portalAccessEnabled: 1, categorySlugs: 1 \}\)/);
});

test("CRM validates all assigned Categories and supports legacy filtering", () => {
  const source = read("services/agent/agent-service.js");
  assert.match(source, /Category\.find\(\{ slug: \{ \$in: requested \}, active: \{ \$ne: false \} \}\)/);
  assert.match(source, /currentPrimary && requested\.includes\(currentPrimary\)/);
  assert.match(source, /\{ categorySlugs: categorySlug \}, \{ categorySlug \}/);
  assert.match(source, /categorySlugs: categories\.map/);
});

test("CRM Partner form uses Bootstrap Select multi-select", () => {
  const source = read("views/agent/form.ejs");
  assert.match(source, /class="selectpicker[^>]*multiple/);
  assert.match(source, /data-live-search="true"/);
  assert.match(source, /data-actions-box="true"/);
  assert.match(source, /changed\.bs\.select/);
  assert.match(source, /categorySlugs/);
});

test("Bootstrap Select dependencies and self-hosted routes are pinned", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies.bootstrap, "5.3.8");
  assert.equal(pkg.dependencies["bootstrap-select"], "1.14.0-beta3");
  assert.equal(pkg.dependencies.jquery, "3.7.1");
  const app = read("app.js");
  assert.match(app, /\/vendor\/bootstrap/);
  assert.match(app, /\/vendor\/jquery/);
  assert.match(app, /\/vendor\/bootstrap-select/);
  const head = read("views/partials/head.ejs");
  const jqueryIndex = head.indexOf("/vendor/jquery/jquery.min.js");
  const bootstrapIndex = head.indexOf("/vendor/bootstrap/js/bootstrap.bundle.min.js");
  const selectIndex = head.indexOf("/vendor/bootstrap-select/js/bootstrap-select.min.js");
  assert.ok(jqueryIndex >= 0 && bootstrapIndex > jqueryIndex && selectIndex > bootstrapIndex);
});
