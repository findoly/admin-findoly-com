const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const paymentOrderSchema = new mongoose.Schema(
  {
    paymentOrderId: { type: String, default: uuid, unique: true, index: true },
    providerId: { type: String, required: true, index: true },
    purpose: { type: String, default: "legacy_wallet_topup", index: true },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    razorpayPaymentId: { type: String, default: "", index: true },

    // amountPaise remains the exact Razorpay checkout total for compatibility.
    amountPaise: { type: Number, required: true, min: 100 },
    listedPricePaise: { type: Number, default: 0, min: 0 },
    subtotalPaise: { type: Number, default: 0, min: 0 },
    gstAmountPaise: { type: Number, default: 0, min: 0 },
    totalAmountPaise: { type: Number, default: 0, min: 0 },
    gstRatePercent: { type: Number, default: 18, min: 0 },
    gstIncluded: { type: Boolean, default: false },

    planCode: { type: String, default: "", index: true },
    planName: { type: String, default: "" },
    billingCycle: { type: String, default: "" },
    baseCredits: { type: Number, default: 0, min: 0 },
    bonusCredits: { type: Number, default: 0, min: 0 },
    totalCredits: { type: Number, default: 0, min: 0 },
    creditAmount: { type: Number, min: 0, default: undefined },

    enquiryId: { type: String, default: "", index: true },
    reservationStatus: { type: String, enum: ["none", "reserved", "released", "converted"], default: "none", index: true },
    reservedUntil: { type: Date, default: null, index: true },
    activeReservationKey: { type: String, default: undefined },
    baseLeadCostCredits: { type: Number, default: 0, min: 0 },
    effectiveLeadCostCredits: { type: Number, default: 0, min: 0 },
    unlockDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
    unlockCountAtPurchase: { type: Number, default: 0, min: 0 },

    currency: { type: String, default: "INR" },
    status: { type: String, default: "created", index: true },
    signatureVerified: { type: Boolean, default: false },
    fulfilled: { type: Boolean, default: false, index: true },
    fulfillmentStatus: { type: String, default: "pending" },
    fulfillmentReferenceId: { type: String, default: "", index: true },
    fulfillmentError: { type: String, default: "" },

    // Legacy fields remain readable for old transaction history.
    walletCredited: { type: Boolean, default: false },
    walletTransactionId: { type: String, default: "" },

    receipt: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    creditedAt: { type: Date, default: null },
  },
  {
    collection: "paymentorders",
    timestamps: true,
    strict: false,
  },
);

paymentOrderSchema.index({ providerId: 1, createdAt: -1 });
paymentOrderSchema.index({ providerId: 1, purpose: 1, createdAt: -1 });
paymentOrderSchema.index({ providerId: 1, purpose: 1, enquiryId: 1, status: 1, createdAt: -1 });
paymentOrderSchema.index({ reservationStatus: 1, reservedUntil: 1, _id: 1 });
paymentOrderSchema.index(
  { activeReservationKey: 1 },
  { unique: true, partialFilterExpression: { activeReservationKey: { $type: "string" } } },
);

module.exports = mongoose.model(
  "PaymentOrder",
  paymentOrderSchema,
  "paymentorders",
);
