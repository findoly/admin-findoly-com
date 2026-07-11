const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const communicationSchema = new mongoose.Schema(
  {
    communicationId: { type: String, default: uuid, unique: true, index: true },
    enquiryId: { type: String, default: "", index: true },
    providerId: { type: String, default: "", index: true },
    recipientName: { type: String, default: "" },
    recipientContact: { type: String, default: "" },
    channel: { type: String, default: "call", index: true },
    direction: { type: String, default: "outbound" },
    message: { type: String, default: "" },
    status: { type: String, default: "logged" },
    externalResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: "communications",
    timestamps: true,
    strict: false,
  },
);

module.exports = mongoose.model(
  "Communication",
  communicationSchema,
  "communications",
);
