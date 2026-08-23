"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadNearbyProviderService() {
  const servicePath = path.join(root, "services/enquiry/nearby-provider-service.js");
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "../../models/Enquiry") return {};
    if (request === "../../models/Provider") return {};
    if (request === "../communication/nearby-lead-alert-service") {
      return {
        distanceKmExact(lat1, lon1, lat2, lon2) {
          const values = [lat1, lon1, lat2, lon2].map(Number);
          const toRadians = (degrees) => degrees * Math.PI / 180;
          const latitudeDelta = toRadians(values[2] - values[0]);
          const longitudeDelta = toRadians(values[3] - values[1]);
          const a = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(toRadians(values[0])) * Math.cos(toRadians(values[2]))
            * Math.sin(longitudeDelta / 2) ** 2;
          return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("nearby provider map routes are read-only and permission protected", () => {
  const apiRoutes = source("routes/enquiry.js");
  const frontendRoutes = source("routes/frontend.js");
  const controller = source("controllers/enquiryController.js");
  const frontendController = source("controllers/frontendController.js");

  assert.match(apiRoutes, /router\.get\("\/:enquiryId\/nearby-providers", requirePermission\("requirements\.view"\), c\.nearbyProviders\)/);
  assert.match(frontendRoutes, /\/enquiries\/:enquiryId\/nearby-providers/);
  assert.match(frontendRoutes, /\/requirements\/:enquiryId\/nearby-providers/);
  assert.match(controller, /nearbyProviderService\.listNearbyProviders/);
  assert.match(frontendController, /enquiryNearbyProviders:\s*render\("enquiry\/nearby-providers", "Nearby providers"\)/);
});

test("requirement details receives a nearby providers action without changing the lead view", () => {
  const action = source("public/js/nearby-providers-action.js");
  const head = source("views/partials/head.ejs");
  const leadView = source("views/enquiry/show.ejs");

  assert.match(action, /Provider status/);
  assert.match(action, /Nearby providers/);
  assert.match(action, /nearby-providers/);
  assert.match(head, /title === 'Requirement details'/);
  assert.match(head, /nearby-providers-action\.js/);
  assert.match(leadView, /Provider status/);
  assert.match(leadView, /Lead action centre/);
});

test("nearby provider page contains map, radius selector and distance list", () => {
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.match(view, /id="nearby-provider-map"/);
  assert.match(view, /type="range" min="1" max="100"/);
  assert.match(view, /Nearby provider list/);
  assert.match(view, /Nearest first/);
  assert.match(view, /Farthest first/);
  assert.match(view, /provider\.distanceKm\.toFixed\(1\) \+ ' km'/);
  assert.match(view, /openstreetmap\.org/);
  assert.match(view, /View only — this does not change the requirement's saved WhatsApp alert distance/);
});

test("nearby provider service uses the existing Haversine implementation and safe radius limits", () => {
  const serviceSource = source("services/enquiry/nearby-provider-service.js");
  const service = loadNearbyProviderService();

  assert.match(serviceSource, /nearbyLeadAlertService\.distanceKmExact/);
  assert.equal(service.defaultRadiusKmForLead({}), 20);
  assert.equal(service.defaultRadiusKmForLead({ alertDistanceKm: 35 }), 35);
  assert.equal(service.defaultRadiusKmForLead({ alertDistanceKm: 101 }), 20);
  assert.equal(service.normalizeRadiusKm("50", 20), 50);
  assert.throws(() => service.normalizeRadiusKm("101", 20));
});

test("missing requirement coordinates remain absent instead of becoming a zero-zero map point", () => {
  const service = loadNearbyProviderService();
  const lead = service.presentLead({ enquiryId: "lead-no-location", alertDistanceKm: 20 });

  assert.equal(Object.prototype.hasOwnProperty.call(lead, "latitude"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(lead, "longitude"), false);
  assert.deepEqual(service.buildNearbyProviderRows({}, [{
    providerId: "provider-1",
    serviceLatitude: 19.1,
    serviceLongitude: 72.8,
  }], 20), []);
});

test("nearby provider map uses nested requirement coordinates and formatted address", () => {
  const service = loadNearbyProviderService();
  const lead = {
    enquiryId: "lead-nested-location",
    pincode: "400095",
    additionalDetails: {
      location: {
        formattedAddress: "Malad, Patelwadi, Ins Hamla, Malad West, Mumbai, Maharashtra 400095, India",
        pincode: "400095",
        latitude: 19.1868304,
        longitude: 72.800849,
      },
    },
  };
  const presented = service.presentLead(lead);
  const rows = service.buildNearbyProviderRows(lead, [{
    providerId: "provider-near",
    name: "Near Provider",
    serviceLatitude: 19.19,
    serviceLongitude: 72.80,
  }], 20);

  assert.equal(presented.latitude, 19.1868304);
  assert.equal(presented.longitude, 72.800849);
  assert.equal(presented.locationSource, "additionalDetails.location");
  assert.match(presented.locationLabel, /Malad West/);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].distanceKm < 20);
});

test("nearby provider rows exclude outside or invalid locations and sort nearest first", () => {
  const service = loadNearbyProviderService();
  const lead = {
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
  };
  const providers = [
    {
      providerId: "provider-far",
      name: "Far Provider",
      status: "active",
      serviceLatitude: 19.20,
      serviceLongitude: 72.8777,
      city: "Mumbai",
    },
    {
      providerId: "provider-near",
      name: "Near Provider",
      status: "active",
      serviceLatitude: 19.09,
      serviceLongitude: 72.8777,
      city: "Mumbai",
    },
    {
      providerId: "provider-outside",
      name: "Outside Provider",
      status: "active",
      serviceLatitude: 19.50,
      serviceLongitude: 72.8777,
      city: "Mumbai",
    },
    {
      providerId: "provider-no-location",
      name: "No Location Provider",
      status: "active",
      serviceLatitude: null,
      serviceLongitude: null,
    },
  ];

  const rows = service.buildNearbyProviderRows(lead, providers, 20);
  assert.deepEqual(rows.map((row) => row.providerId), ["provider-near", "provider-far"]);
  assert.ok(rows[0].distanceKm < rows[1].distanceKm);
  assert.ok(rows.every((row) => row.distanceKm <= 20));
});

test("database discovery is restricted to active providers in the requirement category", () => {
  const serviceSource = source("services/enquiry/nearby-provider-service.js");

  assert.match(serviceSource, /status:\s*"active"/);
  assert.match(serviceSource, /categorySlugs:\s*lead\.categorySlug/);
  assert.match(serviceSource, /serviceLatitude:\s*\{ \$ne: null \}/);
  assert.match(serviceSource, /serviceLongitude:\s*\{ \$ne: null \}/);
  assert.doesNotMatch(serviceSource, /whatsappLeadAlertsEnabled:\s*\{ \$ne: false \}/);
});
