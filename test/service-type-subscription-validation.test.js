const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { assertHumanText } = require("../utils/validation");
const { normalizeServiceTypeIdentifiers } = require("../utils/service-types");
const { applyDateRange, dateSort } = require("../utils/date-query");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("lead Service Type selection is mandatory, unique and limited to five", () => {
  assert.throws(() => normalizeServiceTypeIdentifiers([]), /at least one Service Type/);
  assert.throws(() => normalizeServiceTypeIdentifiers(["1", "2", "3", "4", "5", "6"]), /no more than 5/);
  assert.deepEqual(normalizeServiceTypeIdentifiers(["one", "one", { serviceTypeId: "two" }]), ["one", "two"]);
});

test("lead human text rejects emoji and HTML on the backend", () => {
  assert.throws(() => assertHumanText("Painting needed 😀", { label: "Requirement title" }), /must not contain emoji/);
  assert.throws(() => assertHumanText("<b>Painting</b>", { label: "Requirement title" }), /must not contain HTML/);
  assert.throws(() => assertHumanText("&lt;script&gt;", { label: "Requirement title" }), /must not contain HTML/);
  assert.doesNotThrow(() => assertHumanText("Interior painting for a 2 BHK flat", { label: "Requirement title" }));
});

test("date filters reject reversed ranges and produce stable date sorting", () => {
  assert.throws(() => applyDateRange({}, { startDate: "2026-07-25", endDate: "2026-07-24" }), /cannot be before/);
  assert.deepEqual(dateSort({ sortOrder: "oldest" }, { fields: ["createdAt"] }), { createdAt: 1, _id: 1 });
  assert.deepEqual(dateSort({ sortOrder: "newest" }, { fields: ["createdAt"] }), { createdAt: -1, _id: -1 });
});

test("CRM routes and views expose Service Types and provider subscriptions", () => {
  assert.match(source("routes/catalog.js"), /service-types/);
  assert.match(source("views/enquiry/form.ejs"), /Service Types <span class="text-danger">\*<\/span>/);
  assert.match(source("services/enquiry/enquiry-service.js"), /resolveLeadServiceTypes/);
  assert.match(source("services/catalog/catalog-service.js"), /Select an active Category before choosing Service Types/);
  assert.match(source("views/enquiry/form.ejs"), /toggleServiceType/);
  assert.doesNotMatch(source("views/enquiry/form.ejs"), /Hold Ctrl\/Cmd/);
  assert.match(source("routes/main.js"), /provider-subscription/);
  assert.match(source("views/billing/provider-subscriptions.ejs"), /Provider subscriptions/i);
  assert.match(source("views/partials/sidebar.ejs"), /Provider subscriptions/);
});

test("provider subscription records remain read-only in CRM", () => {
  const routes = source("routes/provider-subscription.js");
  assert.match(routes, /router\.get/);
  assert.doesNotMatch(routes, /router\.(post|put|patch|delete)/);
});
