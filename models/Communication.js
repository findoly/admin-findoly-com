const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const communicationSchema = new mongoose.Schema(
  {
    communicationId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    enquiryId: { type: String, default: "", index: true },
    providerId: { type: String, default: "", index: true },
    agentId: { type: String, default: "", index: true },
    templateId: { type: String, default: "", index: true },
    ruleId: { type: String, default: "", index: true },
    recipientName: { type: String, default: "", maxlength: 120 },
    recipientContact: { type: String, default: "", maxlength: 254 },
    channel: {
      type: String,
      default: "call",
      index: true,
      enum: ["call", "whatsapp", "email", "sms", "slack"],
    },
    direction: {
      type: String,
      default: "outbound",
      enum: ["outbound", "inbound"],
    },
    purpose: { type: String, default: "manual", index: true, maxlength: 100 },
    trigger: { type: String, default: "manual", index: true, maxlength: 100 },
    subject: { type: String, default: "", maxlength: 300 },
    message: { type: String, default: "", maxlength: 100000 },
    variables: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    automatic: { type: Boolean, default: false, index: true },
    actor: { type: String, default: "", maxlength: 254 },
    status: { type: String, default: "logged", maxlength: 50, index: true },
    deliveryMode: {
      type: String,
      default: "manual",
      enum: ["manual", "local", "lambda"],
    },
    deliveryProvider: {
      type: String,
      default: "manual",
      enum: ["manual", "meta", "ses", "slack", "lambda"],
    },
    providerMessageId: { type: String, default: "", index: true },
    idempotencyKey: { type: String, default: "" },
    failureReason: { type: String, default: "", maxlength: 3000 },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    externalResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: "communications",
    timestamps: true,
    strict: false,
  },
);

communicationSchema.index({ createdAt: -1, _id: -1 });
communicationSchema.index({ channel: 1, createdAt: -1, _id: -1 });
communicationSchema.index({ enquiryId: 1, createdAt: -1, _id: -1 });
communicationSchema.index({ status: 1, createdAt: -1 });
const communicationRetentionDays = Math.max(1, Number(process.env.COMMUNICATION_LOG_RETENTION_DAYS || 7) || 7);
communicationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: communicationRetentionDays * 24 * 60 * 60, name: "communication_log_ttl" },
);
communicationSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string", $gt: "" } } },
);

module.exports = mongoose.model(
  "Communication",
  communicationSchema,
  "communications",
);
