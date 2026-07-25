const mongoose = require("mongoose");

const providerSubscriptionSchema = new mongoose.Schema(
  {
    providerSubscriptionId: { type: String, required: true, unique: true, index: true },
    providerId: { type: String, required: true, index: true },
    paymentOrderId: { type: String, required: true, unique: true, index: true },
    planCode: { type: String, required: true, index: true },
    planName: { type: String, required: true },
    billingCycle: { type: String, required: true, index: true },
    status: { type: String, default: "active", index: true },
    startsAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    purchasedAt: { type: Date, default: Date.now, index: true },
    listedPricePaise: { type: Number, required: true, min: 0 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    gstAmountPaise: { type: Number, required: true, min: 0 },
    totalAmountPaise: { type: Number, required: true, min: 0 },
    gstIncluded: { type: Boolean, default: false },
    baseCredits: { type: Number, required: true, min: 0 },
    bonusCredits: { type: Number, required: true, min: 0 },
    totalCredits: { type: Number, required: true, min: 0 },
  },
  {
    collection: "providersubscriptions",
    timestamps: true,
    strict: false,
  },
);

providerSubscriptionSchema.index({ providerId: 1, purchasedAt: -1, _id: -1 });
providerSubscriptionSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model(
  "ProviderSubscription",
  providerSubscriptionSchema,
  "providersubscriptions",
);
