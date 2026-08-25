const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("CRM-created leads attach verified PIN-code coordinates without blocking creation", () => {
  const controller = source("controllers/enquiryController.js");
  const locationService = source("services/location/enquiry-location-service.js");

  assert.match(controller, /attachCreatedLeadLocation\(createdLead\)/);
  assert.match(controller, /await service\.get\(createdLead\.enquiryId\)/);
  assert.match(locationService, /await geocodePincode\(pincode\)/);
  assert.match(locationService, /locationLatitude:\s*Number\(location\.latitude\)/);
  assert.match(locationService, /locationLongitude:\s*Number\(location\.longitude\)/);
  assert.match(locationService, /locationPincode:\s*pincode/);
  assert.match(locationService, /locationVerifiedAt:/);
  assert.match(locationService, /locationSource:/);
  assert.match(locationService, /catch \(error\)[\s\S]*return null;/);
});
