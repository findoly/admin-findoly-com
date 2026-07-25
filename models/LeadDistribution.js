const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const leadDistributionSchema = new mongoose.Schema(
  {
    leadDistributionId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    enquiryId: { type: String, required: true, index: true, immutable: true },
    providerId: { type: String, required: true, index: true, immutable: true },
    categorySlug: { type: String, default: "", index: true },
    status: { type: String, default: "offered", index: true },
    leadPricePaise: { type: Number, required: true, min: 0 },
    leadCostCredits: { type: Number, min: 0, default: undefined },
    currency: { type: String, default: "INR" },
    contactUnlocked: { type: Boolean, default: false, index: true },
    leadTitle: { type: String, default: "" },
    serviceType: { type: String, default: "" },
    serviceTypes: {
      type: [
        new mongoose.Schema(
          {
            serviceTypeId: { type: String, required: true },
            name: { type: String, required: true, trim: true, maxlength: 120 },
            slug: { type: String, required: true, trim: true, maxlength: 80 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
      validate: {
        validator(value) {
          return value === undefined || (Array.isArray(value) && value.length <= 5);
        },
        message: "A lead may contain no more than 5 Service Types",
      },
    },
    category: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    pincode: { type: String, default: "" },
    leadLatitude: { type: Number, default: null },
    leadLongitude: { type: Number, default: null },
    providerDistanceKm: { type: Number, default: null, min: 0 },
    marketplacePublishedAt: { type: Date, default: null, index: true },
    marketplaceVisibleAt: { type: Date, default: null, index: true },
    preferredDate: { type: String, default: "" },
    preferredSlot: { type: String, default: "" },
    priority: { type: String, default: "normal" },
    leadIntent: { type: String, enum: ["not_assessed", "low", "medium", "high"], default: "not_assessed", index: true },
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
    providerSaleOutcome: { type: String, enum: ["", "confirmed", "not_confirmed"], default: "", index: true },
    providerSaleOutcomeNote: { type: String, default: "" },
    providerSaleOutcomeUpdatedAt: { type: Date, default: null, index: true },
    providerSaleOutcomeUpdatedBy: { type: String, default: "" },
    providerSaleOutcomeHistory: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    providerLeadStatus: { type: String, default: "", index: true },
    providerLeadReason: { type: String, default: "" },
    providerLeadNote: { type: String, default: "" },
    providerLeadStatusUpdatedAt: { type: Date, default: null },
    providerLeadStatusUpdatedBy: { type: String, default: "" },
    providerLeadStatusHistory: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },
    outcomeVerificationStatus: { type: String, enum: ["", "pending_review", "verified", "unable_to_verify", "incorrect_status", "under_review"], default: "", index: true },
    outcomeVerificationNote: { type: String, default: "" },
    outcomeVerifiedAt: { type: Date, default: null },
    outcomeVerifiedBy: { type: String, default: "" },
    crmSyncStatus: { type: String, enum: ["", "pending", "synced", "failed"], default: "", index: true },
    crmSyncError: { type: String, default: "" },
    crmSyncUpdatedAt: { type: Date, default: null },
    baseLeadCostCredits: { type: Number, min: 0, default: undefined },
    effectiveLeadCostCredits: { type: Number, min: 0, default: undefined },
    unlockDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
    unlockCountAtPurchase: { type: Number, min: 0, default: 0 },
    maxProviderUnlocks: { type: Number, min: 1, max: 1000, default: 5 },
  },
  {
    collection: "leaddistributions",
    timestamps: true,
    strict: false,
  },
);

leadDistributionSchema.index({ enquiryId: 1, providerId: 1 }, { unique: true });
leadDistributionSchema.index({ enquiryId: 1, distributedAt: -1, _id: -1 });
leadDistributionSchema.index({ providerId: 1, distributedAt: -1, _id: -1 });

module.exports = mongoose.model(
  "LeadDistribution",
  leadDistributionSchema,
  "leaddistributions",
);
