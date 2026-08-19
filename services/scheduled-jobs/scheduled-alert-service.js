"use strict";

const Communication = require("../../models/Communication");
const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const communicationService = require("../communication/communication-service");

const TERMINAL_FAILURE_STATUSES = Object.freeze(["failed", "bounced", "complained", "rejected"]);

const DEFINITIONS = Object.freeze([
  {
    event: "follow_up_due",
    name: "findoly_internal_follow_up_due",
    displayName: "Internal alert — Follow-up due",
    ruleName: "Follow-up due",
    description: "Email alert to the Findoly operations inbox when a CRM follow-up becomes due.",
    subject: "[Findoly Follow-up] Due — {{follow_up_title}}",
    body: [
      "A CRM follow-up is due.",
      "",
      "Follow-up: {{follow_up_title}}",
      "Follow-up ID: {{follow_up_id}}",
      "Requirement ID: {{lead_id}}",
      "Customer: {{customer_name}}",
      "Due: {{due_at}}",
      "Channel: {{channel}}",
      "Notes: {{notes}}",
      "CRM: {{crm_url}}",
    ].join("\n"),
    sample: {
      follow_up_title: "Call customer regarding service requirement",
      follow_up_id: "FOLLOWUP-001",
      lead_id: "LEAD-001",
      customer_name: "Customer",
      due_at: "20 Aug 2026, 10:30 AM",
      channel: "call",
      notes: "Customer requested a callback.",
      crm_url: "https://admin.findoly.com/follow-ups/FOLLOWUP-001/edit",
    },
  },
  {
    event: "daily_lead_report",
    name: "findoly_daily_lead_report",
    displayName: "Daily report — Leads",
    ruleName: "Daily lead summary",
    description: "Daily overview of lead creation and current lead statuses.",
    subject: "Findoly Daily Lead Summary — {{report_date}}",
    body: [
      "Findoly Daily Lead Summary",
      "Report date: {{report_date}}",
      "",
      "Leads created: {{leads_created}}",
      "Approved: {{approved}}",
      "Rejected: {{rejected}}",
      "Published: {{published}}",
      "Pending verification: {{pending_verification}}",
    ].join("\n"),
    sample: { report_date: "19 Aug 2026", leads_created: "28", approved: "19", rejected: "3", published: "17", pending_verification: "6" },
  },
  {
    event: "daily_lead_unlock_report",
    name: "findoly_daily_lead_unlock_report",
    displayName: "Daily report — Lead unlocks",
    ruleName: "Daily lead unlock summary",
    description: "Daily overview of provider lead unlock activity.",
    subject: "Findoly Daily Lead Unlock Summary — {{report_date}}",
    body: [
      "Findoly Daily Lead Unlock Summary",
      "Report date: {{report_date}}",
      "",
      "Total lead unlocks: {{total_unlocks}}",
      "Unique leads unlocked: {{unique_leads_unlocked}}",
      "Credit unlocks: {{credit_unlocks}}",
      "Direct payment unlocks: {{direct_payment_unlocks}}",
      "Admin unlocks: {{admin_unlocks}}",
      "Credits consumed: {{credits_consumed}}",
    ].join("\n"),
    sample: { report_date: "19 Aug 2026", total_unlocks: "14", unique_leads_unlocked: "10", credit_unlocks: "9", direct_payment_unlocks: "4", admin_unlocks: "1", credits_consumed: "72" },
  },
  {
    event: "daily_provider_report",
    name: "findoly_daily_provider_report",
    displayName: "Daily report — Providers",
    ruleName: "Daily provider summary",
    description: "Daily overview of provider account growth.",
    subject: "Findoly Daily Provider Summary — {{report_date}}",
    body: [
      "Findoly Daily Provider Summary",
      "Report date: {{report_date}}",
      "",
      "Providers added: {{providers_added}}",
      "Active providers added: {{active_added}}",
      "Inactive providers added: {{inactive_added}}",
      "Total active providers: {{total_active_providers}}",
    ].join("\n"),
    sample: { report_date: "19 Aug 2026", providers_added: "6", active_added: "5", inactive_added: "1", total_active_providers: "1284" },
  },
  {
    event: "daily_follow_up_report",
    name: "findoly_daily_follow_up_report",
    displayName: "Daily report — Follow-ups",
    ruleName: "Daily follow-up summary",
    description: "Daily overview of CRM follow-up workload and overdue items.",
    subject: "Findoly Daily Follow-up Summary — {{report_date}}",
    body: [
      "Findoly Daily Follow-up Summary",
      "Report date: {{report_date}}",
      "",
      "Follow-ups created: {{follow_ups_created}}",
      "Completed: {{completed}}",
      "Open or pending now: {{open_pending}}",
      "Due on report date: {{due_on_report_date}}",
      "Overdue now: {{overdue}}",
    ].join("\n"),
    sample: { report_date: "19 Aug 2026", follow_ups_created: "12", completed: "8", open_pending: "7", due_on_report_date: "5", overdue: "3" },
  },
  {
    event: "daily_crm_health_report",
    name: "findoly_daily_crm_health_report",
    displayName: "Daily report — CRM health",
    ruleName: "Daily CRM health summary",
    description: "Daily overview of operational failures and records needing attention.",
    subject: "Findoly Daily CRM Health Summary — {{report_date}}",
    body: [
      "Findoly Daily CRM Health Summary",
      "Report date: {{report_date}}",
      "",
      "Failed email deliveries: {{failed_email_deliveries}}",
      "Failed WhatsApp deliveries: {{failed_whatsapp_deliveries}}",
      "Current failed CRM syncs: {{failed_crm_syncs}}",
      "Active providers missing service coordinates: {{providers_missing_location}}",
      "Overdue follow-ups: {{overdue_follow_ups}}",
      "Overall status: {{overall_status}}",
    ].join("\n"),
    sample: { report_date: "19 Aug 2026", failed_email_deliveries: "2", failed_whatsapp_deliveries: "4", failed_crm_syncs: "1", providers_missing_location: "3", overdue_follow_ups: "3", overall_status: "Attention required" },
  },
  {
    event: "testing_provider_alert",
    name: "findoly_testing_provider_alert",
    displayName: "Hourly alert — Testing providers",
    ruleName: "Testing provider alert",
    description: "Hourly alert when non-excluded providers remain assigned to the configured Testing category.",
    subject: "Findoly Testing Providers Alert — {{checked_at}}",
    body: [
      "Findoly Testing Providers Alert",
      "",
      "Testing category: {{testing_category}}",
      "Providers currently in Testing category: {{testing_provider_count}}",
      "Checked at: {{checked_at}}",
    ].join("\n"),
    sample: { testing_category: "testing", testing_provider_count: "3", checked_at: "20 Aug 2026, 10:00 AM" },
  },
]);

