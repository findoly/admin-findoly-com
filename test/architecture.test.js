const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { adminCookie } = require("./helpers/auth");

process.env.SKIP_DB = "true";
process.env.AUTH_COOKIE_NAME = "service_crm_admin";

const app = require("../app");
const Enquiry = require("../models/Enquiry");
const Provider = require("../models/Provider");
const LeadDistribution = require("../models/LeadDistribution");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function allViewFiles() {
  const root = path.join(__dirname, "..", "views");
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".ejs")) files.push(target);
    }
  }
  walk(root);
  return files;
}


test("CRM separates frontend page routes from JSON API routes", async () => {
  assert.equal(typeof app, "function");
  assert.ok(require("../routes/frontend"));
  assert.ok(require("../routes/main"));

  const response = await request(app).get("/api/dashboard");
  assert.equal(response.status, 401);
  assert.equal(response.type, "application/json");
  assert.equal(response.body.success, false);
});

test("frontend controller renders titles only and does not import models or services", () => {
  const controller = source("controllers/frontendController.js");
  assert.doesNotMatch(controller, /models\//);
  assert.doesNotMatch(controller, /services\//);
  assert.doesNotMatch(controller, /req\.params|req\.query/);
  assert.match(controller, /res\.render\(view, \{ title \}\)/);
});

test("EJS pages use structural partials only and Alpine calls the API", async () => {
  const allowed = new Set(["head", "navbar", "sidebar", "footer", "scripts"]);
  for (const file of allViewFiles()) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/include\(['"]([^'"]+)['"]\)/g)) {
      const name = path.basename(match[1]);
      assert.ok(
        allowed.has(name),
        `${file} includes non-structural partial ${name}`,
      );
    }
  }

  assert.match(
    source("views/dashboard/index.ejs"),
    /apiFetch\([\"']\/api\/dashboard/,
  );
  assert.match(
    source("views/enquiry/index.ejs"),
    /apiFetch\([\"']\/api\/enquiry/,
  );
  assert.match(
    source("views/provider/index.ejs"),
    /apiFetch\([\"']\/api\/provider/,
  );

  const response = await request(app)
    .get("/enquiries")
    .set("Cookie", [adminCookie()]);
  assert.equal(response.status, 200);
  assert.match(response.text, /\/api\/enquiry/);
});

test("models keep MongoDB _id and add plain 32-character collection IDs", () => {
  const enquiry = new Enquiry({ categorySlug: "painting" });
  const provider = new Provider({ name: "Test Provider" });
  const distribution = new LeadDistribution({
    enquiryId: enquiry.enquiryId,
    providerId: provider.providerId,
    leadPricePaise: 10000,
  });

  for (const value of [
    enquiry.enquiryId,
    provider.providerId,
    distribution.leadDistributionId,
  ]) {
    assert.match(value, /^[a-f0-9]{32}$/);
  }

  assert.ok(enquiry._id);
  assert.equal(Enquiry.schema.path("id"), undefined);
  assert.equal(Provider.schema.path("id"), undefined);
  assert.equal(LeadDistribution.schema.path("id"), undefined);
});

test("migration preserves existing _id and id fields while adding named UUID fields", () => {
  const migration = source("scripts/migrate-structure.js");
  assert.match(migration, /\{ _id: document\._id \}/);
  assert.doesNotMatch(migration, /\$set:\s*\{[^}]*\b_id\b/);
  assert.doesNotMatch(migration, /\$set:\s*\{[^}]*\bid\s*:/);
  assert.match(migration, /isUuid32/);
});
