const crypto = require("crypto");

const BASE_URL = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com/v1";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`${name} is not configured`), { status: 503 });
  return value;
}

function basicAuthHeader() {
  const keyId = requiredEnv("RAZORPAY_KEY_ID");
  const keySecret = requiredEnv("RAZORPAY_KEY_SECRET");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function createPayout(input = {}) {
  const timeoutMs = Math.min(Math.max(Number(process.env.RAZORPAY_HTTP_TIMEOUT_MS || 15000) || 15000, 1000), 60000);
  let response;
  try {
    response = await fetch(`${BASE_URL}/payouts`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      "X-Payout-Idempotency": input.idempotencyKey,
    },
      body: JSON.stringify({
      account_number: requiredEnv("RAZORPAYX_ACCOUNT_NUMBER"),
      fund_account_id: input.fundAccountId,
      amount: input.amountPaise,
      currency: "INR",
      mode: input.mode,
      purpose: "payout",
      queue_if_low_balance: false,
      reference_id: input.referenceId,
      narration: String(input.narration || "Findoly partner payout").slice(0, 30),
        notes: input.notes || {},
      }),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    throw Object.assign(
      new Error(error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Razorpay payout request timed out"
        : "Unable to connect to Razorpay"),
      { status: 503, code: "RAZORPAY_UNAVAILABLE", cause: error },
    );
  }

  const raw = await response.text().catch(() => "");
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch (_error) { body = { message: raw.slice(0, 1000) }; }
  if (!response.ok) {
    const description = body?.error?.description || body?.error?.reason || body?.message || "Razorpay payout request failed";
    const error = Object.assign(new Error(description), { status: 502, providerBody: body });
    throw error;
  }
  return body;
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = requiredEnv("RAZORPAY_PAYOUT_WEBHOOK_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { createPayout, verifyWebhookSignature };
