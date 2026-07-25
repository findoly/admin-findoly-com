const { geocodePincode } = require("../services/location/geocoding-service");

async function lookupPincode(req, res, next) {
  try {
    const location = await geocodePincode(req.params.pincode);
    return res.json({
      success: true,
      data: {
        pincode: location.pincode,
        locality: location.locality || "",
        district: location.district || "",
        city: location.city || location.locality || location.district || "",
        state: location.state || "",
        country: location.country || "India",
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        source: location.source || "google_geocoding",
        verifiedAt: location.verifiedAt || null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { lookupPincode };
