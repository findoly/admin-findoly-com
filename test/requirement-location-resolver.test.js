"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const {
  coordinatePair,
  resolveRequirementLocation,
  applyResolvedLocation,
} = require("../utils/requirement-location");

test("canonical requirement coordinates win when multiple valid pairs exist", () => {
  const resolved = resolveRequirementLocation({
    locationLatitude: 19.1,
    locationLongitude: 72.9,
    additionalDetails: {
      location: { latitude: 19.2, longitude: 72.8 },
    },
  });
  assert.deepEqual(
    { latitude: resolved.latitude, longitude: resolved.longitude, source: resolved.source },
    { latitude: 19.1, longitude: 72.9, source: "canonical" },
  );
});

test("Vetskart-style additionalDetails.location coordinates are resolved", () => {
  const resolved = resolveRequirementLocation({
    pincode: "400095",
    additionalDetails: {
      location: {
        formattedAddress: "Malad, Patelwadi, Ins Hamla, Malad West, Mumbai, Maharashtra 400095, India",
        pincode: "400095",
        latitude: 19.1868304,
        longitude: 72.800849,
      },
    },
  });
  assert.equal(resolved.source, "additionalDetails.location");
  assert.equal(resolved.latitude, 19.1868304);
  assert.equal(resolved.longitude, 72.800849);
  assert.equal(resolved.pincode, "400095");
  assert.match(resolved.formattedAddress, /Malad West/);
});

test("common nested and legacy coordinate aliases are supported", () => {
  assert.equal(resolveRequirementLocation({ metadata: { location: { lat: 19.2, lng: 72.8 } } }).source, "metadata.location");
  assert.equal(resolveRequirementLocation({ location: { lat: 19.2, lon: 72.8 } }).source, "location");
  assert.equal(resolveRequirementLocation({ coordinates: { latitude: 19.2, longitude: 72.8 } }).source, "coordinates");
  assert.equal(resolveRequirementLocation({ additionalDetails: { lat: 19.2, lng: 72.8 } }).source, "additionalDetails");
  assert.equal(resolveRequirementLocation({ latitude: 19.2, longitude: 72.8 }).source, "record");
});

test("resolver never mixes partial coordinates across sources", () => {
  const resolved = resolveRequirementLocation({
    locationLatitude: 19.1,
    additionalDetails: { location: { longitude: 72.8 } },
    metadata: { location: { latitude: 19.2, longitude: 72.7 } },
  });
  assert.equal(resolved.source, "metadata.location");
  assert.equal(resolved.latitude, 19.2);
  assert.equal(resolved.longitude, 72.7);
});

test("invalid coordinate ranges and blank values are rejected", () => {
  assert.equal(coordinatePair({ latitude: 91, longitude: 72.8 }), null);
  assert.equal(coordinatePair({ latitude: 19.2, longitude: 181 }), null);
  assert.equal(resolveRequirementLocation({ latitude: "", longitude: 72.8 }), null);
});

test("resolved alternate coordinates can be promoted to canonical fields", () => {
  const target = {
    pincode: "400095",
    additionalDetails: { location: { latitude: 19.1868304, longitude: 72.800849 } },
  };
  applyResolvedLocation(target);
  assert.equal(target.locationLatitude, 19.1868304);
  assert.equal(target.locationLongitude, 72.800849);
  assert.equal(target.locationPincode, "400095");
  assert.equal(target.locationSource, "additionalDetails.location");
});

test("nearby map, alerts, API responses and Enquiry persistence use the shared resolver", () => {
  const nearbyMap = source("services/enquiry/nearby-provider-service.js");
  const alerts = source("services/communication/nearby-lead-alert-service.js");
  const controller = source("controllers/enquiryController.js");
  const model = source("models/Enquiry.js");

  assert.match(nearbyMap, /resolveRequirementLocation/);
  assert.match(nearbyMap, /additionalDetails: 1/);
  assert.match(alerts, /resolveRequirementLocation/);
  assert.match(alerts, /coordinateSource/);
  assert.match(controller, /withEffectiveLocation/);
  assert.match(model, /canonicalizeRequirementLocation/);
  assert.match(model, /canonicalizeUpdatedRequirementLocation/);
  assert.match(model, /updateNeedsLocationResolution/);
  assert.match(model, /Object\.prototype\.hasOwnProperty\.call\(set, "status"\)/);
});
