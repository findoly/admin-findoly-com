const crypto = require("crypto");
const OtpRequest = require("../../models/OtpRequest");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const communicationService = require("./communication-service");
const { validateMobile } = require("../../utils/mobile");
const {
  textValue,
  enumValue,
  identifierValue,
  numberValue,
  validationError,
} = require("../../utils/validation");

const secret = function () {
  const value = process.env.OTP_SECRET || "";
  if (!value || value.length < 16) {
    throw validationError("OTP_SECRET must be configured with at least 16 characters", 503);
  }
  return value;
};

const settings = function () {
  return {
    expiryMinutes: numberValue(process.env.OTP_EXPIRY_MINUTES, { label: "OTP expiry", fallback: 5, min: 1, max: 30, integer: true }),
    resendSeconds: numberValue(process.env.OTP_RESEND_SECONDS, { label: "OTP resend delay", fallback: 60, min: 15, max: 3600, integer: true }),
    maxAttempts: numberValue(process.env.OTP_MAX_ATTEMPTS, { label: "OTP maximum attempts", fallback: 5, min: 1, max: 20, integer: true }),
    retentionDays: numberValue(process.env.OTP_RETENTION_DAYS, { label: "OTP retention days", fallback: 7, min: 1, max: 365, integer: true }),
  };
};

const hashOtp = function (otp, salt) {
  return crypto.createHmac("sha256", secret()).update(`${salt}:${otp}`).digest("hex");
};

const secureEqual = function (left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const generateOtp = function () {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
};

const findTemplate = async function (templateId, channel) {
  const query = {
    channel,
    isActive: true,
  };
  if (templateId) query.templateId = identifierValue(templateId, { label: "OTP template ID" });
  if (channel === "whatsapp") {
    query.category = "authentication";
    query.status = "approved";
  }
  if (channel === "email") query.status = { $in: ["active", "approved"] };
  const template = await CommunicationTemplate.findOne(query).sort({ updatedAt: -1 }).lean();
  if (!template) throw validationError(`No active ${channel} OTP template is configured`);
  return template;
};

const enforceRateLimits = async function (recipient, purpose, requestIp, now) {
  const latest = await OtpRequest.findOne({ recipient, purpose }).sort({ createdAt: -1 }).lean();
  if (latest?.resendAfter && new Date(latest.resendAfter) > now) {
    const seconds = Math.ceil((new Date(latest.resendAfter).getTime() - now.getTime()) / 1000);
    throw validationError(`Please wait ${seconds} seconds before requesting another OTP`, 429);
  }
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recipientCount = await OtpRequest.countDocuments({ recipient, createdAt: { $gte: hourAgo } });
  if (recipientCount >= Number(process.env.OTP_MAX_REQUESTS_PER_HOUR || 10)) {
    throw validationError("Too many OTP requests for this recipient", 429);
  }
  if (requestIp) {
    const ipCount = await OtpRequest.countDocuments({ requestIp, createdAt: { $gte: hourAgo } });
    if (ipCount >= Number(process.env.OTP_MAX_IP_REQUESTS_PER_HOUR || 30)) {
      throw validationError("Too many OTP requests from this network", 429);
    }
  }
};

const send = async function (input, request) {
  const source = input || {};
  const channel = enumValue(source.channel, ["whatsapp", "email"], {
    label: "OTP channel",
    fallback: "whatsapp",
  });
  const recipient = channel === "whatsapp"
    ? validateMobile(source.recipient || source.mobile, { label: "OTP mobile number" })
    : require("../../utils/validation").emailValue(source.recipient || source.email, { label: "OTP email", required: true });
  const purpose = textValue(source.purpose, { label: "OTP purpose", fallback: "login", maxLength: 80 }).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(purpose)) throw validationError("OTP purpose is invalid");
  const requestIp = String(request?.ip || request?.socket?.remoteAddress || "").slice(0, 100);
  const now = new Date();
  await enforceRateLimits(recipient, purpose, requestIp, now);
  const template = await findTemplate(source.templateId, channel);
  const config = settings();
  const otp = generateOtp();
  const salt = crypto.randomBytes(16).toString("hex");
  const record = await OtpRequest.create({
    recipient,
    purpose,
    channel,
    otpHash: hashOtp(otp, salt),
    salt,
    status: "sent",
    attempts: 0,
    maxAttempts: config.maxAttempts,
    expiresAt: new Date(now.getTime() + config.expiryMinutes * 60 * 1000),
    resendAfter: new Date(now.getTime() + config.resendSeconds * 1000),
    templateId: template.templateId,
    requestIp,
    userAgent: String(request?.get?.("user-agent") || "").slice(0, 500),
    purgeAt: new Date(now.getTime() + config.retentionDays * 24 * 60 * 60 * 1000),
  });

  try {
    const communication = await communicationService.send(
      {
        channel,
        templateId: template.templateId,
        recipientContact: recipient,
        recipientName: textValue(source.recipientName, { label: "OTP recipient name", maxLength: 120 }),
        purpose: "otp",
        trigger: purpose,
        variables: {
          "1": otp,
          otp,
          customer_name: source.recipientName || "Customer",
        },
        metadata: { otpId: record.otpId, purpose },
        idempotencyKey: `otp:${record.otpId}`,
      },
      "otp-service",
    );
    await OtpRequest.updateOne({ otpId: record.otpId }, { $set: { communicationId: communication.communicationId } });
  } catch (error) {
    await OtpRequest.updateOne(
      { otpId: record.otpId },
      { $set: { status: "failed", failureReason: String(error.message || "OTP delivery failed").slice(0, 1000) } },
    );
    throw error;
  }

  return {
    otpId: record.otpId,
    recipient,
    channel,
    purpose,
    expiresAt: record.expiresAt,
    resendAfter: record.resendAfter,
  };
};

