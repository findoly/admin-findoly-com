const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const paymentOrderSchema = new mongoose.Schema(
  {
    paymentOrderId: { type: String, default: uuid, unique: true, index: true },
    providerId: { type: String, required: true, index: true },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    razorpayPaymentId: { type: String, default: "", index: true },
    amountPaise: { type: Number, required: true, min: 100 },
    currency: { type: String, default: "INR" },
    status: { type: String, default: "created", index: true },
    signatureVerified: { type: Boolean, default: false },
    walletCredited: { type: Boolean, default: false },
    walletTransactionId: { type: String, default: "" },
    receipt: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    creditedAt: { type: Date, default: null },
  },
  {
    collection: "paymentorders",
    timestamps: true,
    strict: false,
  },
);

paymentOrderSchema.index({ providerId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "PaymentOrder",
  paymentOrderSchema,
  "paymentorders",
);
