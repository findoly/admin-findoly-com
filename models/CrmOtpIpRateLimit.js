const mongoose = require("mongoose");

const crmOtpIpRateLimitSchema = new mongoose.Schema(
  {
    keyHash: { type: String, required: true, unique: true, trim: true, maxlength: 64 },
    windowStartedAt: { type: Date, required: true },
    sendCount: { type: Number, default: 0, min: 0 },
    lastRequestId: { type: String, default: "", index: true },
    version: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "crm_otp_ip_rate_limits",
    timestamps: true,
    strict: true,
  },
);

crmOtpIpRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "crm_otp_ip_rate_limit_ttl" },
);

module.exports = mongoose.model(
  "CrmOtpIpRateLimit",
  crmOtpIpRateLimitSchema,
  "crm_otp_ip_rate_limits",
);