const verify = async function (input) {
  const source = input || {};
  const otp = textValue(source.otp, { label: "OTP", required: true, maxLength: 12 });
  if (!/^\d{6}$/.test(otp)) throw validationError("OTP must contain exactly 6 digits");
  const query = {};
  if (source.otpId) query.otpId = identifierValue(source.otpId, { label: "OTP request ID" });
  else {
    query.recipient = validateMobile(source.recipient || source.mobile, { label: "OTP mobile number" });
    query.purpose = textValue(source.purpose, { label: "OTP purpose", fallback: "login", maxLength: 80 }).toLowerCase();
    query.status = "sent";
  }
  const record = await OtpRequest.findOne(query).sort({ createdAt: -1 }).select("+otpHash +salt");
  if (!record) throw validationError("OTP request was not found or is no longer active", 404);
  const now = new Date();
  if (record.status === "verified") return { verified: true, otpId: record.otpId, verifiedAt: record.verifiedAt };
  if (record.expiresAt <= now) {
    record.status = "expired";
    await record.save();
    throw validationError("OTP has expired", 410);
  }
  if (record.attempts >= record.maxAttempts || record.status === "blocked") {
    if (record.status !== "blocked") {
      record.status = "blocked";
      await record.save();
    }
    throw validationError("OTP verification is blocked after too many attempts", 429);
  }
  record.attempts += 1;
  if (!secureEqual(hashOtp(otp, record.salt), record.otpHash)) {
    if (record.attempts >= record.maxAttempts) record.status = "blocked";
    await record.save();
    throw validationError(record.status === "blocked" ? "OTP verification is blocked" : "OTP is incorrect", record.status === "blocked" ? 429 : 400);
  }
  record.status = "verified";
  record.verifiedAt = now;
  await record.save();
  return { verified: true, otpId: record.otpId, recipient: record.recipient, purpose: record.purpose, verifiedAt: now };
};

const list = async function (filters) {
  const query = {};
  if (filters?.status) query.status = enumValue(filters.status, ["sent", "verified", "expired", "blocked", "failed"], { label: "OTP status filter" });
  if (filters?.channel) query.channel = enumValue(filters.channel, ["whatsapp", "email"], { label: "OTP channel filter" });
  const limit = numberValue(filters?.limit, { label: "OTP list limit", fallback: 100, min: 1, max: 500, integer: true });
  return OtpRequest.find(query)
    .select("-otpHash -salt")
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
};

module.exports = { send, verify, list, hashOtp, generateOtp, enforceRateLimits };
