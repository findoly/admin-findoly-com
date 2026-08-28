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
        whatsappContact(provider = {}) {
          return provider.normalizedWhatsappNumber
            || provider.whatsappNumber
            || provider.normalizedMobile
            || provider.mobile
            || "";
        },
        providerMatchesLeadPreference(provider = {}) {
          return provider.whatsappLeadAlertsEnabled !== false;
        },
        normalizeTargetProviderIds(value) {
          return Array.isArray(value)
            ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
            : [];
        },
        async dispatchSelectedNearbyLeadAlerts() {
          return { alerted: 1, requested: 1, alertedProviderIds: ["provider-near"], skippedProviderIds: [] };
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

test("nearby provider discovery stays view-only while alert actions require manage permission", () => {
  const apiRoutes = source("routes/enquiry.js");
  const frontendRoutes = source("routes/frontend.js");
  const controller = source("controllers/enquiryController.js");
  const frontendController = source("controllers/frontendController.js");

  assert.match(apiRoutes, /router\.get\("\/:enquiryId\/nearby-providers", requirePermission\("requirements\.view"\), c\.nearbyProviders\)/);
  assert.match(apiRoutes, /router\.post\("\/:enquiryId\/nearby-providers\/alerts", requirePermission\("requirements\.manage"\), c\.sendNearbyProviderAlerts\)/);
  assert.doesNotMatch(apiRoutes, /nearby-providers\/automatic-alerts/);
  assert.match(frontendRoutes, /\/enquiries\/:enquiryId\/nearby-providers/);
  assert.match(frontendRoutes, /\/requirements\/:enquiryId\/nearby-providers/);
  assert.match(controller, /nearbyProviderService\.listNearbyProviders/);
  assert.match(controller, /nearbyProviderService\.sendSelectedProviderAlerts/);
  assert.doesNotMatch(controller, /setAutomaticWhatsappLeadAlerts/);
  assert.match(frontendController, /enquiryNearbyProviders:\s*render\("enquiry\/nearby-providers", "Nearby Providers"\)/);
});

test("requirement details use Nearby providers without provider-alert status cards", () => {
  const action = source("public/js/nearby-providers-action.js");
  const head = source("views/partials/head.ejs");
  const leadView = source("views/enquiry/show.ejs");
  const listView = source("views/enquiry/index.ejs");

  assert.match(action, /Provider status/);
  assert.match(action, /Nearby providers/);
  assert.match(action, /body\.count/);
  assert.match(action, /apiFetch\('\/api\/enquiry\/' \+ encodeURIComponent\(leadId\) \+ '\/nearby-providers'\)/);
  assert.match(head, /title === 'Requirement details'/);
  assert.match(head, /nearby-providers-action\.js\?v=20260828-alert-status-1/);
  assert.match(leadView, /Provider status/);
  assert.match(leadView, /Lead action centre/);
  assert.doesNotMatch(leadView, /Provider alert/);
  assert.doesNotMatch(leadView, /providerAlertStatus\.label/);
  assert.match(listView, /Nearby providers/);
  assert.doesNotMatch(listView, />Provider alert</);
});

test("nearby provider page keeps one manual WhatsApp table without alert-status cards", () => {
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.match(view, /Nearby providers/);
  assert.match(view, /Select nearby providers and send WhatsApp manually when needed/);
  assert.match(view, /Find provider/);
  assert.match(view, /Nearest first/);
  assert.match(view, /Farthest first/);
  assert.match(view, /provider\.distanceKm\.toFixed\(1\) \+ ' km'/);
  assert.match(view, /providerCountLabel/);
  assert.match(view, /within the saved ' \+ this\.radiusKm \+ ' km radius'/);
  assert.match(view, /provider\.walletBalanceCredits/);
  assert.match(view, /Send WhatsApp to selected/);
  assert.match(view, />Send WhatsApp</);
  assert.doesNotMatch(view, /Provider alert status/);
  assert.doesNotMatch(view, /Providers available for alert/);
  assert.doesNotMatch(view, /Provider unlocked · Further provider WhatsApp alerts are stopped/);
  assert.doesNotMatch(view, /automaticWhatsappLeadAlertsEnabled/);
  assert.match(view, /No eligible nearby providers/);
  assert.match(view, /can\('requirements\.manage'\)/);
  assert.match(view, /nearby-providers\/alerts/);
  assert.doesNotMatch(view, /nearby-providers\/automatic-alerts/);
  assert.match(view, /apiFetch\('\/api\/enquiry\/' \+ encodeURIComponent\(this\.leadId\) \+ '\/nearby-providers'\)/);
  assert.doesNotMatch(view, /radiusKm=/);
  assert.doesNotMatch(view, /id="nearby-provider-map"/);
  assert.doesNotMatch(view, /type="range"/);
  assert.doesNotMatch(view, /Provider map/);
});

test("map dependencies and vendor assets are removed", () => {
  const packageJson = JSON.parse(source("package.json"));
  const app = source("app.js");
  const head = source("views/partials/head.ejs");
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.dependencies, "ol"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.dependencies, "leaflet"), false);
  assert.doesNotMatch(app, /\/vendor\/openlayers/);
  assert.doesNotMatch(app, /\/vendor\/leaflet/);
  assert.doesNotMatch(head, /\/vendor\/openlayers/);
  assert.doesNotMatch(head, /\/vendor\/leaflet/);
  assert.doesNotMatch(view, /OpenLayers|OpenStreetMap|tile\.openstreetmap|window\.ol|window\.L/);
});

