"use strict";

const Provider = require("../../models/Provider");
const { geocodePincode } = require("../location/geocoding-service");

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanLocalities(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const text = cleanText(item, 120);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 100) break;
  }
  return output;
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

async function persistProviderLocation(providerId, provider, update) {
  const result = await Provider.updateOne(
    { $or: [{ providerId }, { id: providerId }] },
    { $set: { ...update, updatedAt: new Date() } },
  );
  return result.matchedCount ? { ...provider, ...update } : provider;
}

async function enrichProviderLocation(
  provider = {},
  { pincodeChanged = false, previousProvider = {} } = {},
) {
  const providerId = cleanText(provider.providerId || provider.id, 128);
  const pincode = cleanText(provider.servicePincode, 6);
  if (!providerId || !/^[1-9]\d{5}$/.test(pincode)) return provider;

  try {
    const location = await geocodePincode(pincode);
    const postcodeLocalities = cleanLocalities(location?.postcodeLocalities);
    const update = {};

    const city = cleanText(location?.city || location?.locality || location?.district, 100);
    const state = cleanText(location?.state, 100);
    const formattedAddress = cleanText(location?.formattedAddress, 500);
    const previousAddress = cleanText(previousProvider?.serviceAddress, 500);
    const previousAreas = cleanLocalities(previousProvider?.serviceAreas);
    const providerAreas = cleanLocalities(provider?.serviceAreas);

    if (city && (pincodeChanged || !cleanText(provider.city, 100))) update.city = city;
    if (state && (pincodeChanged || !cleanText(provider.state, 100))) update.state = state;
    if (
      formattedAddress
      && (pincodeChanged || (!cleanText(provider.serviceAddress, 500) && !previousAddress))
    ) {
      update.serviceAddress = formattedAddress;
    }
    if (
      postcodeLocalities.length
      && (pincodeChanged || (!providerAreas.length && !previousAreas.length))
    ) {
      update.serviceAreas = postcodeLocalities;
    }

    const googleCoordinatesValid = validCoordinate(location?.latitude, -90, 90)
      && validCoordinate(location?.longitude, -180, 180);
    const providerCoordinatesValid = validCoordinate(provider.serviceLatitude, -90, 90)
      && validCoordinate(provider.serviceLongitude, -180, 180);
    if (googleCoordinatesValid) {
      if (pincodeChanged || !providerCoordinatesValid) {
        update.serviceLatitude = Number(location.latitude);
        update.serviceLongitude = Number(location.longitude);
        update.serviceLocationVerifiedAt = location.verifiedAt || new Date();
        update.serviceLocationSource = location.source || "google_geocoding";
      }
      if (pincodeChanged || !cleanText(provider.serviceLocality, 120)) {
        update.serviceLocality = location.locality || "";
      }
      if (pincodeChanged || !cleanText(provider.serviceDistrict, 120)) {
        update.serviceDistrict = location.district || "";
      }
      if (pincodeChanged || !cleanText(provider.serviceState, 100)) {
        update.serviceState = location.state || provider.serviceState || provider.state || "";
      }
      if (pincodeChanged || !cleanText(provider.serviceCountry, 100)) {
        update.serviceCountry = location.country || "India";
      }
    }

    if (!Object.keys(update).length) return provider;
    return persistProviderLocation(providerId, provider, update);
  } catch (error) {
    console.warn({
      event: "provider_location_enrichment_failed",
      providerId,
      pincode,
      code: String(error.code || "GEOCODING_UNAVAILABLE"),
      message: String(error.message || error).slice(0, 1000),
    });
    if (!pincodeChanged) return provider;

    const fallback = {
      serviceLatitude: null,
      serviceLongitude: null,
      serviceLocality: "",
      serviceDistrict: "",
      serviceState: provider.state || "",
      serviceCountry: "India",
      serviceLocationVerifiedAt: null,
      serviceLocationSource: "manual_pincode",
    };
    try {
      return await persistProviderLocation(providerId, provider, fallback);
    } catch (persistError) {
      console.warn({
        event: "provider_location_fallback_save_failed",
        providerId,
        pincode,
        code: String(persistError.code || "LOCATION_SAVE_FAILED"),
        message: String(persistError.message || persistError).slice(0, 1000),
      });
      return { ...provider, ...fallback };
    }
  }
}

module.exports = { enrichProviderLocation };
