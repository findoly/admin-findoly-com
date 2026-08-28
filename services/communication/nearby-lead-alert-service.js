"use strict";

const Provider = require("../../models/Provider");
const notificationService = require("./notification-service");
const { resolveRequirementLocation } = require("../../utils/requirement-location");

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

function hasVerifiedProviderCoordinates(provider = {}) {
  return String(provider.serviceLocationSource || "").trim().toLowerCase() !== "manual_pincode"
    && hasCoordinates(provider, "serviceLatitude", "serviceLongitude");
}

function alertDistanceKmForLead(lead = {}) {
  const value = Number(lead.alertDistanceKm);
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : MAX_ALERT_DISTANCE_KM;
}

function leadServiceTypeIds(lead = {}) {
  const values = [];
  for (const item of Array.isArray(lead.serviceTypes) ? lead.serviceTypes : []) {
    const value = item && typeof item === "object"
      ? item.serviceTypeId || item.id
      : item;
    if (value) values.push(String(value));
  }
  for (const value of [
    lead.serviceTypeId,
    lead.additionalDetails?.resolvedServiceTypeId,
    lead.additionalDetails?.serviceTypeId,
  ]) {
    if (value) values.push(String(value));
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function providerMatchesLeadPreference(provider = {}, lead = {}) {
  if (provider.whatsappLeadAlertsEnabled === false) return false;
  const categorySlug = String(lead.categorySlug || "");
  const preference = (Array.isArray(provider.whatsappLeadPreferences)
    ? provider.whatsappLeadPreferences
    : []).find((item) => String(item?.categorySlug || "") === categorySlug);

  // Backward compatibility: providers without an explicit preference for a
  // category continue receiving all subcategories for that assigned category.
  if (!preference || preference.mode !== "selected") return true;

  const selected = new Set(
    (Array.isArray(preference.serviceTypeIds) ? preference.serviceTypeIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!selected.size) return false;

  const leadIds = leadServiceTypeIds(lead);
  if (!leadIds.length) return false;
  return leadIds.some((serviceTypeId) => selected.has(serviceTypeId));
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

function normalizeTargetProviderIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw Object.assign(new Error("Provider selection must be a list"), { status: 400 });
  }
  if (value.length > 50) {
    throw Object.assign(new Error("Select at most 50 providers for one WhatsApp alert action"), { status: 400 });
  }
  const ids = [];
  for (const entry of value) {
    const providerId = String(entry || "").trim();
    if (!providerId || providerId.length > 120 || /[\0\r\n]/.test(providerId)) {
      throw Object.assign(new Error("Provider selection contains an invalid provider ID"), { status: 400 });
    }
    if (!ids.includes(providerId)) ids.push(providerId);
  }
  return ids;
}

async function dispatchNearbyLeadAlerts(lead, actor = "system", options = {}) {
  const startedAt = process.hrtime.bigint();
  const leadId = String(lead?.enquiryId || "");
  const radiusKm = alertDistanceKmForLead(lead);
  const targetProviderIds = normalizeTargetProviderIds(options.providerIds);
  const targeted = targetProviderIds.length > 0;
  const previouslyAlertedProviderIds = new Set(
    (Array.isArray(lead?.providerWhatsappAlerts) ? lead.providerWhatsappAlerts : [])
      .map((entry) => String(entry?.providerId || "").trim())
      .filter(Boolean),
  );
  const resolvedLocation = resolveRequirementLocation(lead || {});
  const effectiveLead = resolvedLocation
    ? {
        ...lead,
        locationLatitude: resolvedLocation.latitude,
        locationLongitude: resolvedLocation.longitude,
        locationPincode: lead?.locationPincode || resolvedLocation.pincode || lead?.pincode || "",
        locationSource: lead?.locationSource || resolvedLocation.source,
      }
    : lead;
  console.info({
    event: "nearby_alert_dispatch_started",
    enquiryId: leadId,
    categorySlug: String(lead?.categorySlug || ""),
    serviceTypeIds: leadServiceTypeIds(lead || {}),
    remainingUnlocks: Number(lead?.remainingUnlocks || 0),
    unlockedCount: Number(lead?.unlockedCount || 0),
    radiusKm,
    targeted,
    requestedProviderCount: targetProviderIds.length,
    previouslyAlertedProviderCount: previouslyAlertedProviderIds.size,
    coordinatesAvailable: Boolean(resolvedLocation),
    coordinateSource: resolvedLocation?.source || "",
  });
  if (
    !lead
    || !lead.enquiryId
    || !lead.categorySlug
    || Number(lead.unlockedCount || 0) > 0
    || Number(lead.remainingUnlocks || 0) <= 0
  ) {
    const reason = !lead?.enquiryId
      ? "lead_id_missing"
      : !lead?.categorySlug
        ? "lead_category_missing"
        : Number(lead?.unlockedCount || 0) > 0
          ? "provider_already_unlocked"
          : "remaining_unlocks_zero";
    console.warn({ event: "nearby_alert_dispatch_skipped", enquiryId: leadId, reason });
    return { eligible: 0, alerted: 0, skipped: 0, alertedProviderIds: [], reason };
  }
  if (!resolvedLocation) {
    console.warn({
      event: "nearby_alert_dispatch_skipped",
      enquiryId: leadId,
      reason: "lead_coordinates_missing",
    });
    return { eligible: 0, alerted: 0, skipped: 0, alertedProviderIds: [], reason: "lead_coordinates_missing" };
  }

  const query = {
    status: "active",
    portalAccessEnabled: true,
    whatsappLeadAlertsEnabled: { $ne: false },
    categorySlugs: lead.categorySlug,
    serviceLatitude: { $ne: null },
    serviceLongitude: { $ne: null },
    serviceLocationSource: { $ne: "manual_pincode" },
    $or: [
      { normalizedWhatsappNumber: { $exists: true, $gt: "" } },
      { whatsappNumber: { $exists: true, $gt: "" } },
      { normalizedMobile: { $exists: true, $gt: "" } },
      { mobile: { $exists: true, $gt: "" } },
    ],
  };
  if (targeted) query.providerId = { $in: targetProviderIds };
  const cursor = Provider.find(query)
    .select({
      providerId: 1, name: 1, businessName: 1, mobile: 1, normalizedMobile: 1,
      whatsappNumber: 1, normalizedWhatsappNumber: 1, email: 1, categorySlugs: 1,
      whatsappLeadAlertsEnabled: 1, whatsappLeadPreferences: 1,
      city: 1, state: 1, serviceLatitude: 1, serviceLongitude: 1, serviceLocationSource: 1,
    })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let eligible = 0;
  let alerted = 0;
  let skipped = 0;
  let databaseCandidates = 0;
  let outsideRadius = 0;
  let invalidDistance = 0;
  let missingContactOrCoordinates = 0;
  let subcategoryMismatch = 0;
  let alreadyAlerted = 0;
  const seenProviderIds = new Set();
  const alertedProviderIds = [];
  const skippedProviderIds = new Set();
  const pending = [];
  const flush = async () => {
    const rows = pending.splice(0, pending.length);
    const results = await Promise.all(rows.map(async ({ provider, distanceKm }) => {
      const output = await notificationService.triggerSafe("nearby_lead_available", {
        event: "nearby_lead_available",
        trigger: "nearby_lead_available",
        lead: effectiveLead,
        provider,
        distanceKm,
        leadUrl: providerLeadUrl(effectiveLead.enquiryId),
        marketplaceUrl: providerLeadUrl(effectiveLead.enquiryId),
        idempotencyEntityId: `${effectiveLead.enquiryId}:${provider.providerId}`,
        idempotencySuffix: effectiveLead.marketplacePublishedAt || effectiveLead.updatedAt || effectiveLead.createdAt,
        skipSystemDispatch: true,
      }, actor);
      return {
        providerId: String(provider.providerId || ""),
        sent: output.length > 0,
      };
    }));
    for (const result of results) {
      if (result.sent) {
        alerted += 1;
        if (result.providerId) alertedProviderIds.push(result.providerId);
      } else {
        skipped += 1;
        if (result.providerId) skippedProviderIds.add(result.providerId);
      }
    }
  };

  for await (const provider of cursor) {
    databaseCandidates += 1;
    const providerId = String(provider.providerId || "");
    if (providerId) seenProviderIds.add(providerId);
    if (providerId && previouslyAlertedProviderIds.has(providerId)) {
      alreadyAlerted += 1;
      if (targeted) skippedProviderIds.add(providerId);
      continue;
    }
    if (!providerMatchesLeadPreference(provider, effectiveLead)) {
      subcategoryMismatch += 1;
      if (providerId) skippedProviderIds.add(providerId);
      console.debug({
        event: "nearby_alert_provider_skipped",
        enquiryId: effectiveLead.enquiryId,
        providerId: provider.providerId || "",
        reason: "provider_subcategory_mismatch",
      });
      continue;
    }
    if (!whatsappContact(provider) || !hasVerifiedProviderCoordinates(provider)) {
      missingContactOrCoordinates += 1;
      if (providerId) skippedProviderIds.add(providerId);
      console.debug({
        event: "nearby_alert_provider_skipped",
        enquiryId: effectiveLead.enquiryId,
        providerId: provider.providerId || "",
        reason: !whatsappContact(provider) ? "provider_mobile_missing" : "provider_coordinates_missing",
      });
      continue;
    }
    const distanceKm = distanceKmExact(
      provider.serviceLatitude,
      provider.serviceLongitude,
      resolvedLocation.latitude,
      resolvedLocation.longitude,
    );
    if (distanceKm === null) {
      invalidDistance += 1;
      if (providerId) skippedProviderIds.add(providerId);
      continue;
    }
    if (distanceKm > radiusKm) {
      outsideRadius += 1;
      if (providerId) skippedProviderIds.add(providerId);
      continue;
    }
    eligible += 1;
    pending.push({ provider, distanceKm });
    if (pending.length >= BATCH_SIZE) await flush();
  }
  if (pending.length) await flush();
  if (targeted) {
    for (const providerId of targetProviderIds) {
      if (!seenProviderIds.has(providerId) && !alertedProviderIds.includes(providerId)) {
        skippedProviderIds.add(providerId);
      }
    }
  }
  const durationMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
  const result = {
    eligible,
    alerted,
    skipped,
    databaseCandidates,
    outsideRadius,
    invalidDistance,
    missingContactOrCoordinates,
    subcategoryMismatch,
    alreadyAlerted,
    alertedProviderIds,
    ...(targeted ? {
      requested: targetProviderIds.length,
      skippedProviderIds: [...skippedProviderIds],
    } : {}),
  };
  console.info({
    event: "nearby_alert_provider_scan_completed",
    enquiryId: effectiveLead.enquiryId,
    radiusKm,
    coordinateSource: resolvedLocation.source,
    ...result,
  });
  console.info({
    event: "nearby_alert_dispatch_completed",
    enquiryId: effectiveLead.enquiryId,
    ...result,
    durationMs,
  });
  return result;
}

async function dispatchSelectedNearbyLeadAlerts(lead, providerIds, actor = "system") {
  const normalizedProviderIds = normalizeTargetProviderIds(providerIds);
  if (!normalizedProviderIds.length) {
    throw Object.assign(new Error("Select at least one provider for WhatsApp alert"), { status: 400 });
  }
  return dispatchNearbyLeadAlerts(lead, actor, { providerIds: normalizedProviderIds });
}

module.exports = {
  MAX_ALERT_DISTANCE_KM,
  distanceKmExact,
  hasVerifiedProviderCoordinates,
  alertDistanceKmForLead,
  leadServiceTypeIds,
  providerMatchesLeadPreference,
  providerLeadUrl,
  whatsappContact,
  normalizeTargetProviderIds,
  dispatchNearbyLeadAlerts,
  dispatchSelectedNearbyLeadAlerts,
};
