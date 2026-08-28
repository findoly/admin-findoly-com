"use strict";

const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const nearbyLeadAlertService = require("../communication/nearby-lead-alert-service");
const providerAlertStateService = require("./provider-alert-state-service");
const enquiryLocationService = require("../location/enquiry-location-service");
const { identifierValue, numberValue } = require("../../utils/validation");
const { resolveRequirementLocation } = require("../../utils/requirement-location");
const { creditsFromPaise } = require("../../utils/credits");

const DEFAULT_RADIUS_KM = 20;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 100;

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function hasCoordinates(record = {}, latitudeField, longitudeField) {
  return validCoordinate(record[latitudeField], -90, 90)
    && validCoordinate(record[longitudeField], -180, 180);
}

function providerHasVerifiedCoordinates(provider = {}) {
  return String(provider.serviceLocationSource || "").trim().toLowerCase() !== "manual_pincode"
    && hasCoordinates(provider, "serviceLatitude", "serviceLongitude");
}

function defaultRadiusKmForLead(lead = {}) {
  const value = Number(lead.alertDistanceKm);
  return Number.isInteger(value) && value >= MIN_RADIUS_KM && value <= MAX_RADIUS_KM
    ? value
    : DEFAULT_RADIUS_KM;
}

function normalizeRadiusKm(value, fallback = DEFAULT_RADIUS_KM) {
  return numberValue(value, {
    label: "Nearby provider radius",
    fallback,
    min: MIN_RADIUS_KM,
    max: MAX_RADIUS_KM,
    integer: true,
  });
}

function joinLocation(...values) {
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (!output.some((item) => item.toLowerCase() === text.toLowerCase())) output.push(text);
  }
  return output.join(", ");
}

function providerLocationLabel(provider = {}) {
  const verifiedLocality = String(provider.serviceLocationSource || "").trim().toLowerCase() === "manual_pincode"
    ? ""
    : provider.serviceLocality;
  return joinLocation(
    verifiedLocality,
    provider.city,
    provider.serviceState || provider.state,
    provider.servicePincode,
  ) || "Service location";
}

function requirementLocationLabel(lead = {}) {
  const resolved = resolveRequirementLocation(lead);
  return String(resolved?.formattedAddress || lead.addressLine || "").trim()
    || joinLocation(
      lead.locationLocality,
      lead.city,
      lead.locationState || lead.state,
      resolved?.pincode || lead.locationPincode || lead.pincode,
    )
    || "Requirement location";
}

function presentLead(lead = {}) {
  const resolved = resolveRequirementLocation(lead);
  const providerWhatsappAlerts = providerAlertStateService.normalizedProviderAlerts(lead);
  const providerAlertStatus = providerAlertStateService.providerAlertSummary({
    ...lead,
    providerWhatsappAlerts,
  });
  return {
    enquiryId: lead.enquiryId || lead.id || "",
    requirementTitle: lead.requirementTitle || lead.serviceType || "Requirement",
    category: lead.category || "",
    categorySlug: lead.categorySlug || "",
    alertDistanceKm: defaultRadiusKmForLead(lead),
    automaticWhatsappLeadAlertsEnabled: lead.automaticWhatsappLeadAlertsEnabled === true,
    marketplaceStatus: lead.marketplaceStatus || "draft",
    marketplaceAvailable: lead.marketplaceAvailable === true,
    remainingUnlocks: Math.max(0, Number(lead.remainingUnlocks || 0)),
    unlockedCount: Math.max(0, Number(lead.unlockedCount || 0)),
    providerWhatsappAlerts,
    providerAlertStatus,
    ...(resolved ? {
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    } : {}),
    locationLabel: requirementLocationLabel(lead),
    locationSource: resolved?.source || lead.locationSource || "",
  };
}

function providerWhatsappAlertState(provider = {}, lead = {}) {
  const providerId = provider.providerId || provider.id || "";
  if (Number(lead.unlockedCount || 0) > 0) {
    return { eligible: false, reason: "provider_unlocked" };
  }
  if (providerAlertStateService.providerAlertFor(lead, providerId)) {
    return { eligible: false, reason: "already_alerted" };
  }
  if (provider.portalAccessEnabled === false) {
    return { eligible: false, reason: "portal_restricted" };
  }
  if (provider.whatsappLeadAlertsEnabled === false) {
    return { eligible: false, reason: "provider_alerts_disabled" };
  }
  if (!nearbyLeadAlertService.whatsappContact(provider)) {
    return { eligible: false, reason: "whatsapp_contact_missing" };
  }
  if (!nearbyLeadAlertService.providerMatchesLeadPreference(provider, lead)) {
    return { eligible: false, reason: "subcategory_not_selected" };
  }
  return { eligible: true, reason: "" };
}

