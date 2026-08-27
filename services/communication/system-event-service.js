"use strict";

const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const Provider = require("../../models/Provider");
const Agent = require("../../models/Agent");
const ProviderJoinRequest = require("../../models/ProviderJoinRequest");
const communicationService = require("./communication-service");
const defaultTemplateService = require("./default-template-service");

const INTERNAL_EMAIL_EVENTS = new Set([
  "lead_created",
  "partner_lead_submitted",
  "agent_created",
  "provider_join_request_submitted",
  "provider_created",
]);

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
      "You successfully accessed a Findoly lead.",
      "",
      "Lead reference: {{lead_id}}",
      "Requirement: {{requirement_title}}",
      "Category: {{category}}",
      "Location: {{location}}",
      "Credits used: {{credits_used}}",
      "Access method: {{unlock_method}}",
      "Accessed at: {{event_time}}",
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

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function eventTimestamp(context = {}, unlock = {}, lead = {}, entity = {}) {
  return (
    context.eventAt ||
    context.updatedAt ||
    context.unlockedAt ||
    context.registrationDate ||
    unlock.providerSaleOutcomeUpdatedAt ||
    unlock.providerLeadStatusUpdatedAt ||
    unlock.unlockedAt ||
    lead.statusUpdatedAt ||
    entity.createdAt ||
    lead.updatedAt ||
    new Date().toISOString()
  );
}

async function hydrateContext(event, context = {}) {
  const hydrated = { ...context };
  let unlock = context.unlock || null;
  let lead = context.lead || null;
  let provider = context.provider || null;
  let agent = context.agent || null;
  let providerJoinRequest = context.providerJoinRequest || context.joinRequest || null;

  if (!unlock && PROVIDER_EMAIL_EVENTS.has(event)) {
    const providerLeadUnlockId = clean(context.providerLeadUnlockId);
    if (providerLeadUnlockId) {
      unlock = await ProviderLeadUnlock.findOne(queryByPublicId(providerLeadUnlockId, "providerLeadUnlockId")).lean();
    } else {
      const enquiryId = clean(context.enquiryId || lead?.enquiryId || lead?.id);
      const providerId = clean(context.providerId || provider?.providerId || provider?.id);
      if (enquiryId && providerId) unlock = await ProviderLeadUnlock.findOne({ enquiryId, providerId }).lean();
    }
  }

  const enquiryId = clean(context.enquiryId || lead?.enquiryId || lead?.id || unlock?.enquiryId);
  if (!lead && enquiryId) lead = await Enquiry.findOne(queryByPublicId(enquiryId, "enquiryId")).lean();

  const providerId = clean(context.providerId || provider?.providerId || provider?.id || unlock?.providerId);
  if (!provider && providerId) provider = await Provider.findOne(queryByPublicId(providerId, "providerId")).lean();

  const agentId = clean(context.agentId || agent?.agentId || lead?.agentId);
  if (!agent && agentId) agent = await Agent.findOne(queryByPublicId(agentId, "agentId")).lean();

  const providerJoinRequestId = clean(
    context.providerJoinRequestId || providerJoinRequest?.providerJoinRequestId || providerJoinRequest?.id,
  );
  if (!providerJoinRequest && providerJoinRequestId) {
    providerJoinRequest = await ProviderJoinRequest.findOne(
      queryByPublicId(providerJoinRequestId, "providerJoinRequestId"),
    ).lean();
  }

  const timestampEntity = providerJoinRequest || provider || agent || {};
  hydrated.event = clean(event).toLowerCase().replace(/[\s-]+/g, "_");
  hydrated.unlock = unlock || {};
  hydrated.lead = lead || {};
  hydrated.provider = provider || {};
  hydrated.agent = agent || context.agent || {};
  hydrated.providerJoinRequest = providerJoinRequest || {};
  hydrated.enquiryId = enquiryId;
  hydrated.providerId = providerId;
  hydrated.agentId = agentId;
  hydrated.providerJoinRequestId = providerJoinRequestId;
  hydrated.providerLeadUnlockId = clean(context.providerLeadUnlockId || unlock?.providerLeadUnlockId || unlock?.id);
  hydrated.eventAt = formatDate(eventTimestamp(context, unlock || {}, lead || {}, timestampEntity));
  return hydrated;
}

function joinLocation(...values) {
  return values.map((value) => clean(value)).filter(Boolean).join(", ");
}

