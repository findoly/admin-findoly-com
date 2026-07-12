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
    mobile: { type: String, default: "", trim: true, index: true, match: /^\d{10}$/ },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254, validate: { validator: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), message: "Customer email is invalid" } },
    addressLine: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true, index: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true, validate: { validator: (value) => !value || /^[1-9]\d{5}$/.test(value), message: "Pincode must contain exactly 6 digits" } },
    category: { type: String, default: "", trim: true },
    categorySlug: { type: String, required: true, trim: true, index: true, maxlength: 80, match: /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/ },
    serviceType: { type: String, default: "", trim: true },
    requirementTitle: { type: String, default: "", trim: true, maxlength: 200 },
    priority: { type: String, default: "normal", index: true, enum: ["low", "normal", "high", "urgent"] },
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
    unlockedCount: { type: Number, default: 0 },
    distributedAt: { type: Date, default: null },
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
