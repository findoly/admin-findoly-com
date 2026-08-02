"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("provider creation allows Employee and Provider ownership while preserving other contact conflicts", () => {
  const providerService = read("services/provider/provider-service.js");
  const employeeService = read("services/access/employee-service.js");
  const identityService = read("services/contact-identity/contact-identity-service.js");
  const identityModel = read("models/ContactIdentity.js");

  assert.match(providerService, /allowEmployeeProviderOverlap:\s*true/);
  assert.match(providerService, /A Provider, Agent, or Provider joining request already uses these contact details/);
  assert.match(employeeService, /allowEmployeeProviderOverlap:\s*true/);
  assert.match(identityService, /EMPLOYEE_PROVIDER_TYPES/);
  assert.match(identityService, /canShareEmployeeProviderContact/);
  assert.match(identityService, /sharedOwners/);
  assert.match(identityModel, /sharedOwners/);
  assert.match(identityModel, /unique:\s*true/);
  assert.match(read("scripts/backfill-contact-identities.js"), /canMergeEmployeeProviderOwner/);
});

test("provider requests can be deleted only through the protected management route", () => {
  const route = read("routes/provider-request.js");
  const controller = read("controllers/providerRequestController.js");
  const service = read("services/provider-request/provider-request-service.js");
  const view = read("views/provider-request/show.ejs");

  assert.match(route, /router\.delete\("\/:providerJoinRequestId", requirePermission\("provider_requests\.manage"\), controller\.remove\)/);
  assert.match(controller, /service\.remove/);
  assert.match(service, /Converted provider requests are retained for audit history and cannot be deleted/);
  assert.match(service, /releaseEntityContacts\("provider_join_request"/);
  assert.match(service, /Provider request deletion/);
  assert.match(view, /Delete request/);
  assert.match(view, /Delete permanently/);
  assert.match(view, /method:\s*'DELETE'/);
  assert.match(view, /request\.status !== 'converted'/);
});

test("rejected provider requests expose reopen, conversion and history UI", () => {
  const model = read("models/ProviderJoinRequest.js");
  const service = read("services/provider-request/provider-request-service.js");
  const detail = read("views/provider-request/show.ejs");
  const providerForm = read("views/provider/form.ejs");

  assert.match(model, /statusHistory/);
  assert.match(service, /transitionHistory/);
  assert.match(service, /STATUS_HISTORY_LIMIT/);
  assert.match(detail, /Reopen as contacted/);
  assert.match(detail, /Reopen as new/);
  assert.match(detail, /Status history/);
  assert.match(detail, /request\.status === 'rejected'/);
  assert.match(providerForm, /Reopening a rejected request/);
  assert.match(providerForm, /reopenNote/);
});
