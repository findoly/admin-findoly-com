const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const agentSchema = new mongoose.Schema(
  {
    agentId: { type: String, default: uuid, unique: true, index: true, immutable: true, match: /^[a-f0-9]{32}$/ },
    referralId: { type: String, required: true, unique: true, index: true, immutable: true, uppercase: true, match: /^[A-Z0-9]{6}$/ },
    agentType: { type: String, enum: ["individual", "shop"], default: "individual", index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    businessName: { type: String, default: "", trim: true, maxlength: 160 },
    mobile: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
    normalizedMobile: { type: String, required: true, trim: true, unique: true, index: true, match: /^[6-9]\d{9}$/ },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
    addressLine: { type: String, default: "", trim: true, maxlength: 500 },
    city: { type: String, default: "", trim: true, index: true, maxlength: 100 },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    pincode: { type: String, default: "", trim: true, validate: { validator: (value) => !value || /^[1-9]\d{5}$/.test(value), message: "Pincode must contain exactly 6 digits" } },
    categoryId: { type: String, default: "", trim: true, index: true },
    categorySlug: { type: String, required: true, trim: true, index: true },
    categoryName: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ["active", "inactive", "pending", "blocked"], default: "active", index: true },
    portalAccessEnabled: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "", maxlength: 5000 },
    payoutPerReferralPaise: { type: Number, default: 5000, min: 5000, max: 20000 },
    payoutEnabled: { type: Boolean, default: false, index: true },
    payoutMode: { type: String, enum: ["UPI", "IMPS", "NEFT", "RTGS"], default: "IMPS" },
    razorpayContactId: { type: String, default: "", trim: true, maxlength: 80 },
    razorpayFundAccountId: { type: String, default: "", trim: true, maxlength: 80 },
    payoutAccountLabel: { type: String, default: "", trim: true, maxlength: 160 },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: String, default: "crm-admin" },
    updatedBy: { type: String, default: "crm-admin" },
  },
  { collection: "agents", timestamps: true, strict: false },
);

agentSchema.index({ status: 1, portalAccessEnabled: 1, categorySlug: 1 });
agentSchema.index({ createdAt: -1, _id: -1 });
module.exports = mongoose.model("Agent", agentSchema, "agents");
