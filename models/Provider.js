const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const providerSchema = new mongoose.Schema(
  {
    providerId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    businessName: { type: String, default: "", trim: true, maxlength: 160 },
    mobile: { type: String, default: "", trim: true, match: /^[6-9]\d{9}$/ },
    normalizedMobile: { type: String, default: "", trim: true, index: true, match: /^[6-9]\d{9}$/ },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254, validate: { validator: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), message: "Provider email is invalid" } },
    status: { type: String, default: "active", index: true },
    onboardingStage: { type: String, default: "new" },
    categorySlugs: { type: [String], default: [], index: true },
    skills: { type: [String], default: [] },
    city: { type: String, default: "", index: true },
    state: { type: String, default: "" },
    servicePincode: {
      type: String,
      default: "",
      trim: true,
      index: true,
      validate: {
        validator: (value) => !value || /^[1-9]\d{5}$/.test(value),
        message: "Service PIN code must contain exactly 6 digits",
      },
    },
    serviceAddress: { type: String, default: "", trim: true, maxlength: 500 },
    serviceLatitude: { type: Number, default: null },
    serviceLongitude: { type: Number, default: null },
    serviceLocality: { type: String, default: "" },
    serviceDistrict: { type: String, default: "" },
    serviceState: { type: String, default: "" },
    serviceCountry: { type: String, default: "India" },
    serviceLocationVerifiedAt: { type: Date, default: null },
    serviceLocationSource: { type: String, default: "" },
    serviceAreas: { type: [String], default: [] },
    availability: { type: String, default: "available_today" },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    notes: { type: String, default: "", maxlength: 5000 },
    documentsVerified: { type: Boolean, default: false },
    portalAccessEnabled: { type: Boolean, default: true, index: true },
    walletBalancePaise: { type: Number, default: 0, min: 0 },
    walletCurrency: { type: String, default: "INR" },
    walletUpdatedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    outcomeWarningCount: { type: Number, default: 0, min: 0 },
    outcomeLastWarningAt: { type: Date, default: null },
    outcomeLastWarningReason: { type: String, default: "", maxlength: 2000 },
    platformRestrictionReason: { type: String, default: "", maxlength: 2000 },
    platformRestrictedAt: { type: Date, default: null },
    platformRestrictedBy: { type: String, default: "" },
  },
  {
    collection: "providers",
    timestamps: true,
    strict: false,
  },
);

providerSchema.index({ status: 1, portalAccessEnabled: 1, categorySlugs: 1 });
providerSchema.index({ createdAt: -1, _id: -1 });
providerSchema.index({ status: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("Provider", providerSchema, "providers");
