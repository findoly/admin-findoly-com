const CommunicationTemplate = require("../../models/CommunicationTemplate");
const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const Provider = require("../../models/Provider");
const communicationService = require("./communication-service");

const PROVIDER_EMAIL_EVENTS = new Set([
  "provider_lead_unlocked",
  "provider_feedback_updated",
  "provider_status_updated",
  "provider_outcome_updated",
]);

const SYSTEM_TEMPLATES = Object.freeze({
  provider_lead_unlocked: {
    name: "findoly_provider_lead_unlocked",
    displayName: "Provider lead unlocked",
    subject: "Lead unlocked successfully — {{lead_id}}",
    body: [
      "Hello {{provider_name}},",
      "",
      "You successfully unlocked a Findoly lead.",
      "",
      "Lead reference: {{lead_id}}",
      "Requirement: {{requirement_title}}",
      "Category: {{category}}",
      "Location: {{location}}",
      "Credits used: {{credits_used}}",
      "Unlock method: {{unlock_method}}",
      "Unlocked at: {{event_time}}",
      "",
      "Please contact the customer and keep the lead outcome updated in your provider portal.",
      "",
      "— Findoly",
    ].join("\n"),
  },
  provider_feedback_updated: {
    name: "findoly_provider_status_updated",
    displayName: "Provider lead status updated",
    subject: "Lead status updated — {{lead_id}}",
    body: [
      "Hello {{provider_name}},",
      "",
      "Your lead update has been saved successfully.",
      "",
      "Lead reference: {{lead_id}}",
      "Requirement: {{requirement_title}}",
      "Outcome: {{outcome}}",
      "Activity status: {{activity_status}}",
      "Reason: {{reason}}",
      "Note: {{note}}",
      "Updated at: {{event_time}}",
      "",
      "You can review the latest lead details in your Findoly provider portal.",
      "",
      "— Findoly",
    ].join("\n"),
  },
});

