"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("CRM exposes provider request pages, API routes and navigation permissions", () => {
  const frontend = read("routes/frontend.js");
  const main = read("routes/main.js");
  const api = read("routes/provider-request.js");
  const sidebar = read("views/partials/sidebar.ejs");
  const permissions = read("utils/permissions.js");
  assert.match(frontend, /\/provider-requests/);
  assert.match(main, /router\.use\("\/provider-requests", require\("\.\/provider-request"\)\)/);
  assert.match(api, /provider_requests\.view/);
  assert.match(api, /provider_requests\.manage/);
  assert.match(api, /providers\.create/);
  assert.match(sidebar, /Provider requests/);
  assert.match(permissions, /provider_requests\.view/);
  assert.match(permissions, /provider_requests\.manage/);
});

test("CRM and Provider share the providerjoinrequests collection contract", () => {
  const model = read("models/ProviderJoinRequest.js");
  const indexes = read("scripts/ensure-indexes.js");
  assert.match(model, /collection:\s*"providerjoinrequests"/);
  assert.match(model, /providerJoinRequestId/);
  assert.match(model, /categoryNameSnapshot/);
  assert.match(model, /convertedProviderId/);
  assert.match(model, /partialFilterExpression: \{ \$or:/);
  assert.doesNotMatch(model, /normalizedMobile:\s*\{[^}]*index:\s*true/);
  assert.match(indexes, /ProviderJoinRequest/);
});

test("provider request list uses standard filters, pagination and responsive CRM tables", () => {
  const view = read("views/provider-request/index.ejs");
  assert.match(view, /crm-filter-bar/);
  assert.match(view, /<span>From<\/span>/);
  assert.match(view, /<span>To<\/span>/);
  assert.match(view, /crm-filter-actions/);
  assert.match(view, /crm-filter-page-size/);
  assert.match(view, /table-responsive/);
  assert.match(view, /crm-table/);
  assert.match(view, /createCursorPagination/);
});

test("manual provider creation is prefilled and converts the request only through the approved endpoint", () => {
  const form = read("views/provider/form.ejs");
  const route = read("routes/provider-request.js");
  const service = read("services/provider-request/provider-request-service.js");
  assert.match(form, /queryValue\("requestId"\)/);
  assert.match(form, /sourceRequest/);
  assert.match(form, /categorySlugs:\s*request\.categorySlug && this\.categories\.some/);
  assert.match(form, /requested category is no longer available/i);
  assert.match(form, /\/convert/);
  assert.match(route, /controller\.convert/);
  assert.match(service, /providerService\.create/);
  assert.match(service, /markConverted/);
  assert.match(service, /status:\s*"converted"/);
});

test("request status transitions reject converted records and require a rejection note", () => {
  const service = read("services/provider-request/provider-request-service.js");
  assert.match(service, /Converted provider requests cannot be changed/);
  assert.match(service, /Rejected provider requests cannot be converted/);
  assert.match(service, /required:\s*status === "rejected"/);
  assert.match(service, /status: \{ \$in: OPEN_STATUSES \}/);
  assert.match(service, /conversionLockAt/);
  assert.match(service, /conversionLockBy/);
  assert.match(service, /CONVERSION_LOCK_TTL_MS/);
  assert.match(service, /\{ mobile: request\.mobile \}/);
  const providerService = read("services/provider/provider-service.js");
  assert.match(providerService, /assertAvailableProviderCategories/);
});
