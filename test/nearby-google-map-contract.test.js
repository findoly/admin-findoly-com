"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("nearby providers page receives the existing Google Maps browser configuration", () => {
  const controller = source("controllers/frontendController.js");
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.match(controller, /view === "enquiry\/nearby-providers"/);
  assert.match(controller, /GOOGLE_MAPS_BROWSER_API_KEY/);
  assert.match(controller, /GOOGLE_MAPS_MAP_ID/);
  assert.match(controller, /enquiryNearbyProviders:\s*render\("enquiry\/nearby-providers", "Nearby Providers"\)/);
  assert.match(view, /data-google-maps-browser-api-key="<%= googleMapsBrowserApiKey \|\| '' %>"/);
  assert.match(view, /data-google-maps-map-id="<%= googleMapsMapId \|\| '' %>"/);
});

test("nearby map visualizes the same lead and provider payload used by the table", () => {
  const view = source("views/enquiry/nearby-providers.ejs");
  const map = source("public/js/nearby-coverage-map.js");

  assert.match(view, /data-nearby-coverage-root/);
  assert.match(view, /data-nearby-coverage-canvas/);
  assert.match(view, /window\.__findolyNearbyProviderMapData = mapPayload/);
  assert.match(view, /new CustomEvent\('nearby-providers:loaded', \{ detail: mapPayload \}\)/);
  assert.match(view, /nearby-coverage-map\.js\?v=20260907-1/);
  assert.match(map, /window\.addEventListener\('nearby-providers:loaded'/);
  assert.match(map, /payload\?\.lead/);
  assert.match(map, /payload\?\.providers/);
});

test("Google Maps is visualization-only and CRM Haversine distance remains authoritative", () => {
  const service = source("services/enquiry/nearby-provider-service.js");
  const map = source("public/js/nearby-coverage-map.js");
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.match(service, /nearbyLeadAlertService\.distanceKmExact/);
  assert.match(map, /provider\.distanceKm/);
  assert.match(view, /provider\.distanceKm\.toFixed\(1\) \+ ' km'/);
  assert.match(view, /Findoly's existing Haversine calculation remains the source of provider distance/);
  assert.doesNotMatch(map, /DistanceMatrixService|DirectionsService|computeDistanceBetween|geometry\.spherical|Routes API|Distance Matrix/i);
  assert.doesNotMatch(view, /Distance Matrix|driving distance|travel time/i);
});

test("map shows fixed customer, provider markers and saved radius without changing matching", () => {
  const map = source("public/js/nearby-coverage-map.js");
  const service = source("services/enquiry/nearby-provider-service.js");

  assert.match(map, /makePin\('C', 1\.2\)/);
  assert.match(map, /makePin\('P', 1\)/);
  assert.match(map, /new google\.maps\.Circle/);
  assert.match(map, /radius: radiusKm \* 1000/);
  assert.match(map, /clickable: false/);
  assert.doesNotMatch(map, /map\.addListener\('click'|selectCenter|setRadius|radiusKm=/);
  assert.match(service, /if \(distanceKm === null \|\| distanceKm > radiusKm\) continue/);
});

test("map gracefully handles missing coordinates and missing Google Maps configuration", () => {
  const map = source("public/js/nearby-coverage-map.js");

  assert.match(map, /Customer location is unavailable/);
  assert.match(map, /Google Maps is not configured for this CRM environment/);
  assert.match(map, /The provider table remains fully available/);
  assert.match(map, /Check the browser API key and allowed referrers/);
});
