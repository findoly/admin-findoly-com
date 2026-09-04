"use strict";

const CommunicationTemplate = require("../../models/CommunicationTemplate");
const Provider = require("../../models/Provider");
const communicationService = require("./communication-service");

const EVENT_NAME = "provider_plan_purchased";
const TEMPLATE_NAME = "findoly_provider_plan_purchased";
const SUBJECT = "Thank you for growing with Findoly";
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "bounced", "complained", "rejected"]);
const BODY = [
  "Hello {{provider_name}},",
  "",
  "Thank you for choosing Findoly.",
  "",
  "{{plan_status_line}}",
  "",
  "{{total_credits}} credits have been added to your account.",
  "",
  "We're happy to have you grow with us. Our goal is to help you connect with more genuine customer enquiries, win more bookings, and grow your business with Findoly.",
  "",
  "We look forward to being part of your growth journey and bringing you more opportunities ahead.",
  "",
  "Thank you for being a part of Findoly.",
  "",
  "Warm regards,",
  "Team Findoly",
].join("\n");

function clean(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/[<>\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function requiredId(value, label) {
  const result = clean(value, 180);
  if (!result) throw Object.assign(new Error(`${label} is required`), { status: 400 });
  return result;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDateTime(value) {
  const date = validDate(value);
  return date ? date.toISOString() : "";
}

function formatStartDate(value) {
  const date = validDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function planStatusLine(context = {}, planNameInput = "Findoly", now = new Date()) {
  const planName = clean(planNameInput, 160) || "Findoly";
  const status = clean(context.planStatus, 40).toLowerCase();
  const startsAt = validDate(context.startsAt);
  const scheduled = status === "scheduled" && (!startsAt || startsAt > now);
  if (scheduled) {
    const startDate = formatStartDate(startsAt);
    return startDate
      ? `Your ${planName} plan renewal is confirmed and will start on ${startDate}.`
      : `Your ${planName} plan renewal is confirmed and is scheduled to start later.`;
  }
  return `Your ${planName} plan is now active.`;
}

async function ensureTemplate() {
  await CommunicationTemplate.updateOne(
    { channel: "email", name: TEMPLATE_NAME, language: "en_US" },
    {
      $setOnInsert: {
        displayName: "Provider plan purchase confirmation",
        channel: "email",
        category: "transactional",
        language: "en_US",
        subject: SUBJECT,
        body: BODY,
        bodyHtml: "",
        status: "active",
        isActive: true,
        createdBy: "system",
        updatedBy: "system",
      },
    },
    { upsert: true },
  );
  return CommunicationTemplate.findOne({
    channel: "email",
    name: TEMPLATE_NAME,
    language: "en_US",
  }).lean();
}

function acknowledgement(context = {}) {
  return {
    accepted: true,
    eventName: EVENT_NAME,
    integrationEventId: requiredId(context.integrationEventId, "Integration event ID"),
    providerId: requiredId(context.providerId, "Provider ID"),
    paymentOrderId: requiredId(context.paymentOrderId, "Payment order ID"),
    providerSubscriptionId: requiredId(context.providerSubscriptionId, "Provider subscription ID"),
  };
}

function deliveryFailed(communication = {}) {
  return TERMINAL_FAILURE_STATUSES.has(String(communication.status || "").toLowerCase());
}

async function dispatch(context = {}) {
  const ack = acknowledgement(context);
  const provider = await Provider.findOne({
    $or: [{ providerId: ack.providerId }, { id: ack.providerId }],
  }).lean();
  if (!provider) throw Object.assign(new Error("Provider not found"), { status: 404 });

  const providerEmail = clean(provider.email, 254).toLowerCase();
  if (!providerEmail) {
    return {
      acknowledgement: ack,
      channelDeliveries: [{
        channel: "email",
        success: false,
        skipped: true,
        reason: "Provider email is not available in CRM",
      }],
    };
  }

  const template = await ensureTemplate();
  const providerName = clean(provider.businessName || provider.name || "Provider", 160) || "Provider";
  const planName = clean(context.planName || context.planCode || "Findoly", 160) || "Findoly";
  const totalCredits = Number(context.totalCredits || 0);
  const variables = {
    provider_name: providerName,
    plan_name: planName,
    plan_status_line: planStatusLine(context, planName),
    total_credits: Number.isFinite(totalCredits)
      ? totalCredits.toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : "0",
  };

  let communication = await communicationService.send(
    {
      channel: "email",
      templateId: template.templateId,
      recipientName: providerName,
      recipientContact: providerEmail,
      purpose: "provider_plan_purchase_confirmation",
      trigger: EVENT_NAME,
      automatic: true,
      providerId: ack.providerId,
      variables,
      idempotencyKey: `system-event:email:provider-plan-purchased:${ack.paymentOrderId}`,
      metadata: {
        event: EVENT_NAME,
        paymentOrderId: ack.paymentOrderId,
        providerSubscriptionId: ack.providerSubscriptionId,
        planCode: clean(context.planCode, 120),
        billingCycle: clean(context.billingCycle, 80),
        planStatus: clean(context.planStatus, 40),
        startsAt: isoDateTime(context.startsAt),
        source: "provider-portal",
      },
    },
    "integration-api",
  );

  if (deliveryFailed(communication)) {
    communication = await communicationService.retry(
      communication.communicationId,
      "integration-api",
    );
  }

  const failed = deliveryFailed(communication);
  return {
    acknowledgement: ack,
    channelDeliveries: [{
      channel: "email",
      success: !failed,
      communicationId: communication?.communicationId || "",
      status: communication?.status || "",
      ...(failed ? { error: "Provider plan confirmation email delivery failed" } : {}),
    }],
  };
}

module.exports = {
  EVENT_NAME,
  TEMPLATE_NAME,
  SUBJECT,
  BODY,
  TERMINAL_FAILURE_STATUSES,
  clean,
  validDate,
  isoDateTime,
  formatStartDate,
  planStatusLine,
  ensureTemplate,
  acknowledgement,
  deliveryFailed,
  dispatch,
};
