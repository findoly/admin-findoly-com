const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const communicationTemplateSchema = new mongoose.Schema(
  {
    templateId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 512,
      match: /^[a-z0-9_]+$/,
    },
    displayName: { type: String, default: "", trim: true, maxlength: 160 },
    channel: {
      type: String,
      required: true,
      enum: ["whatsapp", "email"],
      index: true,
    },
    category: {
      type: String,
      default: "utility",
      enum: ["authentication", "utility", "marketing", "transactional"],
      index: true,
    },
    language: { type: String, default: "en_US", trim: true, maxlength: 20 },
    subject: { type: String, default: "", maxlength: 300 },
    headerType: {
      type: String,
      default: "none",
      enum: ["none", "text", "image", "video", "document"],
    },
    headerText: { type: String, default: "", maxlength: 500 },
    body: { type: String, required: true, maxlength: 20000 },
    bodyHtml: { type: String, default: "", maxlength: 100000 },
    footer: { type: String, default: "", maxlength: 1000 },
    buttons: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sampleVariables: { type: [String], default: [] },
    otpExpiryMinutes: { type: Number, default: 5, min: 1, max: 90 },
    status: {
      type: String,
      default: "draft",
      enum: [
        "draft",
        "pending",
        "approved",
        "rejected",
        "paused",
        "disabled",
        "active",
        "inactive",
      ],
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    externalTemplateId: { type: String, default: "", index: true },
    rejectionReason: { type: String, default: "", maxlength: 3000 },
    providerPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    submittedAt: { type: Date, default: null },
    syncedAt: { type: Date, default: null },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  {
    collection: "communication_templates",
    timestamps: true,
    strict: true,
  },
);

communicationTemplateSchema.index({ channel: 1, name: 1, language: 1 }, { unique: true });
communicationTemplateSchema.index({ channel: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model(
  "CommunicationTemplate",
  communicationTemplateSchema,
  "communication_templates",
);