function truthy(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function clean(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[<>]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function token(value) {
  return clean(value || "event")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "event";
}

function queryByPublicId(value, field) {
  const id = clean(value);
  if (!id) return null;
  return { $or: [{ [field]: id }, { id }] };
}

function providerName(provider = {}, unlock = {}, context = {}) {
  return clean(
    provider.businessName ||
      provider.name ||
      unlock.providerBusinessName ||
      unlock.providerName ||
      context.providerName ||
      "Provider",
  );
}

function eventLabel(event) {
  return clean(event)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function eventTimestamp(context = {}, unlock = {}, lead = {}) {
  return (
    context.eventAt ||
    context.updatedAt ||
    context.unlockedAt ||
    context.idempotencySuffix ||
    unlock.providerSaleOutcomeUpdatedAt ||
    unlock.providerLeadStatusUpdatedAt ||
    unlock.unlockedAt ||
    lead.statusUpdatedAt ||
    lead.updatedAt ||
    new Date().toISOString()
  );
}

async function hydrateContext(event, context = {}) {
  const hydrated = { ...context };
  let unlock = context.unlock || null;
  let lead = context.lead || null;
  let provider = context.provider || null;

  if (!unlock) {
    const providerLeadUnlockId = clean(context.providerLeadUnlockId);
    if (providerLeadUnlockId) {
      unlock = await ProviderLeadUnlock.findOne(
        queryByPublicId(providerLeadUnlockId, "providerLeadUnlockId"),
      ).lean();
    } else {
      const enquiryId = clean(context.enquiryId || lead?.enquiryId || lead?.id);
      const providerId = clean(context.providerId || provider?.providerId || provider?.id);
      if (enquiryId && providerId) {
        unlock = await ProviderLeadUnlock.findOne({ enquiryId, providerId }).lean();
      }
    }
  }

  const enquiryId = clean(
    context.enquiryId ||
      lead?.enquiryId ||
      lead?.id ||
      unlock?.enquiryId,
  );
  if (!lead && enquiryId) {
    lead = await Enquiry.findOne(queryByPublicId(enquiryId, "enquiryId")).lean();
  }

  const providerId = clean(
    context.providerId ||
      provider?.providerId ||
      provider?.id ||
      unlock?.providerId,
  );
  if (providerId) {
    // Always prefer the CRM provider record for the recipient email address.
    provider = await Provider.findOne(queryByPublicId(providerId, "providerId")).lean();
  }

  hydrated.event = clean(event).toLowerCase().replace(/[\s-]+/g, "_");
  hydrated.unlock = unlock || {};
  hydrated.lead = lead || {};
  hydrated.provider = provider || {};
  hydrated.enquiryId = enquiryId;
  hydrated.providerId = providerId;
  hydrated.providerLeadUnlockId = clean(
    context.providerLeadUnlockId ||
      unlock?.providerLeadUnlockId ||
      unlock?.id,
  );
  hydrated.eventAt = formatDate(eventTimestamp(context, unlock || {}, lead || {}));
  return hydrated;
}

function variablesFor(context) {
  const lead = context.lead || {};
  const unlock = context.unlock || {};
  const provider = context.provider || {};
  const title = clean(
    lead.requirementTitle ||
      lead.leadTitle ||
      lead.serviceType ||
      unlock.leadTitle ||
      unlock.serviceType ||
      "Service requirement",
  );
  const category = clean(
    lead.category ||
      lead.categorySlug ||
      unlock.category ||
      unlock.categorySlug ||
      "Not specified",
  );
  const location = [
    clean(unlock.city || lead.city),
    clean(unlock.state || lead.state),
  ].filter(Boolean).join(", ") || "Not specified";
  const outcome = clean(
    context.outcome ||
      context.providerSaleOutcome ||
      unlock.providerSaleOutcome ||
      "Not set",
  ).replace(/_/g, " ");
  const activityStatus = clean(
    context.activityStatus ||
      context.status ||
      context.providerLeadStatus ||
      unlock.providerLeadStatus ||
      "Not set",
  ).replace(/_/g, " ");
  const reason = clean(context.reason || unlock.providerLeadReason || "Not provided");
  const note = clean(
    context.note ||
      context.outcomeNote ||
      context.providerSaleOutcomeNote ||
      unlock.providerLeadNote ||
      unlock.providerSaleOutcomeNote ||
      "Not provided",
  );
  const creditsUsed = Number(
    context.creditsUsed ??
      context.effectiveLeadCostCredits ??
      unlock.chargedCredits ??
      0,
  );

  return {
    provider_name: providerName(provider, unlock, context),
    lead_id: clean(context.enquiryId || lead.enquiryId || lead.id || unlock.enquiryId || "Not available"),
    provider_lead_unlock_id: clean(context.providerLeadUnlockId || unlock.providerLeadUnlockId || unlock.id || ""),
    requirement_title: title,
    category,
    location,
    credits_used: Number.isFinite(creditsUsed) ? String(creditsUsed) : "0",
    unlock_method: clean(context.unlockMethod || unlock.unlockMethod || "credits").replace(/_/g, " "),
    outcome,
    activity_status: activityStatus,
    reason,
    note,
    event_time: context.eventAt,
  };
}

function slackMessage(event, context, variables) {
  const lines = [
    `*${eventLabel(event)}*`,
    `Lead: ${variables.lead_id}`,
  ];
  if (variables.provider_lead_unlock_id) lines.push(`Unlock: ${variables.provider_lead_unlock_id}`);
  if (context.providerId || variables.provider_name !== "Provider") {
    lines.push(`Provider: ${variables.provider_name}${context.providerId ? ` (${context.providerId})` : ""}`);
  }
  if (variables.requirement_title) lines.push(`Requirement: ${variables.requirement_title}`);
  if (variables.category && variables.category !== "Not specified") lines.push(`Category: ${variables.category}`);
  if (event === "provider_lead_unlocked") {
    lines.push(`Unlock: ${variables.credits_used} credits via ${variables.unlock_method}`);
  }
  if (PROVIDER_EMAIL_EVENTS.has(event) && event !== "provider_lead_unlocked") {
    lines.push(`Outcome: ${variables.outcome}`);
    lines.push(`Activity: ${variables.activity_status}`);
    if (variables.reason !== "Not provided") lines.push(`Reason: ${variables.reason}`);
    if (variables.note !== "Not provided") lines.push(`Note: ${variables.note}`);
  } else {
    const status = clean(context.status || context.lead?.status || context.lead?.journeyStatus);
    if (status) lines.push(`Status: ${status.replace(/_/g, " ")}`);
    const note = clean(context.note || context.reason);
    if (note) lines.push(`Note: ${note}`);
  }
  lines.push(`At: ${variables.event_time}`);
  return lines.join("\n").slice(0, 10000);
}

async function ensureEmailTemplate(event) {
  const templateDefinition = event === "provider_lead_unlocked"
    ? SYSTEM_TEMPLATES.provider_lead_unlocked
    : SYSTEM_TEMPLATES.provider_feedback_updated;
  await CommunicationTemplate.updateOne(
    {
      channel: "email",
      name: templateDefinition.name,
      language: "en_US",
    },
    {
      $setOnInsert: {
        displayName: templateDefinition.displayName,
        channel: "email",
        category: "transactional",
        language: "en_US",
        subject: templateDefinition.subject,
        body: templateDefinition.body,
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
    name: templateDefinition.name,
    language: "en_US",
  }).lean();
}

async function sendSlack(event, context, variables, actor) {
  if (!truthy(process.env.SYSTEM_EVENT_SLACK_ENABLED, true)) {
    return { channel: "slack", skipped: true, reason: "System Slack events are disabled" };
  }
  const reference = context.providerLeadUnlockId || context.enquiryId || context.providerId || "crm";
  return communicationService.send(
    {
      channel: "slack",
      channelId: process.env.SLACK_DEFAULT_CHANNEL_ID || "",
      channelName: process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team",
      recipientName: "Findoly internal team",
      message: slackMessage(event, context, variables),
      subject: `Findoly event: ${eventLabel(event)}`,
      purpose: "internal_event",
      trigger: event,
      automatic: true,
      enquiryId: context.enquiryId || "",
      providerId: context.providerId || "",
      idempotencyKey: `system-event:slack:${token(event)}:${token(reference)}:${token(context.eventAt)}`,
      metadata: {
        event,
        providerLeadUnlockId: context.providerLeadUnlockId || "",
        source: context.source || "crm",
      },
    },
    actor || "system-event",
  );
}

async function sendProviderEmail(event, context, variables, actor) {
  if (!PROVIDER_EMAIL_EVENTS.has(event)) {
    return { channel: "email", skipped: true, reason: "Email is not enabled for this event" };
  }
  if (!truthy(process.env.PROVIDER_EVENT_EMAIL_ENABLED, true)) {
    return { channel: "email", skipped: true, reason: "Provider event email is disabled" };
  }
  const providerEmail = clean(context.provider?.email).toLowerCase();
  if (!providerEmail) {
    return { channel: "email", skipped: true, reason: "Provider email is not available in CRM" };
  }
  const template = await ensureEmailTemplate(event);
  const reference = context.providerLeadUnlockId || context.enquiryId || context.providerId || "provider";
  return communicationService.send(
    {
      channel: "email",
      templateId: template.templateId,
      recipientName: variables.provider_name,
      recipientContact: providerEmail,
      purpose: event === "provider_lead_unlocked" ? "provider_lead_unlock_confirmation" : "provider_status_update_confirmation",
      trigger: event,
      automatic: true,
      enquiryId: context.enquiryId || "",
      providerId: context.providerId || "",
      variables,
      idempotencyKey: `system-event:email:${token(event)}:${token(reference)}:${token(context.eventAt)}`,
      metadata: {
        event,
        providerLeadUnlockId: context.providerLeadUnlockId || "",
        source: context.source || "provider-portal",
      },
    },
    actor || "system-event",
  );
}

async function settle(channel, task) {
  try {
    const data = await task();
    return { channel, success: !data?.skipped, ...data };
  } catch (error) {
    console.error(`System ${channel} event delivery failed:`, error.message);
    return {
      channel,
      success: false,
      error: String(error.message || `${channel} delivery failed`).slice(0, 1000),
    };
  }
}

async function dispatch(eventInput, contextInput = {}, actor = "system-event") {
  const event = clean(eventInput).toLowerCase().replace(/[\s-]+/g, "_");
  if (!event) return [];

  let context;
  try {
    context = await hydrateContext(event, contextInput || {});
  } catch (error) {
    console.error("System event context hydration failed:", error.message);
    const results = [{
      channel: "slack",
      success: false,
      error: String(error.message || "Event context could not be loaded").slice(0, 1000),
    }];
    if (PROVIDER_EMAIL_EVENTS.has(event)) {
      results.push({
        channel: "email",
        success: false,
        error: String(error.message || "Provider email context could not be loaded").slice(0, 1000),
      });
    }
    return results;
  }

  const variables = variablesFor(context);
  const results = [];
  results.push(await settle("slack", () => sendSlack(event, context, variables, actor)));
  if (PROVIDER_EMAIL_EVENTS.has(event)) {
    results.push(await settle("email", () => sendProviderEmail(event, context, variables, actor)));
  }
  return results;
}

module.exports = {
  PROVIDER_EMAIL_EVENTS,
  SYSTEM_TEMPLATES,
  dispatch,
  hydrateContext,
  variablesFor,
  slackMessage,
};
