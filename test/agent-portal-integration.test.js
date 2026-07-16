const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.SKIP_DB = "true";

const Agent = require("../models/Agent");
const Enquiry = require("../models/Enquiry");
const { generateReferralId } = require("../services/agent/agent-service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("agent records use immutable CRM-style UUIDs and six-character referral IDs", () => {
  const referralId = generateReferralId();
  const agent = new Agent({
    referralId,
    name: "Test Agent",
    mobile: "9819595467",
    normalizedMobile: "9819595467",
    categorySlug: "painting",
    categoryName: "Painting",
  });

  assert.match(agent.agentId, /^[a-f0-9]{32}$/);
  assert.match(agent.referralId, /^[A-Z0-9]{6}$/);
  assert.equal(Agent.schema.path("agentId").options.immutable, true);
  assert.equal(Agent.schema.path("referralId").options.immutable, true);
});

test("agent-created requirements keep a denormalized agent snapshot", () => {
  for (const field of [
    "agentId",
    "referralId",
    "agentName",
    "agentBusinessName",
    "agentType",
    "agentMobile",
    "agentCategoryId",
    "customerMobileVerified",
    "customerMobileVerifiedAt",
  ]) {
    assert.ok(Enquiry.schema.path(field), `Missing enquiry field: ${field}`);
  }

  assert.equal(Enquiry.schema.path("agent"), undefined);
});

test("agent services and views do not introduce MongoDB joins or populate", () => {
  const files = [
    "services/agent/agent-service.js",
    "controllers/agentController.js",
    "views/agent/index.ejs",
    "views/agent/form.ejs",
    "views/agent/show.ejs",
  ];
  const content = files.map(source).join("\n");
  assert.doesNotMatch(content, /\.populate\s*\(/);
  assert.doesNotMatch(content, /\$lookup\b/);
  assert.match(source("views/agent/index.ejs"), /apiFetch\(['"]\/api\/agent/);
});

test("CRM exposes minimal agent management routes", () => {
  const apiRoutes = source("routes/main.js");
  const pageRoutes = source("routes/frontend.js");
  assert.match(apiRoutes, /router\.use\("\/agent", require\("\.\/agent"\)\)/);
  assert.match(pageRoutes, /router\.get\("\/agents", \.\.\.protectedPage\("agents\.view"\), page\.agents\)/);
  assert.match(pageRoutes, /router\.get\("\/agents\/:agentId", \.\.\.protectedPage\("agents\.view"\), page\.agentShow\)/);
});
