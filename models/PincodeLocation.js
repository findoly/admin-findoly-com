const mongoose = require("mongoose");

const pincodeLocationSchema = new mongoose.Schema(
  {
    pincode: { type: String, required: true, unique: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    locality: { type: String, default: "" },
    district: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "India" },
    formattedAddress: { type: String, default: "" },
    postcodeLocalities: { type: [String], default: [] },
    enrichmentVersion: { type: Number, default: 0 },
    source: { type: String, default: "google_geocoding" },
    verifiedAt: { type: Date, default: Date.now },
  },
  { collection: "pincodelocations", timestamps: true },
);

module.exports = mongoose.model("PincodeLocation", pincodeLocationSchema, "pincodelocations");
