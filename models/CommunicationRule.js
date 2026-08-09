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
    whatsappParameterMappings: { type: [String], default: [] },
    whatsappActionType: {
      type: String,
      default: "",
      enum: ["", "unlock_lead"],
    },
    whatsappActionButtonIndex: { type: Number, default: null, min: 0, max: 9 },
    emailEnabled: { type: Boolean, default: false },
    emailTemplateId: { type: String, default: "", index: true },
    recipientSource: {
      type: String,
      default: "customer",
      enum: ["customer", "provider", "agent", "employee", "manual", "internal"],
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
communicationRuleSchema.index({ enabled: 1, event: 1, _id: 1 });
communicationRuleSchema.index({ event: 1, name: 1, _id: 1 });
communicationRuleSchema.index({ name: 1, _id: 1 });
communicationRuleSchema.index({ updatedAt: -1, _id: -1 });
communicationRuleSchema.index({ recipientSource: 1, event: 1, _id: 1 });

module.exports = mongoose.model(
  "CommunicationRule",
  communicationRuleSchema,
  "communication_rules",
);
