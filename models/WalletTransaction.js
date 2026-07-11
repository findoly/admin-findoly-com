const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const walletTransactionSchema = new mongoose.Schema(
  {
    walletTransactionId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
    },
    providerId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    balanceBeforePaise: { type: Number, required: true, min: 0 },
    balanceAfterPaise: { type: Number, required: true, min: 0 },
    status: { type: String, default: "posted", index: true },
    source: { type: String, required: true },
    referenceId: { type: String, default: "", index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: "wallettransactions",
    timestamps: true,
    strict: false,
  },
);

walletTransactionSchema.index({ providerId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema,
  "wallettransactions",
);
