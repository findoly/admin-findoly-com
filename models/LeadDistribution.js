const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const leadDistributionSchema = new mongoose.Schema(
  {
    leadDistributionId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
    },
    enquiryId: { type: String, required: true, index: true },
    providerId: { type: String, required: true, index: true },
    categorySlug: { type: String, default: "", index: true },
    status: { type: String, default: "offered", index: true },
    leadPricePaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    contactUnlocked: { type: Boolean, default: false, index: true },
    leadTitle: { type: String, default: "" },
    serviceType: { type: String, default: "" },
    category: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    pincode: { type: String, default: "" },
    preferredDate: { type: String, default: "" },
    preferredSlot: { type: String, default: "" },
    priority: { type: String, default: "normal" },
    sourceWebsite: { type: String, default: "" },
    customerName: { type: String, default: "" },
    customerMobile: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    providerName: { type: String, default: "" },
    providerBusinessName: { type: String, default: "" },
    providerMobile: { type: String, default: "" },
    additionalDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    distributedBy: { type: String, default: "system" },
    distributedAt: { type: Date, default: Date.now, index: true },
    unlockedAt: { type: Date, default: null },
    walletTransactionId: { type: String, default: "" },
  },
  {
    collection: "leaddistributions",
    timestamps: true,
    strict: false,
  },
);

leadDistributionSchema.index({ enquiryId: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.model(
  "LeadDistribution",
  leadDistributionSchema,
  "leaddistributions",
);
