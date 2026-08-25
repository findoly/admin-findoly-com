const Enquiry = require("../../models/Enquiry");
const { geocodePincode } = require("./geocoding-service");

async function attachCreatedLeadLocation(lead = {}) {
  const enquiryId = String(lead.enquiryId || lead.id || "").trim();
  const pincode = String(lead.pincode || "").trim();
  if (!enquiryId || !/^[1-9]\d{5}$/.test(pincode)) return null;

  try {
    const location = await geocodePincode(pincode);
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

    const result = await Enquiry.updateOne(
      { enquiryId },
      { $set: { ...locationData, updatedAt: new Date() } },
    );
    return result.matchedCount ? locationData : null;
  } catch (error) {
    console.warn({
      event: "manual_lead_location_geocode_failed",
      enquiryId,
      pincode,
      code: String(error.code || "GEOCODING_UNAVAILABLE"),
      message: String(error.message || error).slice(0, 1000),
    });
    return null;
  }
}

module.exports = { attachCreatedLeadLocation };
