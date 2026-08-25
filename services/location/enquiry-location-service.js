const Enquiry = require("../../models/Enquiry");
const { geocodePincode } = require("./geocoding-service");

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function currentLocationData(lead = {}) {
  return {
    locationLatitude: Number(lead.locationLatitude),
    locationLongitude: Number(lead.locationLongitude),
    locationPincode: String(lead.locationPincode || lead.pincode || "").trim(),
    locationLocality: lead.locationLocality || "",
    locationDistrict: lead.locationDistrict || "",
    locationState: lead.locationState || lead.state || "",
    locationCountry: lead.locationCountry || "India",
    locationVerifiedAt: lead.locationVerifiedAt || null,
    locationSource: lead.locationSource || "google_geocoding",
  };
}

function manualLocationData(lead = {}, pincode = "") {
  return {
    locationLatitude: null,
    locationLongitude: null,
    locationPincode: pincode,
    locationLocality: "",
    locationDistrict: "",
    locationState: lead.state || "",
    locationCountry: "India",
    locationVerifiedAt: null,
    locationSource: "manual_pincode",
  };
}

async function persistLocation(enquiryId, locationData, extra = {}) {
  const result = await Enquiry.updateOne(
    { $or: [{ enquiryId }, { id: enquiryId }] },
    { $set: { ...locationData, ...extra, updatedAt: new Date() } },
  );
  return result.matchedCount ? { ...locationData, ...extra } : null;
}

async function syncLeadLocation(lead = {}) {
  const enquiryId = String(lead.enquiryId || lead.id || "").trim();
  const pincode = String(lead.pincode || "").trim();
  if (!enquiryId || !/^[1-9]\d{5}$/.test(pincode)) return null;

  const canonicalMatchesPincode = pincode === String(lead.locationPincode || "").trim();
  const hasCurrentCoordinates = validCoordinate(lead.locationLatitude, -90, 90)
    && validCoordinate(lead.locationLongitude, -180, 180);
  if (canonicalMatchesPincode && hasCurrentCoordinates) {
    return currentLocationData(lead);
  }

  try {
    const location = await geocodePincode(pincode);
    if (
      !validCoordinate(location?.latitude, -90, 90)
      || !validCoordinate(location?.longitude, -180, 180)
    ) {
      throw Object.assign(new Error("PIN code verification returned an invalid location"), {
        status: 503,
        code: "GEOCODING_INVALID_RESPONSE",
      });
    }

    const locationData = {
      locationLatitude: Number(location.latitude),
      locationLongitude: Number(location.longitude),
      locationPincode: pincode,
      locationLocality: location.locality || "",
      locationDistrict: location.district || "",
      locationState: location.state || lead.state || "",
      locationCountry: location.country || "India",
      locationVerifiedAt: location.verifiedAt || new Date(),
      locationSource: location.source || "google_geocoding",
    };
    const extra = {
      city: lead.city || location.city || location.locality || location.district || "",
      state: lead.state || location.state || "",
      addressLine: lead.addressLine || location.formattedAddress || "",
    };
    return persistLocation(enquiryId, locationData, extra);
  } catch (error) {
    console.warn({
      event: "requirement_location_geocode_failed",
      enquiryId,
      pincode,
      code: String(error.code || "GEOCODING_UNAVAILABLE"),
      message: String(error.message || error).slice(0, 1000),
    });

    // A changed or previously unresolved PIN must never keep stale coordinates.
    // Save the manual PIN/state fallback and allow future create/edit/nearby calls to retry.
    const fallback = manualLocationData(lead, pincode);
    try {
      return await persistLocation(enquiryId, fallback);
    } catch (persistError) {
      console.warn({
        event: "requirement_location_fallback_save_failed",
        enquiryId,
        pincode,
        code: String(persistError.code || "LOCATION_SAVE_FAILED"),
        message: String(persistError.message || persistError).slice(0, 1000),
      });
      return null;
    }
  }
}

module.exports = {
  syncLeadLocation,
  attachCreatedLeadLocation: syncLeadLocation,
};
