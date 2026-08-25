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

function sameTextList(left, right) {
  const first = cleanLocalities(left);
  const second = cleanLocalities(right);
  if (first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}

function hasOwn(object, field) {
  return Boolean(object)
    && typeof object === "object"
    && Object.prototype.hasOwnProperty.call(object, field);
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
  { pincodeChanged = false, previousProvider = {}, submittedProvider = {} } = {},
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
    const previousCity = cleanText(previousProvider?.city, 100);
    const previousState = cleanText(previousProvider?.state, 100);
    const previousAddress = cleanText(previousProvider?.serviceAddress, 500);
    const previousAreas = cleanLocalities(previousProvider?.serviceAreas);
    const providerCity = cleanText(provider?.city, 100);
    const providerState = cleanText(provider?.state, 100);
    const providerAddress = cleanText(provider?.serviceAddress, 500);
    const providerAreas = cleanLocalities(provider?.serviceAreas);
    const submittedCity = cleanText(submittedProvider?.city, 100);
    const submittedState = cleanText(submittedProvider?.state, 100);
    const submittedAddress = cleanText(submittedProvider?.serviceAddress, 500);
    const submittedAreas = cleanLocalities(submittedProvider?.serviceAreas);
    const hasPrevious = Boolean(previousProvider?.providerId || previousProvider?.id);

    const submittedCityChanged = hasOwn(submittedProvider, "city")
      && submittedCity
      && (!hasPrevious || submittedCity !== previousCity);
    const submittedStateChanged = hasOwn(submittedProvider, "state")
      && submittedState
      && (!hasPrevious || submittedState !== previousState);
    const submittedAddressChanged = hasOwn(submittedProvider, "serviceAddress")
      && (!hasPrevious || submittedAddress !== previousAddress);
    const submittedAreasChanged = hasOwn(submittedProvider, "serviceAreas")
      && (!hasPrevious || !sameTextList(submittedAreas, previousAreas));

    if (submittedCityChanged) {
      if (providerCity !== submittedCity) update.city = submittedCity;
    } else if (city && (!providerCity || (pincodeChanged && providerCity === previousCity))) {
      update.city = city;
    }

    if (submittedStateChanged) {
      if (providerState !== submittedState) update.state = submittedState;
    } else if (state && (!providerState || (pincodeChanged && providerState === previousState))) {
      update.state = state;
    }

    if (!submittedAddressChanged && formattedAddress) {
      const stalePreviousAddress = pincodeChanged && providerAddress === previousAddress;
      const neverHadAddress = !providerAddress && !previousAddress;
      if (stalePreviousAddress || neverHadAddress) update.serviceAddress = formattedAddress;
    }

    if (!submittedAreasChanged && postcodeLocalities.length) {
      const stalePreviousAreas = pincodeChanged && sameTextList(providerAreas, previousAreas);
      const neverHadAreas = !providerAreas.length && !previousAreas.length;
      if (stalePreviousAreas || neverHadAreas) update.serviceAreas = postcodeLocalities;
    }

    const googleCoordinatesValid = validCoordinate(location?.latitude, -90, 90)
      && validCoordinate(location?.longitude, -180, 180);
    const providerCoordinatesValid = validCoordinate(provider.serviceLatitude, -90, 90)
      && validCoordinate(provider.serviceLongitude, -180, 180);
    const providerLocationSource = cleanText(provider.serviceLocationSource, 80).toLowerCase();
    const providerCoordinatesVerified = providerCoordinatesValid && providerLocationSource !== "manual_pincode";
    if (googleCoordinatesValid) {
      if (pincodeChanged || !providerCoordinatesVerified) {
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
