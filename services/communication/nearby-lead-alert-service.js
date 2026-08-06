"use strict";

const Provider = require("../../models/Provider");
const notificationService = require("./notification-service");

const MAX_ALERT_DISTANCE_KM = 20;
const BATCH_SIZE = Math.min(100, Math.max(5, Number(process.env.CRM_NEARBY_LEAD_ALERT_BATCH_SIZE || 25)));

function distanceKmExact(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(values[2] - values[0]);
  const longitudeDelta = toRadians(values[3] - values[1]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(values[0])) * Math.cos(toRadians(values[2]))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoordinates(record = {}, latitudeField, longitudeField) {
  return [record[latitudeField], record[longitudeField]].every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
}


function providerLeadUrl(enquiryId) {
  const rawBase = process.env.PROVIDER_PORTAL_BASE_URL
    || process.env.PROVIDER_PORTAL_MARKETPLACE_URL
    || process.env.PROVIDER_PORTAL_LOGIN_URL
    || "https://provider.findoly.com";
  try {
    const url = new URL(rawBase);
    url.pathname = `/lead/${encodeURIComponent(String(enquiryId || ""))}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return `https://provider.findoly.com/lead/${encodeURIComponent(String(enquiryId || ""))}`;
  }
}

function whatsappContact(provider = {}) {
  return provider.normalizedWhatsappNumber
    || provider.whatsappNumber
    || provider.normalizedMobile
    || provider.mobile
    || "";
}

async function dispatchNearbyLeadAlerts(lead, actor = "system") {
  if (!lead || !lead.enquiryId || !lead.categorySlug || Number(lead.remainingUnlocks || 0) <= 0) {
    return { eligible: 0, alerted: 0, skipped: 0 };
  }
  if (!hasCoordinates(lead, "locationLatitude", "locationLongitude")) {
    return { eligible: 0, alerted: 0, skipped: 0, reason: "lead_coordinates_missing" };
  }

  const query = {
    status: "active",
    portalAccessEnabled: true,
    categorySlugs: lead.categorySlug,
    serviceLatitude: { $ne: null },
    serviceLongitude: { $ne: null },
    $or: [
      { normalizedWhatsappNumber: { $exists: true, $gt: "" } },
      { whatsappNumber: { $exists: true, $gt: "" } },
      { normalizedMobile: { $exists: true, $gt: "" } },
      { mobile: { $exists: true, $gt: "" } },
    ],
  };
  const cursor = Provider.find(query)
    .select({
      providerId: 1, name: 1, businessName: 1, mobile: 1, normalizedMobile: 1,
      whatsappNumber: 1, normalizedWhatsappNumber: 1, email: 1, categorySlugs: 1,
      city: 1, state: 1, serviceLatitude: 1, serviceLongitude: 1,
    })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let eligible = 0;
  let alerted = 0;
  let skipped = 0;
  const pending = [];
  const flush = async () => {
    const rows = pending.splice(0, pending.length);
    const results = await Promise.all(rows.map(async ({ provider, distanceKm }) => {
      const output = await notificationService.triggerSafe("nearby_lead_available", {
        event: "nearby_lead_available",
        trigger: "nearby_lead_available",
        lead,
        provider,
        distanceKm,
        leadUrl: providerLeadUrl(lead.enquiryId),
        marketplaceUrl: providerLeadUrl(lead.enquiryId),
        idempotencyEntityId: `${lead.enquiryId}:${provider.providerId}`,
        idempotencySuffix: lead.marketplacePublishedAt || lead.updatedAt || lead.createdAt,
        skipSystemDispatch: true,
      }, actor);
      return output.length > 0;
    }));
    alerted += results.filter(Boolean).length;
    skipped += results.filter((value) => !value).length;
  };

  for await (const provider of cursor) {
    if (!whatsappContact(provider) || !hasCoordinates(provider, "serviceLatitude", "serviceLongitude")) continue;
    const distanceKm = distanceKmExact(
      provider.serviceLatitude,
      provider.serviceLongitude,
      lead.locationLatitude,
      lead.locationLongitude,
    );
    if (distanceKm === null || distanceKm > MAX_ALERT_DISTANCE_KM) continue;
    eligible += 1;
    pending.push({ provider, distanceKm });
    if (pending.length >= BATCH_SIZE) await flush();
  }
  if (pending.length) await flush();
  return { eligible, alerted, skipped };
}

module.exports = {
  MAX_ALERT_DISTANCE_KM,
  distanceKmExact,
  providerLeadUrl,
  whatsappContact,
  dispatchNearbyLeadAlerts,
};
