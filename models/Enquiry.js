const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const enquirySchema = new mongoose.Schema(
  {
    enquiryId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    recordType: { type: String, default: "requirement" },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    mobile: { type: String, default: "", trim: true, index: true, match: /^[6-9]\d{9}$/ },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254, validate: { validator: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), message: "Customer email is invalid" } },
    addressLine: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true, index: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true, validate: { validator: (value) => !value || /^[1-9]\d{5}$/.test(value), message: "Pincode must contain exactly 6 digits" } },
    locationLatitude: { type: Number, default: null },
    locationLongitude: { type: Number, default: null },
    locationPincode: { type: String, default: "", trim: true },
    locationLocality: { type: String, default: "" },
    locationDistrict: { type: String, default: "" },
    locationState: { type: String, default: "" },
    locationCountry: { type: String, default: "India" },
    locationVerifiedAt: { type: Date, default: null },
    locationSource: { type: String, default: "" },
    marketplacePublishedAt: { type: Date, default: null, index: true },
    category: { type: String, default: "", trim: true },
    categorySlug: { type: String, required: true, trim: true, index: true, maxlength: 80, match: /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/ },
    serviceType: { type: String, default: "", trim: true },
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
    requirementTitle: { type: String, default: "", trim: true, maxlength: 200 },
    priority: { type: String, default: "normal", index: true, enum: ["low", "normal", "high", "urgent"] },
    leadIntent: { type: String, enum: ["not_assessed", "low", "medium", "high"], default: "not_assessed", index: true },
    status: { type: String, default: "new", index: true },
    statusUpdatedAt: { type: Date, default: null },
    statusUpdatedBy: { type: String, default: "" },
    preferredDate: { type: String, default: "" },
    preferredSlot: { type: String, default: "" },
    leadPricePaise: { type: Number, default: 10000, min: 0, max: 1000000000 },
    currency: { type: String, default: "INR" },
    sourceWebsite: { type: String, default: "manual-admin", index: true },
    sourceChannel: { type: String, default: "admin" },
    sourceType: { type: String, default: "manual" },
    sourceName: { type: String, default: "" },
    campaign: { type: String, default: "" },
    externalEnquiryId: { type: String, default: "", index: true },
    notes: { type: String, default: "", maxlength: 5000 },
    additionalDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    timeline: { type: [mongoose.Schema.Types.Mixed], default: [] },
    distributionCount: { type: Number, default: 0 },
    unlockedCount: { type: Number, default: 0, min: 0 },
    pendingUnlockCount: { type: Number, default: 0, min: 0 },
    maxProviderUnlocks: { type: Number, default: 5, min: 1, max: 1000 },
    distributedAt: { type: Date, default: null },
    providerConfirmedCount: { type: Number, default: 0, min: 0 },
    providerSaleConversionStatus: {
      type: String,
      enum: ["pending", "converted", "not_converted"],
      default: "pending",
      index: true,
    },
    providerSaleConversionUpdatedAt: { type: Date, default: null },
    providerSaleConversionProviderId: { type: String, default: "", index: true },
    providerSaleConversionProviderName: { type: String, default: "" },
    providerSaleConvertedAt: { type: Date, default: null },
    providerSaleConvertedBy: { type: String, default: "" },
    agentId: { type: String, default: "", index: true },
    referralId: { type: String, default: "", index: true, uppercase: true },
    agentName: { type: String, default: "" },
    agentBusinessName: { type: String, default: "" },
    agentType: { type: String, default: "" },
    agentMobile: { type: String, default: "" },
    agentCategoryId: { type: String, default: "" },
    customerMobileVerified: { type: Boolean, default: false },
    customerMobileVerifiedAt: { type: Date, default: null },
    agentReferralValidation: { type: String, enum: ["", "pending", "valid", "invalid"], default: "pending", index: true },
    leadValidationMethod: { type: String, enum: ["", "phone_call", "whatsapp", "email", "in_person", "other"], default: "" },
    agentReferralInvalidReason: { type: String, default: "", trim: true, maxlength: 120 },
    agentReferralValidationNote: { type: String, default: "", maxlength: 2000 },
    agentReferralValidatedAt: { type: Date, default: null },
    agentReferralValidatedBy: { type: String, default: "" },
    agentSaleConversion: { type: String, enum: ["pending", "converted", "not_converted"], default: "pending", index: true },
    agentSaleConversionNote: { type: String, default: "", maxlength: 2000 },
    agentSaleConvertedAt: { type: Date, default: null },
    agentSaleConvertedBy: { type: String, default: "" },
    partnerEligibilityDate: { type: Date, default: null, index: true },
    partnerPayoutStatus: { type: String, enum: ["", "waiting_period", "unpaid", "reserved", "paid", "not_eligible"], default: "", index: true },
    partnerWithdrawalId: { type: String, default: "", index: true },
    partnerPayoutRatePaise: { type: Number, default: 0, min: 0 },
    partnerPayoutAmountPaise: { type: Number, default: 0, min: 0 },
    partnerPaidAt: { type: Date, default: null },
    partnerPayoutReference: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: String, default: "" },
    deactivationReason: { type: String, default: "" },
  },
  {
    collection: "enquiries",
    timestamps: true,
    strict: false,
  },
);

