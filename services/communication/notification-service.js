const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const communicationService = require("./communication-service");
const { renderText } = require("./template-renderer");

const DEFAULT_RULES = Object.freeze([
  ["Lead received", "lead_created", "Customer notification after a new lead is recorded"],
  ["Lead status changed", "lead_status_changed", "General customer notification for a lead journey change"],
  ["Lead approved", "lead_approved", "Customer notification when a lead is approved"],
  ["Lead rejected", "lead_rejected", "Customer notification when a lead is rejected"],
  ["Lead on hold", "lead_on_hold", "Customer notification when a lead is placed on hold"],
  ["Lead distributed", "lead_distributed", "Customer notification when a lead is distributed"],
  ["Provider confirmed", "provider_confirmed", "Customer notification when a provider confirms the lead"],
  ["Provider rejected", "provider_rejected", "Internal or customer notification when a provider rejects the lead"],
  ["Provider invalid", "provider_invalid", "Internal notification when a provider marks the lead invalid"],
  ["Sale conversion updated", "sale_conversion_updated", "Notification after sale-conversion status changes"],
]);

const ensureDefaultRules = async function () {
  for (const row of DEFAULT_RULES) {
    await CommunicationRule.updateOne(
      { event: row[1], recipientSource: "customer" },
      {
        $setOnInsert: {
          name: row[0],
          event: row[1],
          recipientSource: "customer",
          description: row[2],
          enabled: false,
          whatsappEnabled: false,
          whatsappTemplateId: "",
          emailEnabled: false,
          emailTemplateId: "",
          slackEnabled: false,
          slackChannelId: "",
          slackChannelName: "",
          slackMessage: "",
          createdBy: "system",
          updatedBy: "system",
        },
      },
      { upsert: true },
    );
  }
};

const resolveRecipient = function (rule, context) {
  const lead = context.lead || {};
  const provider = context.provider || {};
  const agent = context.agent || {};
  if (rule.recipientSource === "provider") {
    return { name: provider.name || provider.businessName || "Provider", mobile: provider.mobile || "", email: provider.email || "", providerId: provider.providerId || "" };
  }
  if (rule.recipientSource === "agent") {
    return { name: agent.name || lead.agentName || "Agent", mobile: agent.mobile || lead.agentMobile || "", email: agent.email || "", agentId: agent.agentId || lead.agentId || "" };
  }
  return { name: lead.name || "Customer", mobile: lead.mobile || "", email: lead.email || "" };
};

const variablesFor = function (context) {
  const lead = context.lead || {};
  const provider = context.provider || {};
  const note = context.note || context.reason || "";
  const status = context.status || lead.status || lead.journeyStatus || "";
  const values = {
    customer_name: lead.name || "Customer",
    lead_id: lead.enquiryId || lead.id || "",
    requirement_title: lead.requirementTitle || lead.serviceType || "",
    lead_status: status,
    category: lead.category || lead.categorySlug || "",
    provider_name: provider.name || provider.businessName || context.providerName || "",
    note,
    "1": lead.name || "Customer",
    "2": lead.enquiryId || lead.id || "",
    "3": lead.requirementTitle || lead.serviceType || "",
    "4": status,
    "5": lead.category || lead.categorySlug || "",
    "6": provider.name || provider.businessName || context.providerName || "",
    "7": note,
  };
  return values;
};

const sendRule = async function (rule, context, actor) {
  const recipient = resolveRecipient(rule, context);
  const variables = variablesFor(context);
  const lead = context.lead || {};
  const base = {
    enquiryId: lead.enquiryId || lead.id || "",
    providerId: recipient.providerId || "",
    agentId: recipient.agentId || lead.agentId || "",
    recipientName: recipient.name,
    ruleId: rule.ruleId,
    purpose: rule.event,
    trigger: context.trigger || rule.event,
    automatic: true,
    variables,
    metadata: {
      event: rule.event,
      status: context.status || lead.status || "",
      note: context.note || context.reason || "",
    },
  };
  const suffix = String(context.idempotencySuffix || lead.statusUpdatedAt || Date.now());
  const results = [];
  if (rule.whatsappEnabled && rule.whatsappTemplateId && recipient.mobile) {
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "whatsapp",
          templateId: rule.whatsappTemplateId,
          recipientContact: recipient.mobile,
          idempotencyKey: `${rule.ruleId}:whatsapp:${base.enquiryId}:${suffix}`,
        },
        actor,
      ),
    );
  }
  if (rule.emailEnabled && rule.emailTemplateId && recipient.email) {
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "email",
          templateId: rule.emailTemplateId,
          recipientContact: recipient.email,
          idempotencyKey: `${rule.ruleId}:email:${base.enquiryId}:${suffix}`,
        },
        actor,
      ),
    );
  }
  const slackMessage = String(rule.slackMessage || "").trim();
  if (rule.slackEnabled && slackMessage) {
    const channelId = String(
      rule.slackChannelId || process.env.SLACK_DEFAULT_CHANNEL_ID || "",
    ).trim();
    const channelName = String(
      rule.slackChannelName || process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team",
    ).replace(/^#/, "");
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "slack",
          channelId,
          channelName,
          recipientName: "Internal team",
          message: renderText(slackMessage, variables),
          subject: `CRM notification: ${rule.name}`,
          idempotencyKey: `${rule.ruleId}:slack:${base.enquiryId}:${suffix}`,
          metadata: {
            ...base.metadata,
            slackChannelId: channelId,
            slackChannelName: channelName,
          },
        },
        actor,
      ),
    );
  }
  return results;
};

const trigger = async function (event, context, actor) {
  const events = [event];
  if (event !== "lead_status_changed" && event.startsWith("lead_")) events.push("lead_status_changed");
  const rules = await CommunicationRule.find({ event: { $in: events }, enabled: true }).lean();
  const output = [];
  for (const rule of rules) {
    try {
      output.push(...(await sendRule(rule, context || {}, actor || "system")));
    } catch (error) {
      console.error(`Communication rule ${rule.ruleId} failed:`, error.message);
    }
  }
  return output;
};

const testRule = async function (ruleId, context, actor) {
  const rule = await CommunicationRule.findOne({ ruleId }).lean();
  if (!rule) throw Object.assign(new Error("Communication rule not found"), { status: 404 });
  if (rule.whatsappTemplateId) await CommunicationTemplate.exists({ templateId: rule.whatsappTemplateId });
  return sendRule(rule, context || {}, actor || "admin");
};

module.exports = { ensureDefaultRules, trigger, testRule, variablesFor, resolveRecipient };
