const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const websiteCatalogItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    kind: { type: String, required: true, enum: ["service", "product"], index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, maxlength: 100, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    categoryId: { type: String, required: true, index: true, immutable: true },
    categorySlug: { type: String, required: true, trim: true, index: true, maxlength: 80 },
    serviceTypeId: { type: String, required: true, index: true, immutable: true },
    serviceTypeSlug: { type: String, required: true, trim: true, index: true, maxlength: 80 },
    shortDescription: { type: String, default: "", trim: true, maxlength: 500 },
    description: { type: String, default: "", trim: true, maxlength: 5000 },
    coverMediaId: { type: String, default: "", index: true, maxlength: 64 },
    galleryMediaIds: { type: [String], default: [] },
    displayOrder: { type: Number, default: 0, min: 0, max: 100000, index: true },
    active: { type: Boolean, default: true, index: true },
    websiteVisible: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: "crm-admin", trim: true, maxlength: 160 },
    updatedBy: { type: String, default: "crm-admin", trim: true, maxlength: 160 },
  },
  { collection: "websitecatalogitems", timestamps: true, strict: true },
);

websiteCatalogItemSchema.index({ kind: 1, categorySlug: 1, serviceTypeSlug: 1, slug: 1 }, { unique: true });
websiteCatalogItemSchema.index({ kind: 1, active: 1, websiteVisible: 1, displayOrder: 1, name: 1 });

module.exports = mongoose.model("WebsiteCatalogItem", websiteCatalogItemSchema, "websitecatalogitems");
