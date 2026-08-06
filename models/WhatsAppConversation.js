const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const whatsappConversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    contactNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      match: /^[6-9]\d{9}$/,
    },
    displayName: { type: String, default: "", trim: true, maxlength: 120 },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    unreadCount: { type: Number, default: 0, min: 0, index: true },
    lastMessageId: { type: String, default: "", index: true },
    lastMessagePreview: { type: String, default: "", maxlength: 240 },
    lastMessageType: { type: String, default: "text", maxlength: 40 },
    lastMessageDirection: { type: String, enum: ["", "inbound", "outbound"], default: "" },
    lastMessageStatus: { type: String, default: "", maxlength: 50 },
    lastMessageAt: { type: Date, default: null, index: true },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },
    latestEnquiryId: { type: String, default: "", index: true },
    latestEnquiryName: { type: String, default: "", maxlength: 120 },
    matchedEnquiryCount: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: "", maxlength: 254 },
    lastReadAt: { type: Date, default: null },
    lastReadBy: { type: String, default: "", maxlength: 254 },
  },
  {
    collection: "whatsapp_conversations",
    timestamps: true,
    strict: true,
  },
);

whatsappConversationSchema.index({ status: 1, lastMessageAt: -1, _id: -1 });
whatsappConversationSchema.index({ unreadCount: 1, lastMessageAt: -1, _id: -1 });
whatsappConversationSchema.index({ displayName: 1, lastMessageAt: -1, _id: -1 });
whatsappConversationSchema.index({ latestEnquiryId: 1, lastMessageAt: -1, _id: -1 });

module.exports = mongoose.model(
  "WhatsAppConversation",
  whatsappConversationSchema,
  "whatsapp_conversations",
);
