const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function allViewFiles() {
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".ejs")) files.push(target);
    }
  }
  walk(path.join(root, "views"));
  return files;
}

test("CRM separates frontend page routes from JSON API routes", () => {
  assert.match(source("app.js"), /require\("\.\/routes\/frontend"\)/);
  assert.match(source("app.js"), /require\("\.\/routes\/main"\)/);
  assert.match(source("app.js"), /app\.use\("\/api"/);
});

test("frontend controller renders titles only and does not import models or services", () => {
  const controller = source("controllers/frontendController.js");
  assert.doesNotMatch(controller, /models\//);
  assert.doesNotMatch(controller, /services\//);
  assert.doesNotMatch(controller, /req\.params|req\.query/);
  assert.match(controller, /res\.render\(view, \{ title \}\)/);
});

test("EJS pages use structural partials only and Alpine calls the API", () => {
  const allowed = new Set(["head", "navbar", "sidebar", "footer", "scripts"]);
  for (const file of allViewFiles()) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/include\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(allowed.has(path.basename(match[1])), `${file} includes a non-structural partial`);
    }
  }
  assert.match(source("views/dashboard/index.ejs"), /apiFetch\(["']\/api\/dashboard/);
  assert.match(source("views/enquiry/index.ejs"), /apiFetch\(["']\/api\/enquiry/);
  assert.match(source("views/provider-unlock/index.ejs"), /apiFetch\(["']\/api\/provider-unlocks/);
});

test("provider unlock page does not depend on an undefined CSP nonce local", () => {
  const view = source("views/provider-unlock/index.ejs");
  assert.doesNotMatch(view, /cspNonce/);
  assert.match(view, /<script>/);
});

test("marketplace architecture has no per-provider visibility collection", () => {
  assert.equal(fs.existsSync(path.join(root, "models/LeadDistribution.js")), false);
  assert.equal(fs.existsSync(path.join(root, "services/distribution")), false);
  assert.equal(fs.existsSync(path.join(root, "views/distribution")), false);
  const unlock = source("models/ProviderLeadUnlock.js");
  assert.match(unlock, /collection:\s*"providerleadunlocks"/);
  assert.match(unlock, /\{ providerId: 1, enquiryId: 1 \}, \{ unique: true \}/);
  assert.doesNotMatch(unlock, /customerMobile|customerEmail|customerAddress/);
});

test("migration preserves existing database IDs and uses bounded cursors", () => {
  const migration = source("scripts/migrate-structure.js");
  assert.match(migration, /filter:\s*\{ _id: row\._id \}/);
  assert.doesNotMatch(migration, /\$set:\s*\{[^}]*\b_id\b/);
  assert.doesNotMatch(migration, /\.toArray\s*\(/);
  assert.match(migration, /bulkWrite/);
});
