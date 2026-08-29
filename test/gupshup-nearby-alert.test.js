"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadNearbyService(providers, notifications, queryCapture) {
  const Provider = {
    find(query) {
      queryCapture.value = query;
      return {
        select() { return this; },
        lean() { return this; },
        cursor() {
          return {
            async *[Symbol.asyncIterator]() {
              for (const provider of providers) {
                if (query.whatsappLeadAlertsEnabled?.$ne === false && provider.whatsappLeadAlertsEnabled === false) continue;
                if (Array.isArray(query.providerId?.$in) && !query.providerId.$in.includes(provider.providerId)) continue;
                yield provider;
              }
            },
          };
        },
      };
    },
  };
  const notificationService = {
    async triggerSafe(event, context) {
      notifications.push({ event, context });
      return [{ communicationId: `${context.lead.enquiryId}:${context.provider.providerId}` }];
    },
  };
  const servicePath = path.join(root, "services/communication/nearby-lead-alert-service.js");
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === "../../models/Provider") return Provider;
    if (request === "./notification-service") return notificationService;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("CRM WhatsApp delivery uses Gupshup templates and has no Meta Cloud API path", () => {
  const whatsapp = source("services/communication/whatsapp-service.js");
  const webhook = source("services/communication/webhook-service.js");
  const config = source("services/communication/communication-config.js");

  assert.match(whatsapp, /\/wa\/api\/v1\/template\/msg/);
  assert.match(whatsapp, /application\/x-www-form-urlencoded/);
  assert.match(whatsapp, /apikey:\s*config\.apiKey/);
  assert.match(whatsapp, /externalTemplateId/);
  assert.match(whatsapp, /"src\.name"/);
  assert.match(webhook, /event\.type === "message-event"/);
  assert.match(webhook, /gupshupMessageId = String\(payload\.gsId/);
  assert.match(webhook, /metaMessageId = String\(payload\.id/);
  assert.match(config, /CRM_GUPSHUP_API_KEY/);
  assert.doesNotMatch(`${whatsapp}\n${webhook}\n${config}`, /graph\.facebook|META_WHATSAPP|x-hub-signature/i);
});

test("selected nearby alerts target only requested eligible providers", async () => {
  const notifications = [];
  const queryCapture = { value: null };
  const providers = [
    {
      providerId: "provider-near",
      name: "Nearby Provider",
      normalizedWhatsappNumber: "9876543210",
      serviceLatitude: 19.076,
      serviceLongitude: 72.8777,
    },
    {
      providerId: "provider-other",
      name: "Other Provider",
      normalizedWhatsappNumber: "9876543211",
      serviceLatitude: 19.08,
      serviceLongitude: 72.8777,
    },
  ];
  const service = loadNearbyService(providers, notifications, queryCapture);
  const lead = {
    enquiryId: "lead-selected-1",
    categorySlug: "painting",
    category: "Painting",
    serviceTypes: [{ serviceTypeId: "service-wall-painting", name: "Wall Painting", slug: "wall-painting" }],
    remainingUnlocks: 3,
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400064",
    marketplacePublishedAt: new Date("2026-08-28T10:00:00.000Z"),
  };

  const result = await service.dispatchSelectedNearbyLeadAlerts(
    lead,
    ["provider-near", "provider-near"],
    "employee@findoly.com",
  );

  assert.deepEqual(queryCapture.value.providerId, { $in: ["provider-near"] });
  assert.equal(result.requested, 1);
  assert.equal(result.eligible, 1);
  assert.equal(result.alerted, 1);
  assert.deepEqual(result.alertedProviderIds, ["provider-near"]);
  assert.deepEqual(result.skippedProviderIds, []);
  assert.deepEqual(notifications.map((item) => item.context.provider.providerId), ["provider-near"]);
  assert.equal(notifications[0].context.idempotencyEntityId, "lead-selected-1:provider-near");
  assert.throws(
    () => service.normalizeTargetProviderIds("provider-near"),
    /Provider selection must be a list/,
  );
});

test("automatic delivery stops after unlock while manual selected sends may resend", async () => {
  const notifications = [];
  const queryCapture = { value: null };
  const providers = [
    {
      providerId: "provider-near",
      name: "Nearby Provider",
      normalizedWhatsappNumber: "9876543210",
      serviceLatitude: 19.076,
      serviceLongitude: 72.8777,
    },
    {
      providerId: "provider-other",
      name: "Other Provider",
      normalizedWhatsappNumber: "9876543211",
      serviceLatitude: 19.08,
      serviceLongitude: 72.8777,
    },
  ];
  const service = loadNearbyService(providers, notifications, queryCapture);
  const baseLead = {
    enquiryId: "lead-auto-stop",
    categorySlug: "painting",
    category: "Painting",
    remainingUnlocks: 2,
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
    marketplacePublishedAt: new Date("2026-08-28T10:00:00.000Z"),
  };

  const stopped = await service.dispatchNearbyLeadAlerts(
    { ...baseLead, unlockedCount: 1 },
    "employee@findoly.com",
  );
  assert.equal(stopped.reason, "provider_already_unlocked");
  assert.deepEqual(stopped.alertedProviderIds, []);
  assert.equal(notifications.length, 0);

  const manual = await service.dispatchSelectedNearbyLeadAlerts(
    {
      ...baseLead,
      enquiryId: "lead-manual-resend",
      unlockedCount: 1,
      providerWhatsappAlerts: [{
        providerId: "provider-near",
        alertedAt: new Date("2026-08-28T09:30:00.000Z"),
        mode: "automatic",
      }],
    },
    ["provider-near"],
    "employee@findoly.com",
  );
  assert.equal(manual.alerted, 1);
  assert.deepEqual(manual.alertedProviderIds, ["provider-near"]);
  assert.deepEqual(notifications.map((item) => item.context.provider.providerId), ["provider-near"]);

  const automatic = await service.dispatchNearbyLeadAlerts({
    ...baseLead,
    enquiryId: "lead-auto-idempotent",
    unlockedCount: 0,
    providerWhatsappAlerts: [{
      providerId: "provider-near",
      alertedAt: new Date("2026-08-28T09:30:00.000Z"),
      mode: "manual",
    }],
  }, "employee@findoly.com");

  assert.equal(automatic.alreadyAlerted, 1);
  assert.equal(automatic.alerted, 1);
  assert.deepEqual(automatic.alertedProviderIds, ["provider-other"]);
});

test("nearby lead alerts use the requirement radius with a 20 km legacy fallback", async () => {
  const notifications = [];
  const queryCapture = { value: null };
  const providers = [
    {
      providerId: "provider-near",
      name: "Nearby Provider",
      normalizedWhatsappNumber: "9876543210",
      serviceLatitude: 19.076,
      serviceLongitude: 72.8777,
    },
    {
      providerId: "provider-far",
      name: "Far Provider",
      normalizedWhatsappNumber: "9876543211",
      serviceLatitude: 19.376,
      serviceLongitude: 72.8777,
    },
  ];
  const service = loadNearbyService(providers, notifications, queryCapture);
  const lead = {
    enquiryId: "lead-1",
    categorySlug: "painting",
    category: "Painting",
    serviceTypes: [{ serviceTypeId: "service-wall-painting", name: "Wall Painting", slug: "wall-painting" }],
    remainingUnlocks: 5,
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400064",
    marketplacePublishedAt: new Date("2026-08-02T10:00:00.000Z"),
  };

  const legacyResult = await service.dispatchNearbyLeadAlerts(lead, "qa");

  assert.equal(service.MAX_ALERT_DISTANCE_KM, 20);
  assert.equal(service.alertDistanceKmForLead(lead), 20);
  assert.equal(legacyResult.eligible, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].event, "nearby_lead_available");
  assert.equal(notifications[0].context.provider.providerId, "provider-near");
  assert.equal(notifications[0].context.skipSystemDispatch, true);
  assert.equal(notifications[0].context.idempotencyEntityId, "lead-1:provider-near");
  assert.equal(queryCapture.value.status, "active");
  assert.equal(queryCapture.value.portalAccessEnabled, true);
  assert.deepEqual(queryCapture.value.whatsappLeadAlertsEnabled, { $ne: false });
  assert.equal(queryCapture.value.categorySlugs, "painting");

  notifications.length = 0;
  const expandedLead = { ...lead, enquiryId: "lead-2", alertDistanceKm: 40 };
  const expandedResult = await service.dispatchNearbyLeadAlerts(expandedLead, "qa");
  assert.equal(service.alertDistanceKmForLead(expandedLead), 40);
  assert.equal(service.alertDistanceKmForLead({ alertDistanceKm: 101 }), 20);
  assert.equal(expandedResult.eligible, 2);
  assert.deepEqual(
    notifications.map((item) => item.context.provider.providerId).sort(),
    ["provider-far", "provider-near"],
  );

  const kmPerLatitudeDegree = 6371.0088 * Math.PI / 180;
  const exactBoundary = service.distanceKmExact(0, 0, 20 / kmPerLatitudeDegree, 0);
  assert.ok(Math.abs(exactBoundary - 20) < 1e-9);
});

test("requirement automatic nearby WhatsApp alerts are primary and not gated by a per-requirement toggle", () => {
  const enquiryModel = source("models/Enquiry.js");
  const enquiryService = source("services/enquiry/enquiry-service.js");
  const routes = source("routes/enquiry.js");

  assert.doesNotMatch(enquiryModel, /automaticWhatsappLeadAlertsEnabled/);
  assert.match(
    enquiryService,
    /remainingUnlocks > 0[\s\S]*Number\(publishedLead\.unlockedCount \|\| 0\) === 0[\s\S]*dispatchNearbyLeadAlerts\(publishedLead, actor\)/,
  );
  assert.match(enquiryService, /recordSuccessfulProviderAlerts/);
  assert.doesNotMatch(enquiryService, /async function setAutomaticWhatsappLeadAlerts/);
  assert.doesNotMatch(routes, /nearby-providers\/automatic-alerts/);
});

test("category defaults and requirement overrides expose validated alert distances", () => {
  const categoryModel = source("models/Category.js");
  const enquiryModel = source("models/Enquiry.js");
  const catalogService = source("services/catalog/catalog-service.js");
  const enquiryService = source("services/enquiry/enquiry-service.js");
  const categoryView = source("views/category/index.ejs");
  const enquiryForm = source("views/enquiry/form.ejs");

  assert.match(categoryModel, /alertDistanceKm:\s*\{ type: Number, default: 20, min: 1, max: 100 \}/);
  assert.match(enquiryModel, /alertDistanceKm:\s*\{ type: Number, default: 20, min: 1, max: 100 \}/);
  assert.match(catalogService, /label:\s*"Provider alert distance"[\s\S]*?max:\s*100/);
  assert.match(catalogService, /getCategoryAlertDistanceKm/);
  assert.match(enquiryService, /getCategoryAlertDistanceKm\(categorySlug\)/);
  assert.match(enquiryService, /alertDistanceKm:\s*numberValue\(input\.alertDistanceKm/);
  assert.match(categoryView, /Provider alert distance \(km\)/);
  assert.match(enquiryForm, /Provider alert distance \(km\)/);
  assert.match(enquiryForm, /this\.form\.alertDistanceKm = Number\(category\?\.alertDistanceKm \|\| 20\)/);
});

test("nearby lead alerts support all or selected subcategories and provider-level disable", async () => {
  const notifications = [];
  const queryCapture = { value: null };
  const baseProvider = {
    normalizedWhatsappNumber: "9876543210",
    serviceLatitude: 19.076,
    serviceLongitude: 72.8777,
  };
  const providers = [
    {
      ...baseProvider,
      providerId: "provider-legacy-all",
    },
    {
      ...baseProvider,
      providerId: "provider-explicit-all",
      whatsappLeadPreferences: [{ categorySlug: "painting", mode: "all", serviceTypeIds: [] }],
    },
    {
      ...baseProvider,
      providerId: "provider-selected-match",
      whatsappLeadPreferences: [{
        categorySlug: "painting",
        mode: "selected",
        serviceTypeIds: ["service-wall-painting", "service-interior-painting"],
      }],
    },
    {
      ...baseProvider,
      providerId: "provider-selected-miss",
      whatsappLeadPreferences: [{
        categorySlug: "painting",
        mode: "selected",
        serviceTypeIds: ["service-exterior-painting"],
      }],
    },
    {
      ...baseProvider,
      providerId: "provider-disabled",
      whatsappLeadAlertsEnabled: false,
      whatsappLeadPreferences: [{ categorySlug: "painting", mode: "all", serviceTypeIds: [] }],
    },
  ];
  const service = loadNearbyService(providers, notifications, queryCapture);
  const lead = {
    enquiryId: "lead-preference-1",
    categorySlug: "painting",
    category: "Painting",
    serviceTypes: [{ serviceTypeId: "service-wall-painting", name: "Wall Painting", slug: "wall-painting" }],
    remainingUnlocks: 5,
    locationLatitude: 19.076,
    locationLongitude: 72.8777,
    marketplacePublishedAt: new Date("2026-08-20T00:00:00.000Z"),
  };

  const result = await service.dispatchNearbyLeadAlerts(lead, "qa");
  const alertedProviderIds = notifications.map((item) => item.context.provider.providerId).sort();

  assert.deepEqual(alertedProviderIds, [
    "provider-explicit-all",
    "provider-legacy-all",
    "provider-selected-match",
  ]);
  assert.equal(result.eligible, 3);
  assert.equal(result.databaseCandidates, 4);
  assert.equal(result.subcategoryMismatch, 1);
  assert.equal(service.providerMatchesLeadPreference(providers[0], lead), true);
  assert.equal(service.providerMatchesLeadPreference(providers[2], lead), true);
  assert.equal(service.providerMatchesLeadPreference(providers[3], lead), false);
  assert.equal(service.providerMatchesLeadPreference(providers[4], lead), false);
  assert.deepEqual(service.leadServiceTypeIds({
    categorySlug: "painting",
    additionalDetails: { resolvedServiceTypeId: "service-fallback" },
  }), ["service-fallback"]);
});

test("CRM provider form and model expose WhatsApp lead alert controls without changing portal access", () => {
  const model = source("models/Provider.js");
  const providerService = source("services/provider/provider-service.js");
  const form = source("views/provider/form.ejs");
  const nearbyAlerts = source("services/communication/nearby-lead-alert-service.js");

  assert.match(model, /whatsappLeadAlertsEnabled:\s*\{ type: Boolean, default: true/);
  assert.match(model, /whatsappLeadPreferences/);
  assert.match(providerService, /WHATSAPP_LEAD_PREFERENCE_MODES = Object\.freeze\(\["all", "selected"\]\)/);
  assert.match(providerService, /assertAvailableWhatsappLeadPreferences/);
  assert.match(form, /Enable WhatsApp lead alerts/);
  assert.match(form, /All subcategories/);
  assert.match(form, /Select specific subcategories/);
  assert.match(form, /whatsappLeadPreferences/);
  assert.match(form, /Provider Portal access and lead visibility remain unchanged/);
  assert.match(nearbyAlerts, /portalAccessEnabled: true/);
  assert.match(nearbyAlerts, /whatsappLeadAlertsEnabled: \{ \$ne: false \}/);
  assert.match(nearbyAlerts, /provider_subcategory_mismatch/);
});

test("nearby lead Meta template maps service area to narrow area plus Google Maps", () => {
  const templates = source("services/communication/default-template-service.js");
  const notifications = source("services/communication/notification-service.js");
  const rules = source("services/communication/rule-service.js");

  assert.match(templates, /findoly_nearby_lead_available/);
  assert.match(templates, /Service: \{\{2\}\}/);
  assert.match(templates, /Service area: \{\{3\}\}/);
  assert.match(templates, /Requirement: \{\{4\}\}/);
  assert.match(templates, /"provider_name", "service_name", "lead_area_map", "requirement_title", "lead_url"/);
  assert.match(templates, /currentMappings\[2\] === "lead_location"/);
  assert.match(templates, /index === 2 \? "lead_area_map" : mapping/);
  assert.match(notifications, /const whatsappOnly = rule\.event === "nearby_lead_available"/);
  assert.match(notifications, /lead\.locationLocality \|\| lead\.city \|\| lead\.locationDistrict/);
  assert.match(notifications, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(notifications, /values\.lead_area_map = areaMap/);
  assert.match(notifications, /values\["3"\] = areaMap \|\| leadLocation/);
  assert.match(
    notifications,
    /values\.requirement_title = lead\.providerRequirementTitle \|\| lead\.requirementTitle \|\| lead\.serviceType \|\| "New customer requirement"/,
  );
  assert.match(rules, /const whatsappOnly = event === "nearby_lead_available"/);
  assert.match(rules, /"lead_area",[\s\S]*"lead_map_url",[\s\S]*"lead_area_map",[\s\S]*"lead_location"/);
  assert.match(rules, /const DEFAULT_NEARBY_MAPPINGS = Object\.freeze\(\[[\s\S]*"lead_area_map"/);
});

test("nearby lead rule exposes and accepts the area Maps event mapping", async () => {
  const rulePath = path.join(root, "services/communication/rule-service.js");
  delete require.cache[rulePath];
  const originalLoad = Module._load;
  const template = {
    templateId: "tpl-nearby-area-map",
    channel: "whatsapp",
    isActive: true,
    status: "approved",
    externalTemplateId: "external-template-id",
    parameterDefinitions: [
      { placeholder: "1", label: "Body {{1}}" },
      { placeholder: "2", label: "Body {{2}}" },
      { placeholder: "3", label: "Body {{3}}" },
      { placeholder: "4", label: "Body {{4}}" },
      { placeholder: "5", label: "Body {{5}}" },
    ],
    buttons: [{ index: 0, type: "QUICK_REPLY", text: "Unlock Lead" }],
  };
  Module._load = function patched(request, parent, isMain) {
    if (request === "../../models/CommunicationRule") return {};
    if (request === "../../models/CommunicationTemplate") {
      return {
        findOne() {
          return { lean: async () => template };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let ruleService;
  try {
    ruleService = require(rulePath);
  } finally {
    Module._load = originalLoad;
  }

  assert.ok(ruleService.EVENT_VARIABLES.nearby_lead_available.includes("lead_area"));
  assert.ok(ruleService.EVENT_VARIABLES.nearby_lead_available.includes("lead_map_url"));
  assert.ok(ruleService.EVENT_VARIABLES.nearby_lead_available.includes("lead_area_map"));
  assert.ok(ruleService.EVENT_VARIABLES.nearby_lead_available.includes("lead_location"));
  assert.deepEqual(ruleService.DEFAULT_NEARBY_MAPPINGS, [
    "provider_name",
    "service_name",
    "lead_area_map",
    "requirement_title",
    "lead_url",
  ]);

  const explicit = await ruleService.normalizeInput({
    name: "Nearby lead available",
    event: "nearby_lead_available",
    enabled: true,
    whatsappEnabled: true,
    whatsappTemplateId: template.templateId,
    whatsappParameterMappings: [
      "provider_name",
      "service_name",
      "lead_area_map",
      "requirement_title",
      "lead_url",
    ],
    whatsappActionType: "unlock_lead",
    whatsappActionButtonIndex: 0,
    emailEnabled: false,
  }, {});
  assert.equal(explicit.recipientSource, "provider");
  assert.deepEqual(explicit.whatsappParameterMappings, ruleService.DEFAULT_NEARBY_MAPPINGS);

  const defaults = await ruleService.normalizeInput({
    name: "Nearby lead available",
    event: "nearby_lead_available",
    enabled: true,
    whatsappEnabled: true,
    whatsappTemplateId: template.templateId,
    whatsappParameterMappings: [],
    whatsappActionType: "unlock_lead",
    whatsappActionButtonIndex: 0,
    emailEnabled: false,
  }, {});
  assert.deepEqual(defaults.whatsappParameterMappings, ruleService.DEFAULT_NEARBY_MAPPINGS);
});

test("nearby lead area mapping prefers Google locality and exact coordinates with fallbacks", () => {
  const notificationPath = path.join(root, "services/communication/notification-service.js");
  delete require.cache[notificationPath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if ([
      "../../models/CommunicationRule",
      "../../models/CommunicationTemplate",
      "./communication-service",
      "./system-event-service",
      "./default-template-service",
    ].includes(request)) return {};
    if (request === "./template-renderer") return { renderText(value) { return value; } };
    return originalLoad.call(this, request, parent, isMain);
  };
  let notificationService;
  try {
    notificationService = require(notificationPath);
  } finally {
    Module._load = originalLoad;
  }

  const exact = notificationService.variablesFor({
    event: "nearby_lead_available",
    lead: {
      enquiryId: "lead-area-1",
      category: "Pet Vaccination",
      locationLocality: "Andheri West",
      city: "Mumbai",
      locationDistrict: "Mumbai Suburban",
      pincode: "400058",
      locationLatitude: 19.1197,
      locationLongitude: 72.8468,
      providerRequirementTitle: "Home vaccination for five cats",
    },
    provider: { providerId: "provider-1", name: "Provider" },
    leadUrl: "https://provider.findoly.com/lead/lead-area-1",
  });
  assert.equal(exact.lead_area, "Andheri West, 400058");
  assert.equal(
    exact.lead_map_url,
    "https://www.google.com/maps/search/?api=1&query=19.1197%2C72.8468",
  );
  assert.equal(
    exact.lead_area_map,
    "Andheri West, 400058 https://www.google.com/maps/search/?api=1&query=19.1197%2C72.8468",
  );
  assert.equal(exact["3"], exact.lead_area_map);
  assert.equal(exact.lead_location, "Mumbai, 400058");

  const addressFallback = notificationService.variablesFor({
    event: "nearby_lead_available",
    lead: {
      locationLocality: "Andheri West",
      pincode: "400058",
      addressLine: "Andheri West, Mumbai, Maharashtra 400058, India",
    },
    provider: { providerId: "provider-1", name: "Provider" },
  });
  assert.equal(
    addressFallback.lead_map_url,
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Andheri West, Mumbai, Maharashtra 400058, India")}`,
  );

  const cityFallback = notificationService.variablesFor({
    event: "nearby_lead_available",
    lead: { city: "Mumbai", pincode: "400095" },
    provider: { providerId: "provider-1", name: "Provider" },
  });
  assert.equal(cityFallback.lead_area, "Mumbai, 400095");
  assert.equal(
    cityFallback.lead_area_map,
    "Mumbai, 400095 https://www.google.com/maps/search/?api=1&query=Mumbai%2C%20400095",
  );
});

test("contact identity production migration supports every employee-linked role", () => {
  const migration = source("scripts/backfill-contact-identities.js");
  assert.match(migration, /MIGRATION_VERSION = 2/);
  assert.match(migration, /contactidentities_migration_v2/);
  assert.match(migration, /\["agent", "provider", "employee", "provider_join_request"\]/);
  assert.match(migration, /canMergeEmployeeLinkedOwner/);
  assert.match(migration, /owner\.entityType === "employee"/);
});
