const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("PIN geocoder captures useful Google metadata defensively", () => {
  const geocoder = source("services/location/geocoding-service.js");
  const model = source("models/PincodeLocation.js");
  const controller = source("controllers/locationController.js");

  assert.match(geocoder, /postcodeLocalities:\s*cleanTextList\(result\?\.postcode_localities\)/);
  assert.match(geocoder, /formattedAddress:/);
  assert.match(geocoder, /body\?\.error_message/);
  assert.match(geocoder, /if \(cachedLocation\) return cachedLocation;/);
  assert.match(geocoder, /geocoding_cache_write_failed/);
  assert.match(model, /postcodeLocalities:\s*\{ type: \[String\]/);
  assert.match(model, /enrichmentVersion:/);
  assert.match(controller, /formattedAddress:\s*location\.formattedAddress/);
  assert.match(controller, /postcodeLocalities:/);
});

test("CRM provider and requirement forms enrich address data without replacing missing optional values", () => {
  const runtime = source("public/js/location-enrichment.js");

  assert.match(runtime, /form\.serviceAddress/);
  assert.match(runtime, /modelInput\("areaText"\)/);
  assert.match(runtime, /postcodeLocalities\.join\(", "\)/);
  assert.match(runtime, /form\.addressLine/);
  assert.match(runtime, /pincodeChanged \|\| !cleanText\(address\?\.value/);
  assert.match(runtime, /Location enrichment is optional and must never block CRM form usage/);
});

test("provider save has a backend enrichment fallback for fast form submission", () => {
  const controller = source("controllers/providerController.js");
  const enrichment = source("services/provider/provider-location-enrichment-service.js");

  assert.match(controller, /enrichProviderLocation\(created, \{ pincodeChanged: true \}\)/);
  assert.match(controller, /const pincodeChanged = String\(current\.servicePincode/);
  assert.match(enrichment, /update\.serviceAddress = formattedAddress/);
  assert.match(enrichment, /update\.serviceAreas = postcodeLocalities/);
  assert.match(enrichment, /catch \(error\)[\s\S]*return provider;/);
});

test("requirements persist PIN coordinates and nearby provider lookup retries missing coordinates", () => {
  const controller = source("controllers/enquiryController.js");
  const locationService = source("services/location/enquiry-location-service.js");
  const nearby = source("services/enquiry/nearby-provider-service.js");

  assert.match(controller, /syncLeadLocation\(createdLead\)/);
  assert.match(controller, /syncLeadLocation\(updatedLead\)/);
  assert.match(locationService, /locationLatitude:\s*Number\(location\.latitude\)/);
  assert.match(locationService, /locationLongitude:\s*Number\(location\.longitude\)/);
  assert.match(locationService, /locationSource:\s*"manual_pincode"/);
  assert.match(nearby, /syncLeadLocation\(lead\)/);
  assert.match(nearby, /canonicalLocationPincodeMismatch/);
});

test("approved requirements are represented and persisted as customer mobile verified", () => {
  const controller = source("controllers/enquiryController.js");
  const verification = source("services/enquiry/customer-verification-service.js");

  assert.match(controller, /customerMobileVerified:\s*true/);
  assert.match(controller, /ensureApprovedCustomerMobileVerified\(changedLead\)/);
  assert.match(verification, /canonicalLeadStatus\(lead\.status \|\| lead\.journeyStatus\) !== "approved"/);
  assert.match(verification, /customerMobileVerified:\s*true/);
  assert.match(verification, /customerMobileVerifiedAt:\s*verifiedAt/);
  assert.doesNotMatch(verification, /leadValidationDecision|contact_verification/);
});