function variablesFor(context) {
  const lead = context.lead || {};
  const unlock = context.unlock || {};
  const provider = context.provider || {};
  const agent = context.agent || {};
  const joinRequest = context.providerJoinRequest || {};
  const title = clean(
    lead.providerRequirementTitle || lead.requirementTitle || lead.leadTitle || lead.serviceType || unlock.leadTitle || unlock.serviceType || "Service requirement",
  );
  const category = clean(
    lead.category || lead.categorySlug || unlock.category || unlock.categorySlug || joinRequest.categoryNameSnapshot || joinRequest.categorySlug || "Not specified",
  );
  const serviceTypes = Array.isArray(lead.serviceTypes)
    ? lead.serviceTypes.map((item) => clean(item?.name || item)).filter(Boolean).join(", ")
    : clean(lead.serviceType || unlock.serviceType || "Not specified");
  const leadLocation = joinLocation(unlock.city || lead.city, unlock.state || lead.state, lead.pincode || lead.locationPincode) || "Not specified";
  const providerLocation = joinLocation(provider.city || provider.serviceLocality, provider.state || provider.serviceState, provider.servicePincode) || "Not specified";
  const requestLocation = joinLocation(joinRequest.city, joinRequest.state, joinRequest.servicePincode) || "Not specified";
  const agentLocation = joinLocation(agent.city, agent.state, agent.pincode) || "Not specified";
  const outcome = clean(context.outcome || context.providerSaleOutcome || unlock.providerSaleOutcome || "Not set").replace(/_/g, " ");
  const activityStatus = clean(context.activityStatus || context.status || context.providerLeadStatus || unlock.providerLeadStatus || "Not set").replace(/_/g, " ");
  const reason = clean(context.reason || unlock.providerLeadReason || "Not provided");
  const note = clean(context.note || context.outcomeNote || context.providerSaleOutcomeNote || unlock.providerLeadNote || unlock.providerSaleOutcomeNote || "Not provided");
  const creditsUsed = Number(context.creditsUsed ?? context.effectiveLeadCostCredits ?? unlock.chargedCredits ?? 0);
  const providerDisplayName = providerName(provider, unlock, context);
  const agentName = clean(agent.name || agent.businessName || lead.agentName || lead.agentBusinessName || "Partner");
  const requestName = clean(joinRequest.name || joinRequest.businessName || context.providerName || "Provider");

  return {
    provider_name: context.event === "provider_join_request_submitted" ? requestName : providerDisplayName,
    provider_id: clean(context.providerId || provider.providerId || ""),
    provider_join_request_id: clean(context.providerJoinRequestId || joinRequest.providerJoinRequestId || ""),
    provider_lead_unlock_id: clean(context.providerLeadUnlockId || unlock.providerLeadUnlockId || unlock.id || ""),
    lead_id: clean(context.enquiryId || lead.enquiryId || lead.id || unlock.enquiryId || "Not available"),
    customer_name: clean(lead.name || "Customer"),
    requirement_title: title,
    service_type: clean(lead.serviceType || ""),
    service_types: serviceTypes,
    category,
    location: leadLocation,
    lead_location: leadLocation,
    service_location: context.event === "provider_join_request_submitted" ? requestLocation : providerLocation,
    city: clean(joinRequest.city || provider.city || agent.city || lead.city || ""),
    state: clean(joinRequest.state || provider.state || agent.state || lead.state || ""),
    agent_name: agentName,
    agent_id: clean(agent.agentId || lead.agentId || ""),
    referral_id: clean(agent.referralId || lead.referralId || ""),
    agent_type: clean(agent.agentType || ""),
    category_name: clean((agent.categories || []).map((item) => item?.categoryName).filter(Boolean).join(", ") || agent.categoryName || agent.categorySlug || ""),
    assigned_location: agentLocation,
    business_name: clean(joinRequest.businessName || provider.businessName || agent.businessName || ""),
    service_categories: Array.isArray(provider.categorySlugs) ? provider.categorySlugs.map(clean).filter(Boolean).join(", ") : "",
    status: clean(provider.status || agent.status || joinRequest.status || context.status || lead.status || ""),
    created_by: clean(context.createdBy || context.actor || lead.statusUpdatedBy || "CRM"),
    credits_used: Number.isFinite(creditsUsed) ? String(creditsUsed) : "0",
    unlock_method: clean(context.unlockMethod || unlock.unlockMethod || "credits").replace(/_/g, " "),
    outcome,
    activity_status: activityStatus,
    reason,
    note,
    registration_date: context.eventAt,
    event_time: context.eventAt,
  };
}

