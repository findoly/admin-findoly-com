"use strict";

const PINCODE_PATTERN = /^[1-9]\d{5}$/;

function numericCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function textValue(value) {
  return String(value || "").trim();
}

function pincodeValue(value) {
  const normalized = textValue(value);
  return PINCODE_PATTERN.test(normalized) ? normalized : "";
}

function coordinatePair(container = {}) {
  if (!container || typeof container !== "object") return null;
  const aliases = [
    ["latitude", "longitude"],
    ["lat", "lng"],
    ["lat", "lon"],
    ["latitude", "lng"],
    ["latitude", "lon"],
  ];
  for (const [latitudeField, longitudeField] of aliases) {
    const latitude = numericCoordinate(container[latitudeField], -90, 90);
    const longitude = numericCoordinate(container[longitudeField], -180, 180);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  }
  return null;
}

function formattedAddress(container = {}) {
  if (!container || typeof container !== "object") return "";
  return textValue(
    container.formattedAddress
      || container.formatted_address
      || container.address
      || container.label,
  );
}

function candidate(source, container, options = {}) {
  const pair = coordinatePair(container);
  if (!pair) return null;
  return {
    ...pair,
    source,
    pincode: pincodeValue(
      container?.pincode
        || container?.postalCode
        || container?.postal_code
        || options.pincode,
    ),
    formattedAddress: formattedAddress(container) || textValue(options.formattedAddress),
  };
}

function resolveRequirementLocation(record = {}) {
  if (!record || typeof record !== "object") return null;

  const recordPincode = pincodeValue(record.pincode);
  const canonicalPincode = pincodeValue(record.locationPincode);
  const canonicalSource = textValue(record.locationSource).toLowerCase();
  const canonicalLatitude = numericCoordinate(record.locationLatitude, -90, 90);
  const canonicalLongitude = numericCoordinate(record.locationLongitude, -180, 180);
  const canonicalPincodeMatches = !recordPincode || !canonicalPincode || recordPincode === canonicalPincode;
  const canonicalSourceIsVerified = canonicalSource !== "manual_pincode";
  if (
    canonicalLatitude !== null
    && canonicalLongitude !== null
    && canonicalPincodeMatches
    && canonicalSourceIsVerified
  ) {
    return {
      latitude: canonicalLatitude,
      longitude: canonicalLongitude,
      source: "canonical",
      pincode: canonicalPincode || recordPincode,
      formattedAddress: textValue(record.addressLine),
    };
  }

  const additionalDetails = record.additionalDetails && typeof record.additionalDetails === "object"
    ? record.additionalDetails
    : {};
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata
    : {};

  const candidates = [
    ["additionalDetails.location", additionalDetails.location],
    ["metadata.location", metadata.location],
    ["location", record.location],
    ["additionalDetails.coordinates", additionalDetails.coordinates],
    ["metadata.coordinates", metadata.coordinates],
    ["coordinates", record.coordinates],
    ["additionalDetails", additionalDetails],
    ["metadata", metadata],
    ["record", record],
  ];

  for (const [source, container] of candidates) {
    const resolved = candidate(source, container, {
      pincode: record.pincode,
      formattedAddress: record.addressLine,
    });
    if (!resolved) continue;
    if (recordPincode && resolved.pincode && resolved.pincode !== recordPincode) continue;
    return resolved;
  }
  return null;
}

function applyResolvedLocation(target = {}, options = {}) {
  if (!target || typeof target !== "object") return target;
  const resolved = options.resolved || resolveRequirementLocation(target);
  if (!resolved) return target;

  target.locationLatitude = resolved.latitude;
  target.locationLongitude = resolved.longitude;
  if (!textValue(target.locationPincode)) {
    const resolvedPincode = pincodeValue(resolved.pincode || target.pincode);
    if (resolvedPincode) target.locationPincode = resolvedPincode;
  }
  if (!textValue(target.locationSource) && resolved.source !== "canonical") {
    target.locationSource = resolved.source;
  }
  return target;
}

module.exports = {
  numericCoordinate,
  coordinatePair,
  resolveRequirementLocation,
  applyResolvedLocation,
};
