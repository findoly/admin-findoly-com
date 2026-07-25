const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const serviceTypeSchema = new mongoose.Schema(
  {
    serviceTypeId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    categoryId: { type: String, required: true, index: true, immutable: true },
    categorySlug: {
      type: String,
      required: true,
      trim: true,
      index: true,
      immutable: true,
      maxlength: 80,
      match: /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      match: /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/,
    },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    displayOrder: { type: Number, default: 0, min: 0, max: 100000, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  {
    collection: "servicetypes",
    timestamps: true,
    strict: true,
  },
);

serviceTypeSchema.index({ categorySlug: 1, slug: 1 }, { unique: true });
serviceTypeSchema.index({ categorySlug: 1, normalizedName: 1 }, { unique: true });
serviceTypeSchema.index({ categorySlug: 1, active: 1, displayOrder: 1, name: 1 });

module.exports = mongoose.model("ServiceType", serviceTypeSchema, "servicetypes");
