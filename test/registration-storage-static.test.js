const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("registration events and recipients are available in Communication Center", () => {
  const rules = source("services/communication/notification-service.js");
  const model = source("models/CommunicationRule.js");
  const view = source("views/communication/rules.ejs");
  for (const event of ["provider_created", "agent_created", "employee_created"]) {
    assert.match(rules, new RegExp(event));
    assert.match(view, new RegExp(event));
  }
  assert.match(model, /"employee"/);
  assert.match(view, /value="employee"/);
});

test("account create services dispatch registration events after creation", () => {
  assert.match(source("services/provider/provider-service.js"), /dispatch\(\s*"provider_created"/);
  assert.match(source("services/agent/agent-service.js"), /dispatch\(\s*"agent_created"/);
  assert.match(source("services/access/employee-service.js"), /dispatch\(\s*"employee_created"/);
  assert.match(source("services/communication/account-registration-service.js"), /catch \(error\)/);
});

test("S3 paths stay inside approved public and private prefixes", () => {
  process.env.AWS_S3_PUBLIC_PREFIX = "public/";
  process.env.AWS_S3_PRIVATE_PREFIX = "private/";
  const storage = require("../services/storage/s3-service");
  assert.equal(storage.normalizePrefix("public/website"), "public/website/");
  assert.equal(storage.objectKey("private/reports/", "monthly.pdf"), "private/reports/monthly.pdf");
  assert.throws(() => storage.normalizePrefix("other/"), /outside the approved/);
  assert.throws(() => storage.normalizePrefix("public/../private/"), /invalid/);
  assert.throws(() => storage.safeName("../secret.pdf", "File name"), /unsupported/);
});

test("storage routes enforce separate view and manage permissions", () => {
  const routes = source("routes/storage.js");
  assert.match(routes, /storage\.view/);
  assert.match(routes, /storage\.manage/);
  assert.match(source("utils/permissions.js"), /storage\.manage/);
  assert.match(source("services/access/role-service.js"), /"storage\.manage": \["storage\.view"\]/);
});
