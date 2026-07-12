const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const communicationSchema = new mongoose.Schema(
  {
    communicationId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    enquiryId: { type: String, default: "", index: true },
    providerId: { type: String, default: "", index: true },
    recipientName: { type: String, default: "", maxlength: 120 },
    recipientContact: { type: String, default: "", maxlength: 254 },
    channel: { type: String, default: "call", index: true, enum: ["call", "whatsapp", "email", "sms"] },
    direction: { type: String, default: "outbound", enum: ["outbound", "inbound"] },
    message: { type: String, default: "", maxlength: 10000 },
    status: { type: String, default: "logged", maxlength: 50 },
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

module.exports = mongoose.model(
  "Communication",
  communicationSchema,
  "communications",
);
