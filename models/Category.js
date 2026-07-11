const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const categorySchema = new mongoose.Schema(
  {
    categoryId: { type: String, default: uuid, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, index: true },
    sourceWebsite: { type: String, default: "any" },
    formType: { type: String, default: "default" },
    description: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  {
    collection: "categories",
    timestamps: true,
    strict: false,
  },
);

categorySchema.index({ slug: 1, sourceWebsite: 1 }, { unique: true });

module.exports = mongoose.model("Category", categorySchema, "categories");
