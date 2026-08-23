"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function loadService(providers, notifications) {
  const Provider = {
    find() {
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
      return [{ communicationId: "sent" }];
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

test("nearby alerts use additionalDetails.location when canonical coordinates are absent", async () => {
  const notifications = [];
  const providers = [{
    providerId: "provider-near",
    normalizedWhatsappNumber: "9876543210",
    serviceLatitude: 19.19,
    serviceLongitude: 72.80,
  }];
  const service = loadService(providers, notifications);
  const lead = {
    enquiryId: "lead-nested-location",
    categorySlug: "vet",
    remainingUnlocks: 5,
    alertDistanceKm: 20,
    pincode: "400095",
    additionalDetails: {
      location: {
        pincode: "400095",
        latitude: 19.1868304,
        longitude: 72.800849,
      },
    },
  };

  const result = await service.dispatchNearbyLeadAlerts(lead, "qa");

  assert.equal(result.eligible, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].context.lead.locationLatitude, 19.1868304);
  assert.equal(notifications[0].context.lead.locationLongitude, 72.800849);
  assert.equal(notifications[0].context.lead.locationSource, "additionalDetails.location");
});
