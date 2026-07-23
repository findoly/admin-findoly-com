const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const creditAllocationSchema = new mongoose.Schema(
  {
    creditAllocationId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
    },
    providerId: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    referenceId: { type: String, default: "", index: true },
    paymentOrderId: { type: String, default: "", index: true },
    providerSubscriptionId: { type: String, default: "", index: true },
    planCode: { type: String, default: "", index: true },
    billingCycle: { type: String, default: "" },
    amountMinorCredits: { type: Number, required: true, min: 1 },
    remainingMinorCredits: { type: Number, required: true, min: 0 },
    expiredMinorCredits: { type: Number, default: 0, min: 0 },
    status: { type: String, default: "active", index: true },
    allocatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null, index: true },
    depletedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: "creditallocations",
    timestamps: true,
    strict: false,
  },
);

creditAllocationSchema.index({ providerId: 1, status: 1, expiresAt: 1 });
creditAllocationSchema.index(
  { providerId: 1, source: 1, referenceId: 1 },
  { unique: true, partialFilterExpression: { referenceId: { $type: "string" } } },
);

module.exports = mongoose.model(
  "CreditAllocation",
  creditAllocationSchema,
  "creditallocations",
);