enquirySchema.index({ status: 1, categorySlug: 1, createdAt: -1 });
enquirySchema.index({ status: 1, categorySlug: 1, marketplacePublishedAt: -1 });
enquirySchema.index({ agentId: 1, createdAt: -1, _id: -1 });
enquirySchema.index({ referralId: 1, createdAt: -1 });
enquirySchema.index({ agentId: 1, agentReferralValidation: 1, partnerEligibilityDate: 1, partnerPayoutStatus: 1, createdAt: 1 });
enquirySchema.index({ partnerWithdrawalId: 1, partnerPayoutStatus: 1 });
enquirySchema.index({ createdAt: -1, _id: -1 });
enquirySchema.index({ isActive: 1, createdAt: -1, _id: -1 });
enquirySchema.index({ status: 1, isActive: 1, createdAt: -1, _id: -1 });

function referenceIdUpdateError() {
  return Object.assign(
    new Error("Lead Reference ID cannot be changed after creation"),
    { status: 400 },
  );
}

function pathTouchesReferenceId(path) {
  return String(path || "") === "enquiryId" ||
    String(path || "").startsWith("enquiryId.");
}

function updateTouchesReferenceId(update = {}) {
  // Update pipelines can replace or remove the whole document. They are not
  // used by the CRM, so block them to guarantee the reference ID survives.
  if (Array.isArray(update)) return true;

  if (!update || typeof update !== "object") return false;
  if (Object.keys(update).some(pathTouchesReferenceId)) return true;

  for (const operator of [
    "$set",
    "$unset",
    "$setOnInsert",
    "$inc",
    "$mul",
    "$min",
    "$max",
    "$currentDate",
    "$push",
    "$addToSet",
    "$pull",
    "$pullAll",
    "$pop",
    "$bit",
  ]) {
    if (
      update[operator] &&
      Object.keys(update[operator]).some(pathTouchesReferenceId)
    ) {
      return true;
    }
  }

  if (update.$rename) {
    return Object.entries(update.$rename).some(
      ([from, to]) => pathTouchesReferenceId(from) || pathTouchesReferenceId(to),
    );
  }

  return false;
}

enquirySchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate"],
  function protectReferenceId(next) {
    if (updateTouchesReferenceId(this.getUpdate())) {
      return next(referenceIdUpdateError());
    }
    return next();
  },
);

enquirySchema.pre(
  ["replaceOne", "findOneAndReplace"],
  function blockLeadReplacement(next) {
    return next(referenceIdUpdateError());
  },
);

function deletionBlockedError() {
  return Object.assign(
    new Error("Leads cannot be permanently deleted; deactivate the lead instead"),
    { status: 405 },
  );
}

enquirySchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete"],
  function blockLeadDeletion(next) {
    return next(deletionBlockedError());
  },
);

enquirySchema.pre(
  "deleteOne",
  { document: true, query: false },
  function blockDocumentLeadDeletion(next) {
    return next(deletionBlockedError());
  },
);


enquirySchema.pre("bulkWrite", function protectBulkLeadOperations(next, operations) {
  for (const operation of operations || []) {
    if (operation.deleteOne || operation.deleteMany) {
      return next(deletionBlockedError());
    }
    if (operation.replaceOne) {
      return next(referenceIdUpdateError());
    }
    const update = operation.updateOne?.update || operation.updateMany?.update;
    if (update && updateTouchesReferenceId(update)) {
      return next(referenceIdUpdateError());
    }
  }
  return next();
});

module.exports = mongoose.model("Enquiry", enquirySchema, "enquiries");
