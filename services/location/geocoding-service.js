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

function normalizedLocationText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formattedAddressLocality(formattedAddress, details = {}) {
  const pincode = String(details.pincode || "").trim();
  const generic = new Set(
    [details.city, details.district, details.state, details.country]
      .map(normalizedLocationText)
      .filter(Boolean),
  );
  for (const part of String(formattedAddress || "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const withoutPincode = pincode ? part.replace(pincode, "").trim() : part;
    const normalized = normalizedLocationText(withoutPincode);
    if (!normalized || generic.has(normalized)) continue;
    if (normalized === "india") continue;
    if (pincode && normalized === normalizedLocationText(pincode)) continue;
    return withoutPincode;
  }
  return "";
}

function specificPostcodeLocalities(details = {}) {
  const pincode = String(details.pincode || "").trim();
  const city = String(details.city || "").trim();
  const district = String(details.district || "").trim();
  const state = String(details.state || "").trim();
  const country = String(details.country || "").trim();
  const generic = new Set(
    [city, district, state, country, "India", pincode]
      .map(normalizedLocationText)
      .filter(Boolean),
  );
  const candidates = [
    ...cleanTextList(details.postcodeLocalities),
    details.locality,
    formattedAddressLocality(details.formattedAddress, {
      pincode,
      city,
      district,
      state,
      country,
    }),
  ];
  const output = [];
  const seen = new Set();
  for (const value of candidates) {
    const text = String(value || "").trim();
    const normalized = normalizedLocationText(text);
    if (!text || !normalized || generic.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(text);
  }
  return output;
}

function preferredLocality(details = {}) {
  const locality = String(details.locality || "").trim();
  const city = String(details.city || "").trim();
  const district = String(details.district || "").trim();
  const state = String(details.state || "").trim();
  const country = String(details.country || "").trim();
  const generic = new Set(
    [city, district, state, country]
      .map(normalizedLocationText)
      .filter(Boolean),
  );
  if (locality && !generic.has(normalizedLocationText(locality))) return locality;
  const postcodeLocalities = specificPostcodeLocalities(details);
  return postcodeLocalities[0] || locality || city || district;
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

  const postcodeLocalities = specificPostcodeLocalities(cached);
  return {
    ...cached,
    latitude,
    longitude,
    locality: preferredLocality({
      ...cached,
      postcodeLocalities,
    }),
    postcodeLocalities,
  };
}

function safeLogMessage(value) {
  return String(value || "")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-google-api-key]")
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
    let errorBody = null;
    try {
      errorBody = await response.json();
    } catch (_error) {
      // HTTP status/statusText still provide safe diagnostics when Google sends non-JSON.
    }
    logGeocodingFailure("google_geocoding_http_failed", {
      pincode,
      httpStatus: response.status,
      googleStatus: errorBody?.status || "",
      errorMessage: errorBody?.error_message || response.statusText || "",
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
      httpStatus: response.status,
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
      httpStatus: response.status,
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
    logGeocodingFailure("google_geocoding_country_rejected", {
      pincode,
      httpStatus: response.status,
      googleStatus: body?.status || "OK",
      errorMessage: `Unexpected country code ${countryCode}`,
    });
    throw validationError("The service PIN code must be located in India");
  }

  const district = componentValue(components, ["administrative_area_level_2"]);
  const city = componentValue(components, ["locality", "administrative_area_level_3", "administrative_area_level_2"]);
  const state = componentValue(components, ["administrative_area_level_1"]);
  const country = componentValue(components, ["country"]) || "India";
  const formattedAddress = String(result?.formatted_address || "").trim().slice(0, 500);
  const rawPostcodeLocalities = cleanTextList(result?.postcode_localities);
  const componentLocality = componentValue(components, [
    "sublocality_level_5",
    "sublocality_level_4",
    "sublocality_level_3",
    "sublocality_level_2",
    "sublocality_level_1",
    "sublocality",
    "locality",
  ]);
  const postcodeLocalities = specificPostcodeLocalities({
    locality: componentLocality,
    city,
    district,
    state,
    country,
    formattedAddress,
    postcodeLocalities: rawPostcodeLocalities,
    pincode,
  });
  const data = {
    pincode,
    latitude,
    longitude,
    locality: preferredLocality({
      locality: componentLocality,
      city,
      district,
      state,
      country,
      formattedAddress,
      postcodeLocalities,
      pincode,
    }),
    district,
    city,
    state,
    country,
    formattedAddress,
    postcodeLocalities,
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

module.exports = { geocodePincode, normalizePincode, specificPostcodeLocalities };
