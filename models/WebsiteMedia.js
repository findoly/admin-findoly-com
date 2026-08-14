const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const mediaVariantSchema = new mongoose.Schema(
  {
    s3Key: { type: String, default: "", trim: true, maxlength: 1024 },
    publicUrl: { type: String, default: "", trim: true, maxlength: 2048 },
    mimeType: { type: String, default: "image/webp", trim: true, maxlength: 120 },
    sizeBytes: { type: Number, default: 0, min: 0, max: 50 * 1024 * 1024 },
    width: { type: Number, default: 0, min: 0, max: 20000 },
    height: { type: Number, default: 0, min: 0, max: 20000 },
  },
  { _id: false, strict: true },
);

const websiteMediaSchema = new mongoose.Schema(
  {
    mediaId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    originalName: { type: String, default: "", trim: true, maxlength: 255 },
    s3Key: { type: String, required: true, unique: true, index: true, trim: true, maxlength: 1024 },
    publicUrl: { type: String, required: true, trim: true, maxlength: 2048 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    sizeBytes: { type: Number, required: true, min: 1, max: 50 * 1024 * 1024 },
    width: { type: Number, default: 0, min: 0, max: 20000 },
    height: { type: Number, default: 0, min: 0, max: 20000 },
    variants: {
      thumbnail: { type: mediaVariantSchema, default: undefined },
      card: { type: mediaVariantSchema, default: undefined },
      medium: { type: mediaVariantSchema, default: undefined },
      large: { type: mediaVariantSchema, default: undefined },
      banner: { type: mediaVariantSchema, default: undefined },
    },
    altText: { type: String, default: "", trim: true, maxlength: 300 },
    caption: { type: String, default: "", trim: true, maxlength: 1000 },
    active: { type: Boolean, default: true, index: true },
    uploadedBy: { type: String, default: "crm-admin", trim: true, maxlength: 160 },
    updatedBy: { type: String, default: "crm-admin", trim: true, maxlength: 160 },
  },
  { collection: "websitemedia", timestamps: true, strict: true },
);

websiteMediaSchema.index({ active: 1, createdAt: -1, _id: -1 });
websiteMediaSchema.index({ altText: 1, fileName: 1, _id: 1 });

module.exports = mongoose.model("WebsiteMedia", websiteMediaSchema, "websitemedia");
