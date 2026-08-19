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
              for (const provider of providers) yield provider;
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

test("nearby lead alerts are WhatsApp-only and dispatched only at 20 km or less", async () => {
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

  const result = await service.dispatchNearbyLeadAlerts(lead, "qa");

  assert.equal(service.MAX_ALERT_DISTANCE_KM, 20);
  assert.equal(result.eligible, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].event, "nearby_lead_available");
  assert.equal(notifications[0].context.provider.providerId, "provider-near");
  assert.equal(notifications[0].context.skipSystemDispatch, true);
  assert.equal(notifications[0].context.idempotencyEntityId, "lead-1:provider-near");
  assert.equal(queryCapture.value.status, "active");
  assert.equal(queryCapture.value.portalAccessEnabled, true);
  assert.deepEqual(queryCapture.value.whatsappLeadAlertsEnabled, { $ne: false });
  assert.equal(queryCapture.value.categorySlugs, "painting");

  const kmPerLatitudeDegree = 6371.0088 * Math.PI / 180;
  const exactBoundary = service.distanceKmExact(0, 0, 20 / kmPerLatitudeDegree, 0);
  assert.ok(Math.abs(exactBoundary - 20) < 1e-9);
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
  assert.equal(result.alertsDisabled, 1);
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

test("nearby lead template contains only safe marketplace details", () => {
  const templates = source("services/communication/default-template-service.js");
  const notifications = source("services/communication/notification-service.js");
  const rules = source("services/communication/rule-service.js");

  assert.match(templates, /findoly_nearby_lead_available/);
  assert.match(templates, /Service: \{\{2\}\}/);
  assert.match(templates, /Location: \{\{3\}\}/);
  assert.match(templates, /Requirement: \{\{4\}\}/);
  assert.match(notifications, /const whatsappOnly = rule\.event === "nearby_lead_available"/);
  assert.match(rules, /const whatsappOnly = event === "nearby_lead_available"/);
  assert.doesNotMatch(templates, /Customer phone|Customer email|Exact address/i);
});

test("contact identity production migration supports every employee-linked role", () => {
  const migration = source("scripts/backfill-contact-identities.js");
  assert.match(migration, /MIGRATION_VERSION = 2/);
  assert.match(migration, /contactidentities_migration_v2/);
  assert.match(migration, /\["agent", "provider", "employee", "provider_join_request"\]/);
  assert.match(migration, /canMergeEmployeeLinkedOwner/);
  assert.match(migration, /owner\.entityType === "employee"/);
});
