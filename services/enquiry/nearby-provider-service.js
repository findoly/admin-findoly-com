"use strict";

const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const nearbyLeadAlertService = require("../communication/nearby-lead-alert-service");
const { identifierValue, numberValue } = require("../../utils/validation");

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
  return joinLocation(
    provider.serviceLocality,
    provider.city,
    provider.serviceState || provider.state,
    provider.servicePincode,
  ) || "Service location";
}

function requirementLocationLabel(lead = {}) {
  return String(lead.addressLine || "").trim()
    || joinLocation(
      lead.locationLocality,
      lead.city,
      lead.locationState || lead.state,
      lead.locationPincode || lead.pincode,
    )
    || "Requirement location";
}

function presentLead(lead = {}) {
  return {
    enquiryId: lead.enquiryId || lead.id || "",
    requirementTitle: lead.requirementTitle || lead.serviceType || "Requirement",
    category: lead.category || "",
    categorySlug: lead.categorySlug || "",
    alertDistanceKm: defaultRadiusKmForLead(lead),
    latitude: hasCoordinates(lead, "locationLatitude", "locationLongitude")
      ? Number(lead.locationLatitude)
      : null,
    longitude: hasCoordinates(lead, "locationLatitude", "locationLongitude")
      ? Number(lead.locationLongitude)
      : null,
    locationLabel: requirementLocationLabel(lead),
    locationSource: lead.locationSource || "",
  };
}

function buildNearbyProviderRows(lead = {}, providers = [], radiusKm = DEFAULT_RADIUS_KM) {
  if (!hasCoordinates(lead, "locationLatitude", "locationLongitude")) return [];
  const rows = [];
  for (const provider of providers) {
    if (!hasCoordinates(provider, "serviceLatitude", "serviceLongitude")) continue;
    const distanceKm = nearbyLeadAlertService.distanceKmExact(
      lead.locationLatitude,
      lead.locationLongitude,
      provider.serviceLatitude,
      provider.serviceLongitude,
    );
    if (distanceKm === null || distanceKm > radiusKm) continue;
    rows.push({
      providerId: provider.providerId || provider.id || "",
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
    });
  }
  return rows.sort((left, right) => left.distanceKm - right.distanceKm
    || String(left.businessName || left.name).localeCompare(String(right.businessName || right.name)));
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
      addressLine: 1,
      city: 1,
      state: 1,
      pincode: 1,
      locationLatitude: 1,
      locationLongitude: 1,
      locationPincode: 1,
      locationLocality: 1,
      locationState: 1,
      locationSource: 1,
    })
    .lean();
  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });

  const fallbackRadiusKm = defaultRadiusKmForLead(lead);
  const radiusKm = normalizeRadiusKm(options.radiusKm, fallbackRadiusKm);
  const presentedLead = presentLead(lead);
  if (presentedLead.latitude === null || presentedLead.longitude === null) {
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
    categorySlugs: lead.categorySlug,
    serviceLatitude: { $ne: null },
    serviceLongitude: { $ne: null },
  })
    .select({
      providerId: 1,
      name: 1,
      businessName: 1,
      status: 1,
      portalAccessEnabled: 1,
      city: 1,
      state: 1,
      servicePincode: 1,
      serviceLatitude: 1,
      serviceLongitude: 1,
      serviceLocality: 1,
      serviceState: 1,
    })
    .lean();

  const data = buildNearbyProviderRows(lead, providers, radiusKm);
  return {
    lead: presentedLead,
    radiusKm,
    count: data.length,
    data,
    reason: data.length ? "" : "no_providers_in_radius",
  };
}

module.exports = {
  DEFAULT_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  validCoordinate,
  hasCoordinates,
  defaultRadiusKmForLead,
  normalizeRadiusKm,
  providerLocationLabel,
  requirementLocationLabel,
  presentLead,
  buildNearbyProviderRows,
  listNearbyProviders,
};
