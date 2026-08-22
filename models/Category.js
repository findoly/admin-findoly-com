const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const categorySchema = new mongoose.Schema(
  {
    categoryId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, index: true, maxlength: 80, match: /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/ },
    sourceWebsite: { type: String, default: "any" },
    formType: { type: String, default: "default" },
    description: { type: String, default: "", maxlength: 2000 },
    alertDistanceKm: { type: Number, default: 20, min: 1, max: 100 },
    displayOrder: { type: Number, default: 0, min: 0, max: 100000, index: true },
    websiteVisible: { type: Boolean, default: true, index: true },
    imageMediaId: { type: String, default: "", index: true, maxlength: 64 },
    bannerMediaId: { type: String, default: "", index: true, maxlength: 64 },
    active: { type: Boolean, default: true },
  },
  {
    collection: "categories",
    timestamps: true,
    strict: false,
  },
);

categorySchema.index({ slug: 1, sourceWebsite: 1 }, { unique: true });
categorySchema.index({ name: 1, _id: 1 });
categorySchema.index({ active: 1, name: 1, _id: 1 });

module.exports = mongoose.model("Category", categorySchema, "categories");
