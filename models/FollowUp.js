const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const followUpSchema = new mongoose.Schema(
  {
    followUpId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    enquiryId: { type: String, default: "", index: true },
    customerName: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 200 },
    dueAt: { type: Date, default: null, index: true },
    owner: { type: String, default: "admin" },
    channel: { type: String, default: "call", enum: ["call", "whatsapp", "email", "visit"] },
    status: { type: String, default: "open", index: true, enum: ["open", "pending", "completed", "cancelled"] },
    completedAt: { type: Date, default: null, index: true },
    notes: { type: String, default: "", maxlength: 5000 },
    dueAlertStatus: {
      type: String,
      default: "pending",
      enum: ["pending", "processing", "sent", "failed"],
      index: true,
    },
    dueAlertSentAt: { type: Date, default: null },
    dueAlertAttemptedAt: { type: Date, default: null },
    dueAlertAttempts: { type: Number, default: 0, min: 0 },
    dueAlertLastError: { type: String, default: "", maxlength: 1000 },
  },
  {
    collection: "followups",
    timestamps: true,
    strict: false,
  },
);

followUpSchema.index({ dueAt: 1, createdAt: -1, _id: -1 });
followUpSchema.index({ status: 1, dueAt: 1, createdAt: -1, _id: -1 });
followUpSchema.index({ status: 1, dueAlertStatus: 1, dueAt: 1, _id: 1 });
followUpSchema.index({ completedAt: -1, _id: -1 });
followUpSchema.index({ createdAt: -1, _id: -1 });
followUpSchema.index({ updatedAt: -1, _id: -1 });
followUpSchema.index({ status: 1, createdAt: -1, _id: -1 });
followUpSchema.index({ status: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.model("FollowUp", followUpSchema, "followups");
