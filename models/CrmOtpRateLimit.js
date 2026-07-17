const mongoose = require("mongoose");

const crmOtpRateLimitSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    windowStartedAt: { type: Date, required: true },
    sendCount: { type: Number, default: 0, min: 0 },
    nextAllowedAt: { type: Date, required: true },
    lastRequestId: { type: String, default: "", index: true },
    version: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "crm_otp_rate_limits",
    timestamps: true,
    strict: true,
  },
);

crmOtpRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "crm_otp_rate_limit_ttl" },
);

module.exports = mongoose.model(
  "CrmOtpRateLimit",
  crmOtpRateLimitSchema,
  "crm_otp_rate_limits",
);