function buildNearbyProviderRows(lead = {}, providers = [], radiusKm = DEFAULT_RADIUS_KM) {
  const resolved = resolveRequirementLocation(lead);
  if (!resolved) return [];
  const rows = [];
  for (const provider of providers) {
    if (!providerHasVerifiedCoordinates(provider)) continue;
    const distanceKm = nearbyLeadAlertService.distanceKmExact(
      resolved.latitude,
      resolved.longitude,
      provider.serviceLatitude,
      provider.serviceLongitude,
    );
    if (distanceKm === null || distanceKm > radiusKm) continue;
    const providerId = provider.providerId || provider.id || "";
    const existingAlert = providerAlertStateService.providerAlertFor(lead, providerId);
    const whatsappAlertState = providerWhatsappAlertState(provider, lead);
    rows.push({
      providerId,
      name: provider.name || "Provider",
      businessName: provider.businessName || "",
      status: provider.status || "active",
      portalAccessEnabled: provider.portalAccessEnabled !== false,
      city: provider.city || "",
      state: provider.serviceState || provider.state || "",
      servicePincode: provider.servicePincode || "",
      locationLabel: providerLocationLabel(provider),
      latitude: Number(provider.serviceLatitude),
      longitude: Number(provider.serviceLongitude),
      distanceKm: Number(distanceKm.toFixed(1)),
      walletBalancePaise: Math.max(0, Number(provider.walletBalancePaise || 0)),
      walletBalanceCredits: creditsFromPaise(provider.walletBalancePaise),
      whatsappAlertEligible: whatsappAlertState.eligible,
      whatsappAlertReason: whatsappAlertState.reason,
      whatsappLeadAlertsEnabled: provider.whatsappLeadAlertsEnabled !== false,
      alertAlreadySent: Boolean(existingAlert),
      alertedAt: existingAlert?.alertedAt || null,
      alertMode: existingAlert?.mode || "",
    });
  }
  return rows.sort((left, right) => left.distanceKm - right.distanceKm
    || String(left.businessName || left.name).localeCompare(String(right.businessName || right.name)));
}

function canonicalLocationPincodeMismatch(lead = {}) {
  const pincode = String(lead.pincode || "").trim();
  const locationPincode = String(lead.locationPincode || "").trim();
  return /^[1-9]\d{5}$/.test(pincode)
    && /^[1-9]\d{5}$/.test(locationPincode)
    && pincode !== locationPincode;
}

