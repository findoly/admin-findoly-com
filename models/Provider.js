const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const providerSchema = new mongoose.Schema(
  {
    providerId: { type: String, default: uuid, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    businessName: { type: String, default: "", trim: true },
    mobile: { type: String, default: "", trim: true },
    normalizedMobile: { type: String, default: "", trim: true, index: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    status: { type: String, default: "active", index: true },
    onboardingStage: { type: String, default: "new" },
    categorySlugs: { type: [String], default: [], index: true },
    skills: { type: [String], default: [] },
    city: { type: String, default: "", index: true },
    state: { type: String, default: "" },
    serviceAreas: { type: [String], default: [] },
    availability: { type: String, default: "available_today" },
    rating: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    documentsVerified: { type: Boolean, default: false },
    portalAccessEnabled: { type: Boolean, default: true, index: true },
    walletBalancePaise: { type: Number, default: 0, min: 0 },
    walletCurrency: { type: String, default: "INR" },
    walletUpdatedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  {
    collection: "providers",
    timestamps: true,
    strict: false,
  },
);

providerSchema.index({ status: 1, portalAccessEnabled: 1, categorySlugs: 1 });

module.exports = mongoose.model("Provider", providerSchema, "providers");
