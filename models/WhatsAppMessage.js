const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const whatsappMediaSchema = new mongoose.Schema(
  {
    storageStatus: {
      type: String,
      enum: ["none", "pending", "processing", "stored", "failed"],
      default: "none",
      index: true,
    },
    source: { type: String, default: "", maxlength: 40 },
    fileName: { type: String, default: "", maxlength: 255 },
    contentType: { type: String, default: "", maxlength: 200 },
    sizeBytes: { type: Number, default: 0, min: 0 },
    caption: { type: String, default: "", maxlength: 4096 },
    s3Key: { type: String, default: "", maxlength: 1500 },
    errorCode: { type: String, default: "", maxlength: 120 },
    failureReason: { type: String, default: "", maxlength: 1000 },
    attemptedAt: { type: Date, default: null },
    storedAt: { type: Date, default: null },
  },
  { _id: false, strict: true },
);


const whatsappLocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, default: null, min: -90, max: 90 },
    longitude: { type: Number, default: null, min: -180, max: 180 },
    name: { type: String, default: "", maxlength: 200 },
    address: { type: String, default: "", maxlength: 500 },
  },
  { _id: false, strict: true },
);

const whatsappMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    conversationId: { type: String, required: true, index: true, immutable: true },
    communicationId: { type: String, default: "" },
    providerMessageId: { type: String, default: "", maxlength: 500 },
    providerMessageIds: { type: [String], default: [] },
    idempotencyKey: { type: String, required: true, maxlength: 300 },
    direction: { type: String, required: true, enum: ["inbound", "outbound"], index: true },
    messageType: {
      type: String,
      enum: ["text", "image", "document", "audio", "video", "location", "contact", "sticker", "interactive", "unknown"],
      default: "text",
    },
    text: { type: String, default: "", maxlength: 10000 },
    status: { type: String, default: "received", maxlength: 50, index: true },
    actor: { type: String, default: "", maxlength: 254 },
    employeeId: { type: String, default: "", maxlength: 120, index: true },
    employeeName: { type: String, default: "", maxlength: 120 },
    failureReason: { type: String, default: "", maxlength: 3000 },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    crmReadAt: { type: Date, default: null, index: true },
    media: { type: whatsappMediaSchema, default: () => ({}) },
    location: { type: whatsappLocationSchema, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: "whatsapp_messages",
    timestamps: true,
    strict: true,
  },
);

whatsappMessageSchema.index({ conversationId: 1, occurredAt: -1, _id: -1 });
whatsappMessageSchema.index({ conversationId: 1, direction: 1, crmReadAt: 1, occurredAt: -1 });
whatsappMessageSchema.index({ providerMessageIds: 1 });
whatsappMessageSchema.index({ "media.storageStatus": 1, occurredAt: -1 });
whatsappMessageSchema.index(
  { communicationId: 1 },
  { unique: true, partialFilterExpression: { communicationId: { $type: "string", $gt: "" } } },
);
whatsappMessageSchema.index(
  { providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: "string", $gt: "" } } },
);
whatsappMessageSchema.index({ idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model(
  "WhatsAppMessage",
  whatsappMessageSchema,
  "whatsapp_messages",
);
