const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const serviceTypeSnapshotSchema = new mongoose.Schema(
  {
    serviceTypeId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { _id: false },
);

const providerLeadUnlockSchema = new mongoose.Schema(
  {
    providerLeadUnlockId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    enquiryId: { type: String, required: true, index: true, immutable: true },
    providerId: { type: String, required: true, index: true, immutable: true },

    // Compact list snapshot. Customer contact remains only on the enquiry.
    leadTitle: { type: String, default: "", trim: true, maxlength: 200 },
    leadTitleKey: { type: String, default: "", trim: true, maxlength: 200 },
    categorySlug: { type: String, default: "", trim: true, index: true, maxlength: 80 },
    category: { type: String, default: "", trim: true, maxlength: 120 },
    serviceTypes: {
      type: [serviceTypeSnapshotSchema],
      default: undefined,
      validate: {
        validator(value) {
          return value === undefined || (Array.isArray(value) && value.length <= 5);
        },
        message: "A lead unlock may contain no more than 5 Service Types",
      },
    },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal", index: true },
    city: { type: String, default: "", trim: true, maxlength: 100 },
    cityKey: { type: String, default: "", trim: true, maxlength: 100 },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    pincode: { type: String, default: "", trim: true, maxlength: 6 },
    leadPricePaise: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR" },

    providerName: { type: String, default: "", trim: true, maxlength: 120 },
    providerBusinessName: { type: String, default: "", trim: true, maxlength: 160 },

    unlockedAt: { type: Date, default: Date.now, index: true, immutable: true },
    unlockMethod: { type: String, enum: ["credits", "direct_payment", "admin"], required: true, index: true },
    chargedCredits: { type: Number, default: 0, min: 0 },
    chargedPaise: { type: Number, default: 0, min: 0 },
    walletTransactionId: { type: String, default: "", index: true },
    paymentOrderId: { type: String, default: "", index: true },

    providerSaleOutcome: { type: String, enum: ["", "confirmed", "not_confirmed"], default: "", index: true },
    providerSaleOutcomeNote: { type: String, default: "", trim: true, maxlength: 2000 },
    providerSaleOutcomeUpdatedAt: { type: Date, default: null, index: true },
    providerSaleOutcomeUpdatedBy: { type: String, default: "" },

    providerLeadStatus: { type: String, default: "", index: true },
    providerLeadReason: { type: String, default: "", trim: true, maxlength: 120 },
    providerLeadNote: { type: String, default: "", trim: true, maxlength: 2000 },
    providerLeadStatusUpdatedAt: { type: Date, default: null },
    providerLeadStatusUpdatedBy: { type: String, default: "" },

    outcomeVerificationStatus: {
      type: String,
      enum: ["", "pending_review", "verified", "unable_to_verify", "incorrect_status", "under_review"],
      default: "",
      index: true,
    },
    outcomeVerificationNote: { type: String, default: "", trim: true, maxlength: 2000 },
    outcomeVerifiedAt: { type: Date, default: null },
    outcomeVerifiedBy: { type: String, default: "" },

    crmSyncStatus: { type: String, enum: ["", "pending", "synced", "failed"], default: "", index: true },
    crmSyncError: { type: String, default: "", maxlength: 1000 },
    crmSyncUpdatedAt: { type: Date, default: null },
  },
  {
    collection: "providerleadunlocks",
    timestamps: true,
    strict: true,
  },
);

providerLeadUnlockSchema.index({ providerId: 1, enquiryId: 1 }, { unique: true });
providerLeadUnlockSchema.index({ providerId: 1, unlockedAt: -1, _id: -1 });
providerLeadUnlockSchema.index({ enquiryId: 1, unlockedAt: -1, _id: -1 });
providerLeadUnlockSchema.index({ providerId: 1, providerSaleOutcome: 1, unlockedAt: -1, _id: -1 });
providerLeadUnlockSchema.index({ providerId: 1, providerLeadStatus: 1, unlockedAt: -1, _id: -1 });
providerLeadUnlockSchema.index({ providerId: 1, categorySlug: 1, unlockedAt: -1, _id: -1 });
providerLeadUnlockSchema.index({ providerId: 1, cityKey: 1, unlockedAt: -1, _id: -1 });

module.exports = mongoose.model(
  "ProviderLeadUnlock",
  providerLeadUnlockSchema,
  "providerleadunlocks",
);
