const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const followUpSchema = new mongoose.Schema(
  {
    followUpId: { type: String, default: uuid, unique: true, index: true, immutable: true },
    enquiryId: { type: String, default: "", index: true },
    customerName: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 200 },
    dueAt: { type: String, default: "", index: true },
    owner: { type: String, default: "admin" },
    channel: { type: String, default: "call", enum: ["call", "whatsapp", "email", "visit"] },
    status: { type: String, default: "open", index: true, enum: ["open", "pending", "completed", "cancelled"] },
    notes: { type: String, default: "", maxlength: 5000 },
  },
  {
    collection: "followups",
    timestamps: true,
    strict: false,
  },
);

followUpSchema.index({ dueAt: 1, createdAt: -1, _id: -1 });
followUpSchema.index({ status: 1, dueAt: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("FollowUp", followUpSchema, "followups");