function definitionFor(event) {
  const normalized = String(event || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DEFINITIONS.find((definition) => definition.event === normalized) || null;
}

function variableNames(definition) {
  return [...new Set(Array.from(`${definition.subject}\n${definition.body}`.matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g), (match) => match[1]))];
}

async function ensureTemplate(definition) {
  const query = { channel: "email", name: definition.name, language: "en_US" };
  let template = await CommunicationTemplate.findOne(query).lean();
  if (template) return template;
  try {
    const created = await CommunicationTemplate.create({
      name: definition.name,
      displayName: definition.displayName,
      channel: "email",
      category: "transactional",
      language: "en_US",
      subject: definition.subject,
      body: definition.body,
      bodyHtml: "",
      footer: "",
      sampleVariables: variableNames(definition),
      status: "active",
      isActive: true,
      createdBy: "system",
      updatedBy: "system",
    });
    return created.toObject ? created.toObject() : created;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    template = await CommunicationTemplate.findOne(query).lean();
    if (!template) throw error;
    return template;
  }
}

async function ensureScheduledAlertTemplatesAndRules() {
  const output = [];
  for (const definition of DEFINITIONS) {
    const template = await ensureTemplate(definition);
    await CommunicationRule.updateOne(
      { event: definition.event, recipientSource: "internal" },
      {
        $setOnInsert: {
          name: definition.ruleName,
          event: definition.event,
          recipientSource: "internal",
          description: definition.description,
          enabled: true,
          whatsappEnabled: false,
          whatsappTemplateId: "",
          whatsappParameterMappings: [],
          whatsappActionType: "",
          whatsappActionButtonIndex: null,
          emailEnabled: true,
          emailTemplateId: template.templateId,
          createdBy: "system",
          updatedBy: "system",
        },
      },
      { upsert: true },
    );
    let rule = await CommunicationRule.findOne({ event: definition.event, recipientSource: "internal" }).lean();
    if (rule && !String(rule.emailTemplateId || "").trim()) {
      await CommunicationRule.updateOne({ ruleId: rule.ruleId }, { $set: { emailTemplateId: template.templateId, updatedBy: "system" } });
      rule = { ...rule, emailTemplateId: template.templateId };
    }
    output.push({ definition, template, rule });
  }
  return output;
}

