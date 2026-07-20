const CommunicationTemplate = require("../../models/CommunicationTemplate");
const Enquiry = require("../../models/Enquiry");
const LeadDistribution = require("../../models/LeadDistribution");
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

function providerName(provider = {}, distribution = {}, context = {}) {
  return clean(
    provider.businessName ||
      provider.name ||
      distribution.providerBusinessName ||
      distribution.providerName ||
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

function eventTimestamp(context = {}, distribution = {}, lead = {}) {
  return (
    context.eventAt ||
    context.updatedAt ||
    context.unlockedAt ||
    context.idempotencySuffix ||
    distribution.providerSaleOutcomeUpdatedAt ||
    distribution.providerLeadStatusUpdatedAt ||
    distribution.unlockedAt ||
    lead.statusUpdatedAt ||
    lead.updatedAt ||
    new Date().toISOString()
  );
}

async function hydrateContext(event, context = {}) {
  const hydrated = { ...context };
  let distribution = context.distribution || null;
  let lead = context.lead || null;
  let provider = context.provider || null;

  if (!distribution) {
    const leadDistributionId = clean(context.leadDistributionId || context.distributionId);
    if (leadDistributionId) {
      distribution = await LeadDistribution.findOne(
        queryByPublicId(leadDistributionId, "leadDistributionId"),
      ).lean();
    } else {
      const enquiryId = clean(context.enquiryId || lead?.enquiryId || lead?.id);
      const providerId = clean(context.providerId || provider?.providerId || provider?.id);
      if (enquiryId && providerId) {
        distribution = await LeadDistribution.findOne({ enquiryId, providerId }).lean();
      }
    }
  }

  const enquiryId = clean(
    context.enquiryId ||
      lead?.enquiryId ||
      lead?.id ||
      distribution?.enquiryId,
  );
  if (!lead && enquiryId) {
    lead = await Enquiry.findOne(queryByPublicId(enquiryId, "enquiryId")).lean();
  }

  const providerId = clean(
    context.providerId ||
      provider?.providerId ||
      provider?.id ||
      distribution?.providerId,
  );
  if (providerId) {
    // Always prefer the CRM provider record for the recipient email address.
    provider = await Provider.findOne(queryByPublicId(providerId, "providerId")).lean();
  }

  hydrated.event = clean(event).toLowerCase().replace(/[\s-]+/g, "_");
  hydrated.distribution = distribution || {};
  hydrated.lead = lead || {};
  hydrated.provider = provider || {};
  hydrated.enquiryId = enquiryId;
  hydrated.providerId = providerId;
  hydrated.leadDistributionId = clean(
    context.leadDistributionId ||
      context.distributionId ||
      distribution?.leadDistributionId ||
      distribution?.id,
  );
  hydrated.eventAt = formatDate(eventTimestamp(context, distribution || {}, lead || {}));
  return hydrated;
}

function variablesFor(context) {
  const lead = context.lead || {};
  const distribution = context.distribution || {};
  const provider = context.provider || {};
  const title = clean(
    lead.requirementTitle ||
      lead.leadTitle ||
      lead.serviceType ||
      distribution.leadTitle ||
      distribution.serviceType ||
      "Service requirement",
  );
  const category = clean(
    lead.category ||
      lead.categorySlug ||
      distribution.category ||
      distribution.categorySlug ||
      "Not specified",
  );
  const location = [
    clean(distribution.city || lead.city),
    clean(distribution.state || lead.state),
  ].filter(Boolean).join(", ") || "Not specified";
  const outcome = clean(
    context.outcome ||
      context.providerSaleOutcome ||
      distribution.providerSaleOutcome ||
      "Not set",
  ).replace(/_/g, " ");
  const activityStatus = clean(
    context.activityStatus ||
      context.status ||
      context.providerLeadStatus ||
      distribution.providerLeadStatus ||
      "Not set",
  ).replace(/_/g, " ");
  const reason = clean(context.reason || distribution.providerLeadReason || "Not provided");
  const note = clean(
    context.note ||
      context.outcomeNote ||
      context.providerSaleOutcomeNote ||
      distribution.providerLeadNote ||
      distribution.providerSaleOutcomeNote ||
      "Not provided",
  );
  const creditsUsed = Number(
    context.creditsUsed ??
      context.effectiveLeadCostCredits ??
      distribution.effectiveLeadCostCredits ??
      distribution.leadCostCredits ??
      0,
  );

  return {
    provider_name: providerName(provider, distribution, context),
    lead_id: clean(context.enquiryId || lead.enquiryId || lead.id || distribution.enquiryId || "Not available"),
    lead_distribution_id: clean(context.leadDistributionId || distribution.leadDistributionId || distribution.id || ""),
    requirement_title: title,
    category,
    location,
    credits_used: Number.isFinite(creditsUsed) ? String(creditsUsed) : "0",
    unlock_method: clean(context.unlockMethod || distribution.unlockMethod || "credits").replace(/_/g, " "),
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
  if (variables.lead_distribution_id) lines.push(`Distribution: ${variables.lead_distribution_id}`);
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
  const reference = context.leadDistributionId || context.enquiryId || context.providerId || "crm";
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
        leadDistributionId: context.leadDistributionId || "",
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
  const reference = context.leadDistributionId || context.enquiryId || context.providerId || "provider";
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
        leadDistributionId: context.leadDistributionId || "",
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