async function ensureProviderEmailTemplate(event) {
  const templateDefinition = event === "provider_lead_unlocked"
    ? SYSTEM_TEMPLATES.provider_lead_unlocked
    : SYSTEM_TEMPLATES.provider_feedback_updated;
  await CommunicationTemplate.updateOne(
    { channel: "email", name: templateDefinition.name, language: "en_US" },
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
  return CommunicationTemplate.findOne({ channel: "email", name: templateDefinition.name, language: "en_US" }).lean();
}

function internalEntityReference(event, context) {
  if (["lead_created", "partner_lead_submitted"].includes(event)) return context.enquiryId || context.lead?.enquiryId || "lead";
  if (event === "agent_created") return context.agentId || context.agent?.agentId || "partner";
  if (event === "provider_join_request_submitted") return context.providerJoinRequestId || context.providerJoinRequest?.providerJoinRequestId || "provider-request";
  if (event === "provider_created") return context.providerId || context.provider?.providerId || "provider";
  return event;
}

async function sendInternalEmail(event, context, variables, actor, options = {}) {
  if (!INTERNAL_EMAIL_EVENTS.has(event)) {
    return { channel: "email", skipped: true, reason: "This event is not an internal email alert" };
  }
  if (!options.test && !truthy(process.env.INTERNAL_ALERT_EMAIL_ENABLED, true)) {
    return { channel: "email", skipped: true, reason: "Internal email alerts are disabled" };
  }

  await defaultTemplateService.ensureInternalAlertTemplatesAndRules();
  const rule = await CommunicationRule.findOne({ event, recipientSource: "internal" }).lean();
  if (!rule) return { channel: "email", skipped: true, reason: "Internal email alert rule is missing" };
  if (!options.test && (rule.enabled !== true || rule.emailEnabled !== true)) {
    return { channel: "email", skipped: true, reason: "Internal email alert is disabled" };
  }
  if (!rule.emailTemplateId) return { channel: "email", skipped: true, reason: "Internal email template is not selected" };

  const recipient = clean(process.env.INTERNAL_ALERT_EMAIL || "alert@findoly.com").toLowerCase();
  const reference = internalEntityReference(event, context);
  const idempotencyKey = options.test
    ? `internal-email-test:${token(event)}:${Date.now()}`
    : `internal-email:${token(event)}:${token(reference)}:${token(recipient)}`;
  const logBase = {
    eventName: event,
    enquiryId: context.enquiryId || "",
    providerId: context.providerId || "",
    agentId: context.agentId || context.agent?.agentId || "",
    providerJoinRequestId: context.providerJoinRequestId || "",
    source: context.source || "crm",
  };

  console.info({ event: "internal_email_alert_dispatch_started", ...logBase });
  try {
    let communication = await communicationService.send(
      {
        channel: "email",
        templateId: rule.emailTemplateId,
        ruleId: rule.ruleId,
        recipientName: "Findoly internal alerts",
        recipientContact: recipient,
        purpose: options.test ? "internal_email_alert_test" : "internal_email_alert",
        trigger: event,
        automatic: !options.test,
        enquiryId: context.enquiryId || "",
        providerId: context.providerId || "",
        agentId: context.agentId || context.agent?.agentId || "",
        variables,
        idempotencyKey,
        metadata: {
          event,
          source: context.source || "crm",
          internalAlert: true,
          providerJoinRequestId: context.providerJoinRequestId || "",
          test: options.test === true,
        },
      },
      actor || "system-event",
    );
    const terminalFailureStatuses = new Set(["failed", "bounced", "complained", "rejected"]);
    if (terminalFailureStatuses.has(String(communication?.status || "").toLowerCase())) {
      communication = await communicationService.retry(
        communication.communicationId,
        actor || "system-event",
        { markOriginalRecovered: true },
      );
    }
    if (terminalFailureStatuses.has(String(communication?.status || "").toLowerCase())) {
      const deliveryError = Object.assign(
        new Error(communication?.failureReason || "Internal email delivery failed"),
        {
          code: "INTERNAL_EMAIL_DELIVERY_FAILED",
          status: 503,
          communicationId: communication?.communicationId || "",
        },
      );
      throw deliveryError;
    }
    console.info({
      event: "internal_email_alert_dispatch_completed",
      ...logBase,
      communicationId: communication?.communicationId || "",
      status: communication?.status || "",
    });
    return communication;
  } catch (error) {
    console.error({
      event: "internal_email_alert_dispatch_failed",
      ...logBase,
      code: String(error?.code || "INTERNAL_EMAIL_DELIVERY_FAILED"),
      message: String(error?.message || error).slice(0, 1000),
    });
    throw error;
  }
}

async function sendProviderEmail(event, context, variables, actor) {
  if (!PROVIDER_EMAIL_EVENTS.has(event)) return { channel: "email", skipped: true, reason: "Email is not enabled for this event" };
  if (!truthy(process.env.PROVIDER_EVENT_EMAIL_ENABLED, true)) return { channel: "email", skipped: true, reason: "Provider event email is disabled" };
  const providerEmail = clean(context.provider?.email).toLowerCase();
  if (!providerEmail) return { channel: "email", skipped: true, reason: "Provider email is not available in CRM" };
  const template = await ensureProviderEmailTemplate(event);
  const reference = context.providerLeadUnlockId || context.enquiryId || context.providerId || "provider";
  const eventIdentity = context.integrationEventId || context.idempotencySuffix || context.eventAt;
  return communicationService.send(
    {
      channel: "email",
      templateId: template.templateId,
      recipientName: variables.provider_name,
      recipientContact: providerEmail,
      purpose: event === "provider_lead_unlocked" ? "provider_lead_access_confirmation" : "provider_status_update_confirmation",
      trigger: event,
      automatic: true,
      enquiryId: context.enquiryId || "",
      providerId: context.providerId || "",
      variables,
      idempotencyKey: `system-event:email:${token(event)}:${token(reference)}:${token(eventIdentity)}`,
      metadata: { event, providerLeadUnlockId: context.providerLeadUnlockId || "", source: context.source || "provider-portal" },
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
    return { channel, success: false, error: String(error.message || `${channel} delivery failed`).slice(0, 1000) };
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
    const results = [];
    if (INTERNAL_EMAIL_EVENTS.has(event)) results.push({ channel: "email", success: false, error: String(error.message).slice(0, 1000) });
    if (PROVIDER_EMAIL_EVENTS.has(event)) results.push({ channel: "email", success: false, error: String(error.message).slice(0, 1000) });
    return results;
  }

  const variables = variablesFor(context);
  const results = [];
  if (INTERNAL_EMAIL_EVENTS.has(event)) results.push(await settle("email", () => sendInternalEmail(event, context, variables, actor)));
  if (PROVIDER_EMAIL_EVENTS.has(event)) results.push(await settle("email", () => sendProviderEmail(event, context, variables, actor)));
  return results;
}

async function testInternalAlert(eventInput, actor = "crm-admin") {
  const event = clean(eventInput).toLowerCase().replace(/[\s-]+/g, "_");
  if (!INTERNAL_EMAIL_EVENTS.has(event)) throw Object.assign(new Error("Internal alert event is not supported"), { status: 400 });
  const now = new Date().toISOString();
  const sampleContext = await hydrateContext(event, {
    eventAt: now,
    source: "communication-center-test",
    lead: { enquiryId: "TEST-LEAD", name: "Test customer", requirementTitle: "Test service requirement", serviceTypes: ["Test service"], category: "Test category", city: "Mumbai", state: "Maharashtra", pincode: "400064" },
    agent: { agentId: "TEST-PARTNER", name: "Test Partner", referralId: "TEST01", businessName: "Test Partner Business", agentType: "individual", city: "Mumbai", state: "Maharashtra" },
    provider: { providerId: "TEST-PROVIDER", name: "Test Provider", businessName: "Test Provider Business", categorySlugs: ["test-category"], city: "Mumbai", state: "Maharashtra", servicePincode: "400064", status: "active" },
    providerJoinRequest: { providerJoinRequestId: "TEST-REQUEST", name: "Test Provider", businessName: "Test Provider Business", categoryNameSnapshot: "Test category", city: "Mumbai", state: "Maharashtra", servicePincode: "400064", status: "new" },
    createdBy: actor,
  });
  return sendInternalEmail(event, sampleContext, variablesFor(sampleContext), actor, { test: true });
}

module.exports = {
  INTERNAL_EMAIL_EVENTS,
  PROVIDER_EMAIL_EVENTS,
  SYSTEM_TEMPLATES,
  dispatch,
  hydrateContext,
  variablesFor,
  sendInternalEmail,
  testInternalAlert,
};