async function listNearbyProviders(enquiryId, options = {}) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  const lead = await Enquiry.findOne({ $or: [{ enquiryId: value }, { id: value }] })
    .select({
      enquiryId: 1,
      requirementTitle: 1,
      serviceType: 1,
      category: 1,
      categorySlug: 1,
      alertDistanceKm: 1,
      automaticWhatsappLeadAlertsEnabled: 1,
      providerWhatsappAlerts: 1,
      marketplaceStatus: 1,
      marketplaceAvailable: 1,
      remainingUnlocks: 1,
      unlockedCount: 1,
      serviceTypeId: 1,
      serviceTypes: 1,
      addressLine: 1,
      city: 1,
      state: 1,
      pincode: 1,
      locationLatitude: 1,
      locationLongitude: 1,
      locationPincode: 1,
      locationLocality: 1,
      locationDistrict: 1,
      locationState: 1,
      locationCountry: 1,
      locationVerifiedAt: 1,
      locationSource: 1,
      additionalDetails: 1,
      metadata: 1,
      location: 1,
      coordinates: 1,
      latitude: 1,
      longitude: 1,
      lat: 1,
      lng: 1,
      lon: 1,
    })
    .lean();
  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });

  let workingLead = lead;
  if (!resolveRequirementLocation(lead) || canonicalLocationPincodeMismatch(lead)) {
    const syncedLocation = await enquiryLocationService.syncLeadLocation(lead, {
      fillMissingDescriptive: false,
    });
    if (syncedLocation) workingLead = { ...lead, ...syncedLocation };
  }

  const fallbackRadiusKm = defaultRadiusKmForLead(workingLead);
  const radiusKm = normalizeRadiusKm(options.radiusKm, fallbackRadiusKm);
  const presentedLead = presentLead(workingLead);
  if (!resolveRequirementLocation(workingLead)) {
    return {
      lead: presentedLead,
      radiusKm,
      count: 0,
      data: [],
      reason: "lead_coordinates_missing",
    };
  }

  const providers = await Provider.find({
    status: "active",
    categorySlugs: workingLead.categorySlug,
    serviceLatitude: { $ne: null },
    serviceLongitude: { $ne: null },
    serviceLocationSource: { $ne: "manual_pincode" },
  })
    .select({
      providerId: 1,
      name: 1,
      businessName: 1,
      status: 1,
      portalAccessEnabled: 1,
      whatsappLeadAlertsEnabled: 1,
      whatsappLeadPreferences: 1,
      mobile: 1,
      normalizedMobile: 1,
      whatsappNumber: 1,
      normalizedWhatsappNumber: 1,
      walletBalancePaise: 1,
      city: 1,
      state: 1,
      servicePincode: 1,
      serviceLatitude: 1,
      serviceLongitude: 1,
      serviceLocality: 1,
      serviceState: 1,
      serviceLocationSource: 1,
    })
    .lean();

  const data = buildNearbyProviderRows(workingLead, providers, radiusKm);
  const eligibleCount = data.filter((provider) => provider.whatsappAlertEligible).length;
  return {
    lead: presentedLead,
    radiusKm,
    count: data.length,
    eligibleCount,
    data,
    reason: !data.length
      ? "no_providers_in_radius"
      : eligibleCount === 0
        ? "no_eligible_providers"
        : "",
  };
}

async function sendSelectedProviderAlerts(enquiryId, input = {}, actor = "admin") {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  const providerIds = nearbyLeadAlertService.normalizeTargetProviderIds(input.providerIds);
  if (!providerIds.length) {
    throw Object.assign(new Error("Select at least one provider for WhatsApp alert"), { status: 400 });
  }

  let lead = await Enquiry.findOne({ $or: [{ enquiryId: value }, { id: value }] }).lean();
  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
  if (Number(lead.unlockedCount || 0) > 0) {
    throw Object.assign(new Error("Provider alerts are stopped because this requirement has already been unlocked"), { status: 409 });
  }
  if (
    lead.marketplaceAvailable !== true
    || String(lead.marketplaceStatus || "").toLowerCase() !== "published"
    || Number(lead.remainingUnlocks || 0) <= 0
  ) {
    throw Object.assign(new Error("This requirement is not currently available to providers"), { status: 409 });
  }

  const alreadyAlertedProviderIds = providerIds.filter((providerId) =>
    Boolean(providerAlertStateService.providerAlertFor(lead, providerId)));
  const providerIdsToSend = providerIds.filter((providerId) =>
    !alreadyAlertedProviderIds.includes(providerId));
  if (!providerIdsToSend.length) {
    throw Object.assign(new Error("The selected provider has already received this WhatsApp alert"), { status: 409 });
  }

  if (!resolveRequirementLocation(lead) || canonicalLocationPincodeMismatch(lead)) {
    const syncedLocation = await enquiryLocationService.syncLeadLocation(lead, {
      fillMissingDescriptive: false,
    });
    if (syncedLocation) lead = { ...lead, ...syncedLocation };
  }

  const result = await nearbyLeadAlertService.dispatchSelectedNearbyLeadAlerts(
    lead,
    providerIdsToSend,
    actor,
  );
  if (Array.isArray(result.alertedProviderIds) && result.alertedProviderIds.length) {
    await providerAlertStateService.recordSuccessfulProviderAlerts(
      lead.enquiryId || lead.id,
      result.alertedProviderIds,
      { mode: "manual", actor },
    );
  }
  return {
    ...result,
    alreadyAlertedProviderIds,
  };
}

module.exports = {
  DEFAULT_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  validCoordinate,
  hasCoordinates,
  providerHasVerifiedCoordinates,
  defaultRadiusKmForLead,
  normalizeRadiusKm,
  providerLocationLabel,
  requirementLocationLabel,
  providerWhatsappAlertState,
  presentLead,
  buildNearbyProviderRows,
  listNearbyProviders,
  sendSelectedProviderAlerts,
};
