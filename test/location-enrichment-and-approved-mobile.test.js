const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRequirementLocation } = require("../utils/requirement-location");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("PIN geocoder captures useful Google metadata and diagnostics defensively", () => {
  const geocoder = source("services/location/geocoding-service.js");
  const model = source("models/PincodeLocation.js");
  const controller = source("controllers/locationController.js");

  assert.match(geocoder, /postcodeLocalities:\s*cleanTextList\(result\?\.postcode_localities\)/);
  assert.match(geocoder, /formattedAddress:\s*String\(result\?\.formatted_address \|\| ""\)/);
  assert.doesNotMatch(geocoder, /formatted_address \|\| `\$\{pincode\}, India`/);
  assert.match(geocoder, /errorBody\?\.error_message \|\| response\.statusText/);
  assert.match(geocoder, /httpStatus:\s*response\.status/);
  assert.match(geocoder, /googleStatus:\s*body\?\.status/);
  assert.match(geocoder, /redacted-google-api-key/);
  assert.match(geocoder, /if \(cachedLocation\) return cachedLocation;/);
  assert.match(geocoder, /geocoding_cache_write_failed/);
  assert.match(geocoder, /"PINCODE_NOT_FOUND"/);
  assert.match(model, /postcodeLocalities:\s*\{ type: \[String\]/);
  assert.match(model, /enrichmentVersion:/);
  assert.match(controller, /formattedAddress:\s*location\.formattedAddress/);
  assert.match(controller, /postcodeLocalities:/);
});

test("CRM provider and requirement PIN lookups preserve unchanged manual values and fast-save semantics", () => {
  const runtime = source("public/js/location-enrichment.js");

  assert.match(runtime, /form\.serviceAddress/);
  assert.match(runtime, /modelInput\("areaText"\)/);
  assert.match(runtime, /postcodeLocalities\.join\(", "\)/);
  assert.match(runtime, /form\.addressLine/);
  assert.match(runtime, /onlyIfEmpty:\s*!pincodeChanged/);
  assert.match(runtime, /pincodeChanged \|\| !cleanText\(address\?\.value/);
  assert.match(runtime, /!applied\.pincodeChanged/);
  assert.match(runtime, /city:\s*""/);
  assert.match(runtime, /state:\s*""/);
  assert.match(runtime, /legacy form lookup assigns city\/state again/);
  assert.match(runtime, /Location enrichment is optional and must never block CRM form usage/);
});

test("provider save enrichment preserves deliberate edits, fills blank create fields and avoids duplicate Google timeouts", () => {
  const controller = source("controllers/providerController.js");
  const requestController = source("controllers/providerRequestController.js");
  const enrichment = source("services/provider/provider-location-enrichment-service.js");

  assert.match(controller, /submittedProvider:\s*req\.body/);
  assert.match(controller, /previousProvider:\s*current/);
  assert.match(controller, /const pincodeChanged = String\(current\.servicePincode/);
  assert.match(requestController, /!data\.existing && data\.provider/);
  assert.match(requestController, /submittedProvider:\s*req\.body/);
  assert.match(enrichment, /submittedAddressChanged/);
  assert.match(enrichment, /hasPrevious \? submittedAddress !== previousAddress : Boolean\(submittedAddress\)/);
  assert.match(enrichment, /hasPrevious \? !sameTextList\(submittedAreas, previousAreas\) : submittedAreas\.length > 0/);
  assert.match(enrichment, /providerCoordinatesVerified/);
  assert.match(enrichment, /providerLocationSource !== "manual_pincode"/);
  assert.match(enrichment, /pincodeChanged && providerLocationSource === "manual_pincode"/);
  assert.match(enrichment, /Do not create a second timeout window/);
  assert.match(enrichment, /serviceLocationSource:\s*"manual_pincode"/);
  assert.match(enrichment, /serviceLocality:\s*""/);
  assert.match(enrichment, /provider_location_fallback_save_failed/);
});

test("requirements persist PIN coordinates, preserve edits and nearby lookup retries coordinates only", () => {
  const controller = source("controllers/enquiryController.js");
  const locationService = source("services/location/enquiry-location-service.js");
  const nearby = source("services/enquiry/nearby-provider-service.js");

  assert.match(controller, /syncLeadLocation\(createdLead\)/);
  assert.match(controller, /const previousLead = await service\.get/);
  assert.match(controller, /syncLeadLocation\(updatedLead, \{ previousLead \}\)/);
  assert.match(controller, /publishAlreadyFailedGeocoding/);
  assert.match(locationService, /previousLead/);
  assert.match(locationService, /shouldUseGoogleValue/);
  assert.match(locationService, /fillMissingDescriptive/);
  assert.match(locationService, /locationLatitude:\s*Number\(location\.latitude\)/);
  assert.match(locationService, /locationLongitude:\s*Number\(location\.longitude\)/);
  assert.match(locationService, /locationSource:\s*"manual_pincode"/);
  assert.match(locationService, /currentCoordinatesVerified = currentLocationSource !== "manual_pincode"/);
  assert.match(nearby, /syncLeadLocation\(lead, \{/);
  assert.match(nearby, /fillMissingDescriptive:\s*false/);
  assert.match(nearby, /canonicalLocationPincodeMismatch/);
});

test("manual provider coordinates are excluded from nearby tables and WhatsApp alerts", () => {
  const nearby = source("services/enquiry/nearby-provider-service.js");
  const alerts = source("services/communication/nearby-lead-alert-service.js");

  assert.match(nearby, /providerHasVerifiedCoordinates/);
  assert.match(nearby, /serviceLocationSource:\s*\{ \$ne: "manual_pincode" \}/);
  assert.match(nearby, /serviceLocationSource:\s*1/);
  assert.match(alerts, /hasVerifiedProviderCoordinates/);
  assert.match(alerts, /serviceLocationSource:\s*\{ \$ne: "manual_pincode" \}/);
  assert.match(alerts, /serviceLocationSource:\s*1/);
});

test("lower-level provider and marketplace services retry manual PIN states safely", () => {
  const providerService = source("services/provider/provider-service.js");
  const enquiryService = source("services/enquiry/enquiry-service.js");

  assert.match(
    providerService,
    /const sameLocation = pincode === String\(current\.servicePincode \|\| ""\)[\s\S]*?serviceLocationSource[\s\S]*?!== "manual_pincode"/,
  );
  assert.match(
    providerService,
    /function manualLocation\(data\)[\s\S]*?serviceLatitude:\s*null[\s\S]*?serviceLongitude:\s*null[\s\S]*?serviceLocality:\s*""[\s\S]*?serviceDistrict:\s*""[\s\S]*?serviceLocationSource:\s*"manual_pincode"/,
  );
  assert.match(
    enquiryService,
    /const alreadyVerified = pincode === String\(enquiry\.locationPincode \|\| ""\)[\s\S]*?locationSource[\s\S]*?!== "manual_pincode"/,
  );
  assert.match(
    enquiryService,
    /locationLatitude:\s*null[\s\S]*?locationLongitude:\s*null[\s\S]*?locationLocality:\s*""[\s\S]*?locationDistrict:\s*""[\s\S]*?locationVerifiedAt:\s*null[\s\S]*?locationSource:\s*"manual_pincode"/,
  );
  assert.match(
    enquiryService,
    /\$set:\s*\{[\s\S]*?locationLatitude:[\s\S]*?locationLongitude:[\s\S]*?locationPincode:[\s\S]*?locationLocality:[\s\S]*?locationDistrict:[\s\S]*?locationVerifiedAt:[\s\S]*?locationSource:/,
  );
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

test("approval prepares customer mobile verification before journey side effects and rolls back failed attempts safely", () => {
  const controller = source("controllers/enquiryController.js");
  const verification = source("services/enquiry/customer-verification-service.js");

  assert.match(controller, /resolveLeadStatusTransition/);
  assert.match(controller, /transition\.toStatus === "approved"/);
  assert.match(controller, /prepareApprovalCustomerMobileVerification\(currentLead\)/);
  assert.match(controller, /const changedLead = await service\.updateStatus/);
  assert.ok(
    controller.indexOf("prepareApprovalCustomerMobileVerification(currentLead)")
      < controller.indexOf("const changedLead = await service.updateStatus"),
  );
  assert.match(controller, /rollbackPreparedApprovalCustomerMobileVerification/);
  assert.match(controller, /ensureApprovedCustomerMobileVerified\(changedLead\)/);
  assert.match(verification, /status:\s*\{ \$ne: "approved" \}/);
  assert.match(verification, /customerMobileVerifiedAt:\s*preparation\.verifiedAt/);
  assert.match(verification, /canonicalLeadStatus\(lead\.status \|\| lead\.journeyStatus\) !== "approved"/);
  assert.doesNotMatch(verification, /leadValidationDecision|contact_verification/);
});
