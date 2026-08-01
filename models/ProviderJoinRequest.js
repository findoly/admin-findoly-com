const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const providerJoinRequestSchema = new mongoose.Schema(
  {
    providerJoinRequestId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    businessName: { type: String, default: "", trim: true, maxlength: 160 },
    mobile: { type: String, required: true, trim: true, maxlength: 10 },
    normalizedMobile: { type: String, required: true, trim: true, maxlength: 10 },
    whatsappNumber: { type: String, required: true, trim: true, maxlength: 10 },
    normalizedWhatsappNumber: { type: String, required: true, trim: true, index: true, maxlength: 10 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254, index: true },
    normalizedEmail: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
    categoryId: { type: String, required: true, trim: true, index: true, maxlength: 100 },
    categorySlug: { type: String, required: true, trim: true, index: true, maxlength: 80 },
    categoryNameSnapshot: { type: String, required: true, trim: true, maxlength: 120 },
    serviceAddress: { type: String, required: true, trim: true, maxlength: 500 },
    servicePincode: { type: String, required: true, trim: true, index: true, maxlength: 6 },
    city: { type: String, required: true, trim: true, index: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    googlePlaceId: { type: String, default: "", trim: true, maxlength: 255 },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    status: {
      type: String,
      enum: ["new", "contacted", "converted", "rejected"],
      default: "new",
      index: true,
    },
    internalNote: { type: String, default: "", trim: true, maxlength: 2000 },
    contactedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    convertedProviderId: { type: String, default: "", trim: true, index: true },
    processedBy: { type: String, default: "", trim: true, maxlength: 254 },
    consentAcceptedAt: { type: Date, default: null },
    conversionLockAt: { type: Date, default: null },
    conversionLockBy: { type: String, default: "", trim: true, maxlength: 100 },
  },
  {
    collection: "providerjoinrequests",
    timestamps: true,
    strict: false,
  },
);

providerJoinRequestSchema.index({ status: 1, createdAt: -1, _id: -1 });
providerJoinRequestSchema.index({ normalizedMobile: 1, status: 1, createdAt: -1 });
providerJoinRequestSchema.index(
  { normalizedMobile: 1 },
  {
    unique: true,
    partialFilterExpression: { $or: [{ status: "new" }, { status: "contacted" }] },
  },
);
providerJoinRequestSchema.index({ categorySlug: 1, status: 1, createdAt: -1 });
providerJoinRequestSchema.index({ normalizedEmail: 1, status: 1, createdAt: -1 });
providerJoinRequestSchema.index({ updatedAt: -1, _id: -1 });
providerJoinRequestSchema.index({ status: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.models.ProviderJoinRequest
  || mongoose.model("ProviderJoinRequest", providerJoinRequestSchema, "providerjoinrequests");
