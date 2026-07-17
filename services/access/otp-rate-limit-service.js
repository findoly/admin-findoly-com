const crypto = require("crypto");
const CrmOtpRateLimit = require("../../models/CrmOtpRateLimit");

function integerSetting(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function settings() {
  return {
    resendSeconds: integerSetting(process.env.CRM_OTP_RESEND_SECONDS, 30, 1, 3600),
    maxSendsPerWindow: integerSetting(process.env.CRM_OTP_MAX_SENDS_PER_MINUTE, 2, 1, 20),
    windowSeconds: integerSetting(process.env.CRM_OTP_RATE_WINDOW_SECONDS, 60, 10, 3600),
  };
}

function secondsUntil(date, now) {
  if (!date) return 0;
  return Math.max(0, Math.ceil((new Date(date).getTime() - now.getTime()) / 1000));
}

function rateLimitDecision(state, now = new Date(), config = settings()) {
  if (!state) {
    return {
      allowed: true,
      waitSeconds: 0,
      windowExpired: true,
      nextCount: 1,
      windowStartedAt: now,
    };
  }

  const windowStartedAt = new Date(state.windowStartedAt || now);
  const windowEndsAt = new Date(windowStartedAt.getTime() + config.windowSeconds * 1000);
  const windowExpired = windowEndsAt <= now;
  const currentCount = windowExpired ? 0 : Number(state.sendCount || 0);
  const cooldownWait = secondsUntil(state.nextAllowedAt, now);
  const windowWait = !windowExpired && currentCount >= config.maxSendsPerWindow
    ? secondsUntil(windowEndsAt, now)
    : 0;
  const waitSeconds = Math.max(cooldownWait, windowWait);

  return {
    allowed: waitSeconds === 0,
    waitSeconds,
    windowExpired,
    nextCount: currentCount + 1,
    windowStartedAt: windowExpired ? now : windowStartedAt,
  };
}

function rateLimitError(waitSeconds) {
  const seconds = Math.max(1, Number(waitSeconds) || 1);
  const error = new Error(
    `You requested an OTP too recently. Please wait ${seconds} second${seconds === 1 ? "" : "s"} before requesting a new OTP.`,
  );
  error.status = 429;
  error.code = "CRM_OTP_SEND_RATE_LIMIT";
  error.retryAfterSeconds = seconds;
  return error;
}

async function claimSendSlot(mobile, now = new Date()) {
  const config = settings();
  const requestId = crypto.randomUUID();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await CrmOtpRateLimit.findOne({ mobile }).lean();
    const decision = rateLimitDecision(state, now, config);
    if (!decision.allowed) throw rateLimitError(decision.waitSeconds);

    const nextAllowedAt = new Date(now.getTime() + config.resendSeconds * 1000);
    const expiresAt = new Date(
      now.getTime() + Math.max(config.windowSeconds, config.resendSeconds) * 5 * 1000,
    );

    if (!state) {
      try {
        await CrmOtpRateLimit.create({
          mobile,
          windowStartedAt: decision.windowStartedAt,
          sendCount: decision.nextCount,
          nextAllowedAt,
          lastRequestId: requestId,
          version: 1,
          expiresAt,
        });
        return { requestId, retryAfterSeconds: config.resendSeconds };
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
    }

    const result = await CrmOtpRateLimit.updateOne(
      { _id: state._id, version: Number(state.version || 0) },
      {
        $set: {
          windowStartedAt: decision.windowStartedAt,
          sendCount: decision.nextCount,
          nextAllowedAt,
          lastRequestId: requestId,
          expiresAt,
        },
        $inc: { version: 1 },
      },
    );
    if (result.modifiedCount === 1) {
      return { requestId, retryAfterSeconds: config.resendSeconds };
    }
  }

  const latest = await CrmOtpRateLimit.findOne({ mobile }).lean();
  const decision = rateLimitDecision(latest, new Date(), config);
  throw rateLimitError(decision.waitSeconds || config.resendSeconds);
}

async function releaseSendSlot(mobile, requestId, now = new Date()) {
  if (!mobile || !requestId) return;
  const state = await CrmOtpRateLimit.findOne({ mobile, lastRequestId: requestId }).lean();
  if (!state) return;

  const sendCount = Math.max(0, Number(state.sendCount || 0) - 1);
  if (sendCount === 0) {
    await CrmOtpRateLimit.deleteOne({ _id: state._id, lastRequestId: requestId });
    return;
  }

  await CrmOtpRateLimit.updateOne(
    { _id: state._id, lastRequestId: requestId },
    {
      $set: {
        sendCount,
        nextAllowedAt: now,
        lastRequestId: "",
        expiresAt: new Date(now.getTime() + settings().windowSeconds * 5 * 1000),
      },
      $inc: { version: 1 },
    },
  );
}

module.exports = {
  settings,
  secondsUntil,
  rateLimitDecision,
  rateLimitError,
  claimSendSlot,
  releaseSendSlot,
};
