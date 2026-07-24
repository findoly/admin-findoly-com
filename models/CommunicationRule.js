const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const communicationRuleSchema = new mongoose.Schema(
  {
    ruleId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    event: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      index: true,
    },
    enabled: { type: Boolean, default: false, index: true },
    whatsappEnabled: { type: Boolean, default: false },
    whatsappTemplateId: { type: String, default: "", index: true },
    emailEnabled: { type: Boolean, default: false },
    emailTemplateId: { type: String, default: "", index: true },
    slackEnabled: { type: Boolean, default: false },
    slackChannelId: { type: String, default: "", trim: true, maxlength: 100, index: true },
    slackChannelName: { type: String, default: "", trim: true, maxlength: 100 },
    slackMessage: { type: String, default: "", maxlength: 10000 },
    recipientSource: {
      type: String,
      default: "customer",
      enum: ["customer", "provider", "agent", "employee", "manual"],
    },
    description: { type: String, default: "", maxlength: 1000 },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  {
    collection: "communication_rules",
    timestamps: true,
    strict: true,
  },
);

communicationRuleSchema.index({ event: 1, recipientSource: 1 }, { unique: true });
communicationRuleSchema.index({ enabled: 1, event: 1 });

module.exports = mongoose.model(
  "CommunicationRule",
  communicationRuleSchema,
  "communication_rules",
);
