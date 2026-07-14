const mongoose = require("mongoose");
const uuid = require("../utils/uuid");

const otpRequestSchema = new mongoose.Schema(
  {
    otpId: {
      type: String,
      default: uuid,
      unique: true,
      index: true,
      immutable: true,
    },
    recipient: { type: String, required: true, index: true },
    purpose: { type: String, default: "login", trim: true, maxlength: 80, index: true },
    channel: { type: String, default: "whatsapp", enum: ["whatsapp", "email"] },
    otpHash: { type: String, required: true, select: false },
    salt: { type: String, required: true, select: false },
    status: {
      type: String,
      default: "sent",
      enum: ["sent", "verified", "expired", "blocked", "failed"],
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1, max: 20 },
    expiresAt: { type: Date, required: true, index: true },
    resendAfter: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    communicationId: { type: String, default: "", index: true },
    templateId: { type: String, default: "", index: true },
    requestIp: { type: String, default: "", maxlength: 100 },
    userAgent: { type: String, default: "", maxlength: 500 },
    failureReason: { type: String, default: "", maxlength: 1000 },
    purgeAt: { type: Date, required: true },
  },
  {
    collection: "otp_requests",
    timestamps: true,
    strict: true,
  },
);

const otpRetentionDays = Math.max(1, Number(process.env.OTP_RETENTION_DAYS || 7) || 7);
otpRequestSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: otpRetentionDays * 24 * 60 * 60, name: "otp_activity_ttl" },
);
otpRequestSchema.index({ recipient: 1, purpose: 1, createdAt: -1 });
otpRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("OtpRequest", otpRequestSchema, "otp_requests");
