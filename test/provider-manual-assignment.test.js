"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function compileManualAssignmentHelpers() {
  const filename = path.join(root, "services/provider-unlock/provider-manual-assignment-service.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));

  const mocks = {
    "../../models/Enquiry": {},
    "../../models/Provider": {},
    "../../models/ProviderLeadUnlock": {},
    "../../models/PaymentOrder": {},
    "../../models/WalletTransaction": {},
    "../../utils/uuid": () => "unlock-id",
    "../../utils/transaction": { withTransaction: async (callback) => callback({}) },
    "../../utils/validation": { identifierValue: (value) => String(value || "").trim() },
    "../../utils/normalization": {
      normalizeSearchText: (value) => String(value || "").trim().toLowerCase(),
    },
    "../../utils/credits": {
      leadCostCredits: (row) => Number(row.leadCostCredits ?? Number(row.leadPricePaise || 0) / 100),
      paiseFromCredits: (value) => Number(value || 0) * 100,
      creditsFromPaise: (value) => Number(value || 0) / 100,
    },
    "../../utils/requirement-location": {
      resolveRequirementLocation: (lead) => lead.locationLatitude === undefined ? null : ({
        latitude: Number(lead.locationLatitude),
        longitude: Number(lead.locationLongitude),
      }),
    },
    "../communication/nearby-lead-alert-service": {
      distanceKmExact: () => 12.4,
    },
    "../communication/system-event-service": { async dispatch() { return []; } },
    "../provider/provider-credit-service": {},
    "./provider-assignment-service": {},
  };

  loaded.require = (request) => (
    Object.prototype.hasOwnProperty.call(mocks, request)
      ? mocks[request]
      : Module.createRequire(filename)(request)
  );
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports;
}

test("CRM manual assignment uses the normal lead unlock debit model", () => {
  const service = source("services/provider-unlock/provider-manual-assignment-service.js");
  const creditService = source("services/provider/provider-credit-service.js");
  const credits = source("utils/credits.js");

  assert.match(service, /leadCostCredits\(lead\)/);
  assert.match(service, /consumeLeadUnlockCredits/);
  assert.match(service, /source: "lead_unlock"/);
  assert.match(service, /lead-unlock:/);
  assert.match(service, /unlockMethod: "credits"/);
  assert.match(service, /assignmentSource: "crm_manual"/);
  assert.match(service, /marketplaceClosureReason = "provider_pending"/);
  assert.match(creditService, /function allocationSort/);
  assert.match(creditService, /async function consumeLeadUnlockCredits/);
  assert.match(creditService, /INSUFFICIENT_BALANCE/);
  assert.match(credits, /function leadCostCredits/);
});

test("manual assignment is restricted to same-category providers within 100 km", () => {
  const nearby = source("services/enquiry/nearby-provider-service.js");
  const assignment = source("services/provider-unlock/provider-manual-assignment-service.js");

  assert.match(nearby, /MANUAL_ASSIGNMENT_RADIUS_KM = 100/);
  assert.match(nearby, /categorySlugs: workingLead\.categorySlug/);
  assert.match(nearby, /left\.distanceKm - right\.distanceKm/);
  assert.match(nearby, /manualAssignmentEligible/);
  assert.match(nearby, /insufficient_credits/);
  assert.match(assignment, /PROVIDER_CATEGORY_MISMATCH/);
  assert.match(assignment, /PROVIDER_OUTSIDE_ASSIGNMENT_RADIUS/);
  assert.match(assignment, /PREVIOUS_PROVIDER_NOT_CLOSED/);
  assert.match(assignment, /PROVIDER_ALREADY_ASSIGNED/);
});

test("manual assignment helper creates an already-unlocked CRM assignment snapshot", () => {
  const helpers = compileManualAssignmentHelpers();
  const snapshot = helpers.unlockSnapshot(
    {
      enquiryId: "lead-1",
      requirementTitle: "AC repair",
      categorySlug: "ac-repair",
      category: "AC Repair",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      leadPricePaise: 10000,
    },
    {
      providerId: "provider-1",
      name: "Provider",
      businessName: "Provider Business",
    },
    {
      chargedCredits: 100,
      walletTransactionId: "wallet-1",
      assignedBy: "ops@findoly.com",
      now: new Date("2026-09-27T00:00:00.000Z"),
    },
  );

  assert.equal(snapshot.providerId, "provider-1");
  assert.equal(snapshot.enquiryId, "lead-1");
  assert.equal(snapshot.unlockMethod, "credits");
  assert.equal(snapshot.chargedCredits, 100);
  assert.equal(snapshot.assignmentSource, "crm_manual");
  assert.equal(snapshot.assignedBy, "ops@findoly.com");
  assert.equal(snapshot.walletTransactionId, "wallet-1");
});

test("assignment notification tells provider the requirement is already unlocked and links to portal", () => {
  const communication = source("services/communication/system-event-service.js");
  const service = source("services/provider-unlock/provider-manual-assignment-service.js");

  assert.match(communication, /"provider_lead_assigned"/);
  assert.match(communication, /New requirement assigned to you/);
  assert.match(communication, /The requirement is already unlocked/);
  assert.match(communication, /\{\{lead_url\}\}/);
  assert.match(communication, /provider_manual_assignment/);
  assert.match(service, /systemEventService\.dispatch\([\s\S]*"provider_lead_assigned"/);
  assert.match(service, /providerPortalLeadUrl/);
});

test("Nearby Providers UI exposes guarded Assign and notify with 100 km assignment mode", () => {
  const view = source("views/enquiry/nearby-providers.ejs");
  const routes = source("routes/enquiry.js");
  const controller = source("controllers/enquiryController.js");

  assert.match(view, /Assign & notify/);
  assert.match(view, /assignmentMode=1/);
  assert.match(view, /Credits to deduct/);
  assert.match(view, /Balance after assignment/);
  assert.match(view, /manualAssignmentEligible/);
  assert.match(routes, /nearby-providers\/:providerId\/assign/);
  assert.match(controller, /assignNearbyProvider/);
});

test("assignment radius does not expand WhatsApp alert eligibility", () => {
  const nearby = source("services/enquiry/nearby-provider-service.js");
  assert.match(nearby, /withinAlertRadius/);
  assert.match(nearby, /outside_alert_radius/);
  assert.match(nearby, /whatsappEligible = !previouslyAssigned[\s\S]*withinAlertRadius/);
});

test("customer map marker is white and provider marker styling remains default", () => {
  const map = source("public/js/nearby-coverage-map.js");
  assert.match(map, /background: '#ffffff'/);
  assert.match(map, /borderColor: '#1f2937'/);
  assert.match(map, /glyphColor: '#111827'/);
  assert.match(map, /makePin\('P', 1\)/);
  assert.match(map, /km manual-assignment radius/);
});
