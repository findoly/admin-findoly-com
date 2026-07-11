const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const followUpSchema = new mongoose.Schema(
  {
    followUpId: { type: String, default: uuid, unique: true, index: true },
    enquiryId: { type: String, default: "", index: true },
    customerName: { type: String, default: "" },
    title: { type: String, required: true },
    dueAt: { type: String, default: "", index: true },
    owner: { type: String, default: "admin" },
    channel: { type: String, default: "call" },
    status: { type: String, default: "open", index: true },
    notes: { type: String, default: "" },
  },
  {
    collection: "followups",
    timestamps: true,
    strict: false,
  },
);

module.exports = mongoose.model("FollowUp", followUpSchema, "followups");