async function ruleFor(event) {
  const definition = definitionFor(event);
  if (!definition) throw Object.assign(new Error("Scheduled internal email event is not supported"), { status: 400 });
  await ensureScheduledAlertTemplatesAndRules();
  const rule = await CommunicationRule.findOne({ event: definition.event, recipientSource: "internal" }).lean();
  return { definition, rule };
}

async function isEventEnabled(event) {
  const { rule } = await ruleFor(event);
  return Boolean(rule?.enabled === true && rule?.emailEnabled === true && rule?.emailTemplateId);
}

async function updateScheduledAlert(event, input = {}, actor = "crm") {
  const { rule } = await ruleFor(event);
  if (!rule) throw Object.assign(new Error("Scheduled internal email rule is missing"), { status: 404 });
  const enabled = input.enabled === true;
  const emailTemplateId = String(input.emailTemplateId ?? rule.emailTemplateId ?? "").trim();
  if (enabled && !emailTemplateId) {
    throw Object.assign(new Error("Select an active email template before enabling this alert"), { status: 400 });
  }
  if (emailTemplateId) {
    const template = await CommunicationTemplate.findOne({
      templateId: emailTemplateId,
      channel: "email",
      status: "active",
      isActive: true,
    }).lean();
    if (!template) throw Object.assign(new Error("Selected email template is not active"), { status: 400 });
  }
  await CommunicationRule.updateOne(
    { ruleId: rule.ruleId },
    {
      $set: {
        enabled,
        emailEnabled: true,
        emailTemplateId,
        whatsappEnabled: false,
        whatsappTemplateId: "",
        whatsappParameterMappings: [],
        updatedBy: actor,
        updatedAt: new Date(),
      },
    },
  );
  return CommunicationRule.findOne({ ruleId: rule.ruleId }).lean();
}

async function sendInternalEvent(event, variables = {}, options = {}) {
  const { definition, rule } = await ruleFor(event);
  if (!rule) return { skipped: true, reason: "Internal email rule is missing", event: definition.event };
  if (!options.test && (rule.enabled !== true || rule.emailEnabled !== true)) return { skipped: true, reason: "Internal email alert is disabled", event: definition.event };
  if (!rule.emailTemplateId) return { skipped: true, reason: "Internal email template is not selected", event: definition.event };

  const recipient = String(process.env.INTERNAL_ALERT_EMAIL || "alert@findoly.com").trim().toLowerCase();
  const scheduledJobKey = String(options.idempotencyKey || "").trim();
  let deliveryIdempotencyKey = scheduledJobKey || `scheduled-email-test:${definition.event}:${Date.now()}`;
  if (scheduledJobKey) {
    const completed = await Communication.findOne({
      "metadata.scheduledJobKey": scheduledJobKey,
      status: { $nin: TERMINAL_FAILURE_STATUSES },
    }).sort({ createdAt: -1, _id: -1 }).lean();
    if (completed) return completed;
    const attempts = await Communication.countDocuments({ "metadata.scheduledJobKey": scheduledJobKey });
    deliveryIdempotencyKey = `${scheduledJobKey}:attempt:${attempts + 1}`;
  }

  return communicationService.send(
    {
      channel: "email",
      templateId: rule.emailTemplateId,
      ruleId: rule.ruleId,
      recipientName: "Findoly internal alerts",
      recipientContact: recipient,
      purpose: options.test ? "scheduled_internal_email_test" : "scheduled_internal_email",
      trigger: definition.event,
      automatic: options.test !== true,
      variables,
      idempotencyKey: deliveryIdempotencyKey,
      metadata: {
        event: definition.event,
        source: options.source || "scheduled-job",
        internalAlert: true,
        scheduledJob: options.test !== true,
        scheduledJobKey,
        test: options.test === true,
        ...(options.metadata || {}),
      },
    },
    options.actor || "scheduled-job",
  );
}

async function testScheduledAlert(event, actor = "crm") {
  const definition = definitionFor(event);
  if (!definition) throw Object.assign(new Error("Scheduled internal email event is not supported"), { status: 400 });
  return sendInternalEvent(definition.event, definition.sample, {
    test: true,
    actor,
    source: "crm-test",
    idempotencyKey: `scheduled-email-test:${definition.event}:${Date.now()}`,
  });
}

module.exports = {
  DEFINITIONS,
  definitionFor,
  ensureScheduledAlertTemplatesAndRules,
  isEventEnabled,
  updateScheduledAlert,
  sendInternalEvent,
  testScheduledAlert,
};
