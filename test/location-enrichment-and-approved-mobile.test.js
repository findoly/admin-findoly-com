const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRequirementLocation } = require("../utils/requirement-location");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("PIN geocoder captures useful Google metadata defensively", () => {
  const geocoder = source("services/location/geocoding-service.js");
  const model = source("models/PincodeLocation.js");
  const controller = source("controllers/locationController.js");

  assert.match(geocoder, /postcodeLocalities:\s*cleanTextList\(result\?\.postcode_localities\)/);
  assert.match(geocoder, /formattedAddress:\s*String\(result\?\.formatted_address \|\| ""\)/);
  assert.doesNotMatch(geocoder, /formatted_address \|\| `\$\{pincode\}, India`/);
  assert.match(geocoder, /body\?\.error_message/);
  assert.match(geocoder, /if \(cachedLocation\) return cachedLocation;/);
  assert.match(geocoder, /geocoding_cache_write_failed/);
  assert.match(geocoder, /"PINCODE_NOT_FOUND"/);
  assert.match(model, /postcodeLocalities:\s*\{ type: \[String\]/);
  assert.match(model, /enrichmentVersion:/);
  assert.match(controller, /formattedAddress:\s*location\.formattedAddress/);
  assert.match(controller, /postcodeLocalities:/);
});

test("CRM provider and requirement forms preserve unchanged manual values", () => {
  const runtime = source("public/js/location-enrichment.js");

  assert.match(runtime, /form\.serviceAddress/);
  assert.match(runtime, /modelInput\("areaText"\)/);
  assert.match(runtime, /postcodeLocalities\.join\(", "\)/);
  assert.match(runtime, /form\.addressLine/);
  assert.match(runtime, /onlyIfEmpty:\s*!pincodeChanged/);
  assert.match(runtime, /pincodeChanged \|\| !cleanText\(address\?\.value/);
  assert.match(runtime, /Location enrichment is optional and must never block CRM form usage/);
});

test("provider save enrichment preserves deliberate edits and valid unchanged coordinates", () => {
  const controller = source("controllers/providerController.js");
  const enrichment = source("services/provider/provider-location-enrichment-service.js");

  assert.match(controller, /enrichProviderLocation\(created, \{ pincodeChanged: true \}\)/);
  assert.match(controller, /const pincodeChanged = String\(current\.servicePincode/);
  assert.match(controller, /previousProvider:\s*current/);
  assert.match(enrichment, /previousAddress/);
  assert.match(enrichment, /previousAreas/);
  assert.match(enrichment, /providerCoordinatesValid/);
  assert.match(enrichment, /pincodeChanged \|\| !providerCoordinatesValid/);
  assert.match(enrichment, /serviceLocationSource:\s*"manual_pincode"/);
  assert.match(enrichment, /serviceLocality:\s*""/);
  assert.match(enrichment, /provider_location_fallback_save_failed/);
});

test("requirements persist PIN coordinates and nearby provider lookup retries missing or manual coordinates", () => {
  const controller = source("controllers/enquiryController.js");
  const locationService = source("services/location/enquiry-location-service.js");
  const nearby = source("services/enquiry/nearby-provider-service.js");

  assert.match(controller, /syncLeadLocation\(createdLead\)/);
  assert.match(controller, /syncLeadLocation\(updatedLead\)/);
  assert.match(locationService, /locationLatitude:\s*Number\(location\.latitude\)/);
  assert.match(locationService, /locationLongitude:\s*Number\(location\.longitude\)/);
  assert.match(locationService, /locationSource:\s*"manual_pincode"/);
  assert.match(locationService, /currentCoordinatesVerified = currentLocationSource !== "manual_pincode"/);
  assert.match(nearby, /syncLeadLocation\(lead\)/);
  assert.match(nearby, /canonicalLocationPincodeMismatch/);
});

test("requirement location resolver rejects stale or unverified coordinates", () => {
  assert.equal(resolveRequirementLocation({
    pincode: "400095",
    locationPincode: "400022",
    locationLatitude: 19.04,
    locationLongitude: 72.86,
    locationSource: "google_geocoding",
  }), null);

  assert.equal(resolveRequirementLocation({
    pincode: "400095",
    locationPincode: "400095",
    locationLatitude: 19.18,
    locationLongitude: 72.81,
    locationSource: "manual_pincode",
  }), null);

  assert.equal(resolveRequirementLocation({
    pincode: "400095",
    locationPincode: "400095",
    locationLatitude: null,
    locationLongitude: null,
    locationSource: "manual_pincode",
    additionalDetails: {
      location: { latitude: 19.04, longitude: 72.86 },
    },
  }), null);

  assert.deepEqual(resolveRequirementLocation({
    pincode: "400095",
    locationPincode: "400095",
    locationLatitude: 19.1888023,
    locationLongitude: 72.8197043,
    locationSource: "google_geocoding",
  }), {
    latitude: 19.1888023,
    longitude: 72.8197043,
    source: "canonical",
    pincode: "400095",
    formattedAddress: "",
  });
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
