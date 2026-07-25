const PincodeLocation = require("../../models/PincodeLocation");

function validationError(message, status = 400, code = "PINCODE_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

function normalizePincode(value, { required = true } = {}) {
  const pincode = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (!pincode && !required) return "";
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw validationError("Enter a valid 6-digit Indian PIN code");
  }
  return pincode;
}

function componentValue(components, types = []) {
  const component = (components || []).find((item) =>
    types.some((type) => (item.types || []).includes(type)),
  );
  return component?.long_name || "";
}

async function geocodePincode(value, options = {}) {
  const pincode = normalizePincode(value, options);
  if (!pincode) return null;

  const cached = await PincodeLocation.findOne({ pincode }).lean();
  if (cached) {
    const hasCachedLatitude = cached.latitude !== null && cached.latitude !== undefined && String(cached.latitude).trim() !== "";
    const hasCachedLongitude = cached.longitude !== null && cached.longitude !== undefined && String(cached.longitude).trim() !== "";
    const cachedLatitude = Number(cached.latitude);
    const cachedLongitude = Number(cached.longitude);
    const cachedCountry = String(cached.country || "India").trim().toLowerCase();
    if (
      hasCachedLatitude &&
      hasCachedLongitude &&
      Number.isFinite(cachedLatitude) &&
      cachedLatitude >= -90 &&
      cachedLatitude <= 90 &&
      Number.isFinite(cachedLongitude) &&
      cachedLongitude >= -180 &&
      cachedLongitude <= 180 &&
      (!cachedCountry || cachedCountry === "india")
    ) {
      return { ...cached, latitude: cachedLatitude, longitude: cachedLongitude };
    }
    // Ignore corrupted or legacy cache rows and refresh them from the provider.
  }

  const key = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!key) {
    throw validationError(
      "Location verification is not configured. Please contact Findoly support.",
      503,
      "GEOCODING_NOT_CONFIGURED",
    );
  }

  const params = new URLSearchParams({
    address: `${pincode}, India`,
    components: `postal_code:${pincode}|country:IN`,
    key,
  });
  let response;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
      signal: AbortSignal.timeout(
        Math.min(Math.max(Number(process.env.GOOGLE_MAPS_TIMEOUT_MS || 8000) || 8000, 1000), 60000),
      ),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }

  if (!response.ok) {
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (_error) {
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_INVALID_RESPONSE",
    );
  }
  const result = body?.results?.[0];
  const latitude = Number(result?.geometry?.location?.lat);
  const longitude = Number(result?.geometry?.location?.lng);
  if (body?.status !== "OK" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw validationError(
      body?.status === "ZERO_RESULTS"
        ? "We could not find this Indian PIN code. Check it and try again."
        : "We could not verify this PIN code right now. Please try again shortly.",
      body?.status === "ZERO_RESULTS" ? 400 : 503,
      body?.status === "ZERO_RESULTS" ? "PINCODE_NOT_FOUND" : "GEOCODING_UNAVAILABLE",
    );
  }

  const components = result.address_components || [];
  const countryCode = (components.find((item) => (item.types || []).includes("country"))?.short_name || "").toUpperCase();
  if (countryCode && countryCode !== "IN") {
    throw validationError("The service PIN code must be located in India");
  }

  const data = {
    pincode,
    latitude,
    longitude,
    locality: componentValue(components, ["sublocality_level_1", "sublocality", "locality"]),
    district: componentValue(components, ["administrative_area_level_2"]),
    city: componentValue(components, ["locality", "administrative_area_level_3", "administrative_area_level_2"]),
    state: componentValue(components, ["administrative_area_level_1"]),
    country: componentValue(components, ["country"]) || "India",
    formattedAddress: result.formatted_address || `${pincode}, India`,
    source: "google_geocoding",
    verifiedAt: new Date(),
  };

  await PincodeLocation.updateOne(
    { pincode },
    { $set: data },
    { upsert: true },
  );
  return data;
}

module.exports = { geocodePincode, normalizePincode };
