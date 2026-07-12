const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const withdrawalSchema = new mongoose.Schema(
  {
    withdrawalId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    withdrawalNumber: { type: String, required: true, unique: true, index: true, immutable: true, maxlength: 40 },
    agentId: { type: String, required: true, index: true },
    referralId: { type: String, required: true, index: true, uppercase: true },
    agentName: { type: String, required: true, trim: true, maxlength: 120 },
    agentBusinessName: { type: String, default: "", trim: true, maxlength: 160 },
    agentMobile: { type: String, required: true, trim: true },
    categoryId: { type: String, default: "", trim: true },
    categorySlug: { type: String, default: "", trim: true, index: true },
    categoryName: { type: String, default: "", trim: true },
    payoutPerReferralPaise: { type: Number, required: true, min: 5000, max: 20000 },
    validReferralCount: { type: Number, required: true, min: 0 },
    convertedSaleCount: { type: Number, required: true, min: 0 },
    eligibleBlockCount: { type: Number, required: true, min: 1 },
    payableReferralCount: { type: Number, required: true, min: 10 },
    grossAmountPaise: { type: Number, required: true, min: 1 },
    deductionAmountPaise: { type: Number, default: 0, min: 0 },
    netAmountPaise: { type: Number, required: true, min: 1 },
    requirementIds: { type: [String], required: true, default: [] },
    requirementSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: {
      type: String,
      enum: [
        "submitted",
        "under_review",
        "eligibility_approved",
        "finance_approved",
        "payout_processing",
        "paid",
        "rejected",
        "cancelled",
        "payout_failed",
        "eligibility_changed",
        "payout_reversed",
      ],
      default: "submitted",
      index: true,
    },
    approvalHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    submittedAt: { type: Date, default: Date.now, index: true },
    reviewedAt: { type: Date, default: null },
    eligibilityApprovedAt: { type: Date, default: null },
    financeApprovedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 2000 },
    payoutMode: { type: String, enum: ["UPI", "IMPS", "NEFT", "RTGS"], default: "IMPS" },
    payoutAccountLabel: { type: String, default: "", maxlength: 160 },
    razorpayContactId: { type: String, default: "", maxlength: 80 },
    razorpayFundAccountId: { type: String, default: "", maxlength: 80 },
    payoutAttemptCount: { type: Number, default: 0, min: 0 },
    payoutIdempotencyKey: { type: String, default: "", maxlength: 64 },
    razorpayPayoutId: { type: String, default: "", index: true },
    razorpayPayoutStatus: { type: String, default: "" },
    razorpayStatusDetails: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    payoutFailureReason: { type: String, default: "", maxlength: 2000 },
    payoutInitiatedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    payoutReference: { type: String, default: "", maxlength: 120 },
    updatedBy: { type: String, default: "" },
  },
  { collection: "agent_withdrawals", timestamps: true, strict: false },
);

withdrawalSchema.index({ agentId: 1, status: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, submittedAt: -1, _id: -1 });
withdrawalSchema.index({ requirementIds: 1, status: 1 });

module.exports = mongoose.model("AgentWithdrawal", withdrawalSchema, "agent_withdrawals");