test("nearby provider list keeps search and sorting without map lifecycle code", () => {
  const view = source("views/enquiry/nearby-providers.ejs");

  assert.match(view, /x-data="nearbyProviderList\(\)"/);
  assert.match(view, /get filteredProviders\(\)/);
  assert.match(view, /this\.sortOrder === 'farthest'/);
  assert.match(view, /this\.sortOrder === 'name'/);
  assert.match(view, /this\.providerCount = Number\.isFinite\(count\)/);
  assert.doesNotMatch(view, /renderMap|destroyMap|mapRenderToken|providerMap|mapError/);
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

test("missing requirement coordinates remain absent instead of becoming a zero-zero point", () => {
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

test("nearby provider list uses nested requirement coordinates and formatted address", () => {
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

test("nearby provider rows expose credits and WhatsApp alert eligibility without hiding opted-out providers", () => {
  const service = loadNearbyProviderService();
  const lead = {
    categorySlug: "painting",
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
  };
  const rows = service.buildNearbyProviderRows(lead, [
    {
      providerId: "provider-ready",
      name: "Ready Provider",
      portalAccessEnabled: true,
      whatsappLeadAlertsEnabled: true,
      normalizedWhatsappNumber: "9876543210",
      walletBalancePaise: 8450,
      serviceLatitude: 19.08,
      serviceLongitude: 72.8777,
    },
    {
      providerId: "provider-opted-out",
      name: "Opted Out Provider",
      portalAccessEnabled: true,
      whatsappLeadAlertsEnabled: false,
      normalizedWhatsappNumber: "9876543211",
      walletBalancePaise: 0,
      serviceLatitude: 19.081,
      serviceLongitude: 72.8777,
    },
  ], 20);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].providerId, "provider-ready");
  assert.equal(rows[0].walletBalanceCredits, 84.5);
  assert.equal(rows[0].whatsappAlertEligible, true);
  assert.equal(rows[1].providerId, "provider-opted-out");
  assert.equal(rows[1].walletBalanceCredits, 0);
  assert.equal(rows[1].whatsappAlertEligible, false);
  assert.equal(rows[1].whatsappAlertReason, "provider_alerts_disabled");
});

test("nearby provider rows keep manual WhatsApp eligible after history and unlock", () => {
  const service = loadNearbyProviderService();
  const baseLead = {
    categorySlug: "painting",
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
    marketplaceAvailable: true,
    marketplaceStatus: "published",
    remainingUnlocks: 3,
    unlockedCount: 0,
    providerWhatsappAlerts: [{
      providerId: "provider-alerted",
      alertedAt: new Date("2026-08-28T10:30:00.000Z"),
      mode: "manual",
      actor: "employee@findoly.com",
    }],
  };
  const providers = [
    {
      providerId: "provider-alerted",
      name: "Already Sent",
      portalAccessEnabled: true,
      whatsappLeadAlertsEnabled: true,
      normalizedWhatsappNumber: "9876543210",
      serviceLatitude: 19.08,
      serviceLongitude: 72.8777,
    },
    {
      providerId: "provider-ready",
      name: "Ready",
      portalAccessEnabled: true,
      whatsappLeadAlertsEnabled: true,
      normalizedWhatsappNumber: "9876543211",
      serviceLatitude: 19.081,
      serviceLongitude: 72.8777,
    },
  ];

  const rows = service.buildNearbyProviderRows(baseLead, providers, 20);
  const sent = rows.find((row) => row.providerId === "provider-alerted");
  const ready = rows.find((row) => row.providerId === "provider-ready");

  assert.equal(sent.alertAlreadySent, true);
  assert.equal(sent.whatsappAlertEligible, true);
  assert.equal(sent.whatsappAlertReason, "");
  assert.equal(sent.alertMode, "manual");
  assert.equal(ready.whatsappAlertEligible, true);

  const unlockedRows = service.buildNearbyProviderRows({ ...baseLead, unlockedCount: 1 }, providers, 20);
  assert.ok(unlockedRows.every((row) => row.whatsappAlertEligible === true));
  assert.equal(service.presentLead({ ...baseLead, unlockedCount: 1 }).providerAlertStatus.canSend, true);
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
  assert.doesNotMatch(serviceSource, /Provider\.find\(\{[\s\S]*whatsappLeadAlertsEnabled:\s*\{ \$ne: false \}/);
  assert.match(serviceSource, /walletBalancePaise:\s*1/);
  assert.match(serviceSource, /providerWhatsappAlerts:\s*1/);
  assert.match(serviceSource, /unlockedCount:\s*1/);
  assert.match(serviceSource, /sendSelectedProviderAlerts/);
  assert.match(serviceSource, /alreadyAlertedProviderIds/);
  assert.match(serviceSource, /recordSuccessfulProviderAlerts/);
  assert.match(serviceSource, /dispatchSelectedNearbyLeadAlerts/);
});
