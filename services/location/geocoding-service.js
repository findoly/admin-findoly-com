const PincodeLocation = require("../../models/PincodeLocation");

const LOCATION_ENRICHMENT_VERSION = 2;

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
  const rows = Array.isArray(components) ? components : [];
  const component = rows.find((item) =>
    item && typeof item === "object"
      && types.some((type) => (Array.isArray(item.types) ? item.types : []).includes(type)),
  );
  return String(component?.long_name || "").trim();
}

function cleanTextList(value, { maxItems = 100, maxLength = 120 } = {}) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const text = String(item || "").trim().slice(0, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function validCachedLocation(cached) {
  if (!cached || typeof cached !== "object") return null;
  const hasLatitude = cached.latitude !== null && cached.latitude !== undefined && String(cached.latitude).trim() !== "";
  const hasLongitude = cached.longitude !== null && cached.longitude !== undefined && String(cached.longitude).trim() !== "";
  const latitude = Number(cached.latitude);
  const longitude = Number(cached.longitude);
  const country = String(cached.country || "India").trim().toLowerCase();
  if (
    !hasLatitude
    || !hasLongitude
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || (country && country !== "india")
  ) return null;

  return {
    ...cached,
    latitude,
    longitude,
    postcodeLocalities: cleanTextList(cached.postcodeLocalities),
  };
}

function safeLogMessage(value) {
  return String(value || "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 1000);
}

function logGeocodingFailure(event, details = {}) {
  console.warn({
    event,
    pincode: details.pincode || "",
    ...(details.httpStatus ? { httpStatus: Number(details.httpStatus) } : {}),
    ...(details.googleStatus ? { googleStatus: String(details.googleStatus).slice(0, 80) } : {}),
    ...(details.errorMessage ? { errorMessage: safeLogMessage(details.errorMessage) } : {}),
  });
}

async function geocodePincode(value, options = {}) {
  const pincode = normalizePincode(value, options);
  if (!pincode) return null;

  const cached = await PincodeLocation.findOne({ pincode }).lean();
  const cachedLocation = validCachedLocation(cached);
  if (cachedLocation && Number(cached.enrichmentVersion || 0) >= LOCATION_ENRICHMENT_VERSION) {
    return cachedLocation;
  }

  const key = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!key) {
    if (cachedLocation) return cachedLocation;
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
    logGeocodingFailure("google_geocoding_network_failed", {
      pincode,
      errorMessage: error?.message || error,
    });
    if (cachedLocation) return cachedLocation;
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }

  if (!response.ok) {
    logGeocodingFailure("google_geocoding_http_failed", {
      pincode,
      httpStatus: response.status,
    });
    if (cachedLocation) return cachedLocation;
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_UNAVAILABLE",
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    logGeocodingFailure("google_geocoding_invalid_json", {
      pincode,
      errorMessage: error?.message || error,
    });
    if (cachedLocation) return cachedLocation;
    throw validationError(
      "We could not verify this PIN code right now. Please try again shortly.",
      503,
      "GEOCODING_INVALID_RESPONSE",
    );
  }

  const result = Array.isArray(body?.results) ? body.results[0] : null;
  const latitude = Number(result?.geometry?.location?.lat);
  const longitude = Number(result?.geometry?.location?.lng);
  if (body?.status !== "OK" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    logGeocodingFailure("google_geocoding_response_rejected", {
      pincode,
      googleStatus: body?.status || "UNKNOWN",
      errorMessage: body?.error_message || "",
    });
    if (cachedLocation) return cachedLocation;
    throw validationError(
      body?.status === "ZERO_RESULTS"
        ? "We could not find this Indian PIN code. Check it and try again."
        : "We could not verify this PIN code right now. Please try again shortly.",
      503,
      body?.status === "ZERO_RESULTS" ? "PINCODE_NOT_FOUND" : "GEOCODING_UNAVAILABLE",
    );
  }

  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const countryComponent = components.find((item) =>
    item && typeof item === "object"
      && (Array.isArray(item.types) ? item.types : []).includes("country"),
  );
  const countryCode = String(countryComponent?.short_name || "").toUpperCase();
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
    formattedAddress: String(result?.formatted_address || `${pincode}, India`).trim().slice(0, 500),
    postcodeLocalities: cleanTextList(result?.postcode_localities),
    source: "google_geocoding",
    enrichmentVersion: LOCATION_ENRICHMENT_VERSION,
    verifiedAt: new Date(),
  };

  try {
    await PincodeLocation.updateOne(
      { pincode },
      { $set: data },
      { upsert: true },
    );
  } catch (error) {
    logGeocodingFailure("geocoding_cache_write_failed", {
      pincode,
      errorMessage: error?.message || error,
    });
  }
  return data;
}

module.exports = { geocodePincode, normalizePincode };
