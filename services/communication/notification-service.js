const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const communicationService = require("./communication-service");
const systemEventService = require("./system-event-service");
const { renderText } = require("./template-renderer");
const defaultTemplateService = require("./default-template-service");

const DEFAULT_RULES = Object.freeze([
  ["Lead received", "lead_created", "Customer notification after a new lead is recorded", "customer"],
  ["Lead status changed", "lead_status_changed", "General customer notification for a lead journey change", "customer"],
  ["Lead approved", "lead_approved", "Customer notification when a lead is approved", "customer"],
  ["Lead rejected", "lead_rejected", "Customer notification when a lead is rejected", "customer"],
  ["Lead on hold", "lead_on_hold", "Customer notification when a lead is placed on hold", "customer"],
  ["Provider confirmed", "provider_confirmed", "Customer or internal notification when a provider confirms the lead", "customer"],
  ["Provider not confirmed", "provider_not_confirmed", "Customer or internal notification when a provider marks the sale not confirmed", "customer"],
  ["Provider contacted", "provider_contacted", "Notification when a provider records customer contact", "customer"],
  ["Provider valid", "provider_valid", "Notification when a provider records the lead as valid", "customer"],
  ["Provider follow up", "provider_follow_up", "Notification when a provider schedules further follow up", "customer"],
  ["Provider on hold", "provider_on_hold", "Notification when a provider places the lead on hold", "customer"],
  ["Provider rejected", "provider_rejected", "Internal or customer notification when a provider rejects the lead", "customer"],
  ["Provider invalid", "provider_invalid", "Internal notification when a provider marks the lead invalid", "customer"],
  ["Provider not interested", "provider_not_interested", "Internal notification when a provider marks the lead not interested", "customer"],
  ["Provider other update", "provider_other", "Internal notification for another provider activity update", "customer"],
  ["Sale conversion updated", "sale_conversion_updated", "Notification after sale-conversion status changes", "customer"],
  ["Nearby lead available", "nearby_lead_available", "WhatsApp alert when a matching lead is immediately visible within 20 km", "provider"],
  ["Provider account created", "provider_created", "Welcome notification after a provider is created successfully", "provider"],
  ["Agent registration", "agent_created", "Welcome email after an agent is created successfully", "agent"],
  ["Employee registration", "employee_created", "Welcome email after an employee is created successfully", "employee"],
]);

let defaultSetupPromise = null;

const ensureDefaultRules = async function () {
  if (!defaultSetupPromise) {
    defaultSetupPromise = (async function () {
      for (const row of DEFAULT_RULES) {
        const recipientSource = row[3] || "customer";
        await CommunicationRule.updateOne(
          { event: row[1], recipientSource },
          {
            $setOnInsert: {
              name: row[0],
              event: row[1],
              recipientSource,
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
      return defaultTemplateService.ensureDefaultProviderTemplates();
    })();
  }
  try {
    return await defaultSetupPromise;
  } catch (error) {
    defaultSetupPromise = null;
    throw error;
  }
};

const resolveRecipient = function (rule, context) {
  const lead = context.lead || {};
  const provider = context.provider || {};
  const agent = context.agent || {};
  const employee = context.employee || {};
  if (rule.recipientSource === "provider") {
    return {
      name: provider.name || provider.businessName || "Provider",
      mobile: provider.normalizedWhatsappNumber || provider.whatsappNumber || provider.normalizedMobile || provider.mobile || "",
      email: provider.email || "",
      providerId: provider.providerId || "",
    };
  }
  if (rule.recipientSource === "agent") {
    return {
      name: agent.name || agent.businessName || lead.agentName || "Agent",
      mobile: agent.mobile || lead.agentMobile || "",
      email: agent.email || "",
      agentId: agent.agentId || lead.agentId || "",
    };
  }
  if (rule.recipientSource === "employee") {
    return {
      name: employee.name || "Employee",
      mobile: employee.mobile || "",
      email: employee.email || "",
      employeeId: employee.employeeId || "",
    };
  }
  return { name: lead.name || "Customer", mobile: lead.mobile || "", email: lead.email || "" };
};

const joinLocation = function (...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(", ");
};

const registrationDate = function (context, entity) {
  const value = context.registrationDate || entity.createdAt || context.eventAt || new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toISOString();
};

const variablesFor = function (context) {
  const lead = context.lead || {};
  const provider = context.provider || {};
  const agent = context.agent || {};
  const employee = context.employee || {};
  const note = context.note || context.reason || "";
  const status = context.status || lead.status || lead.journeyStatus || "";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@findoly.com";
  const providerLocation = joinLocation(provider.city, provider.state);
  const agentLocation = joinLocation(agent.city, agent.state);
  const values = {
    customer_name: lead.name || "Customer",
    lead_id: lead.enquiryId || lead.id || "",
    requirement_title: lead.requirementTitle || lead.serviceType || "",
    service_type: lead.serviceType || "",
    service_types: Array.isArray(lead.serviceTypes) ? lead.serviceTypes.map((item) => item?.name || item).filter(Boolean).join(", ") : (lead.serviceType || ""),
    priority: lead.priority || "normal",
    lead_status: status,
    category: lead.category || lead.categorySlug || "",
    provider_name: provider.name || provider.businessName || context.providerName || "",
    provider_id: provider.providerId || "",
    business_name: provider.businessName || agent.businessName || "",
    email: provider.email || agent.email || employee.email || lead.email || "",
    phone: provider.mobile || agent.mobile || employee.mobile || lead.mobile || "",
    status: provider.status || agent.status || employee.status || status,
    onboarding_stage: provider.onboardingStage || "",
    service_categories: Array.isArray(provider.categorySlugs) ? provider.categorySlugs.join(", ") : "",
    service_location: providerLocation,
    city: provider.city || agent.city || "",
    state: provider.state || agent.state || "",
    agent_name: agent.name || agent.businessName || "",
    agent_id: agent.agentId || "",
    referral_id: agent.referralId || "",
    agent_type: agent.agentType || "",
    category_name: (agent.categories || []).map((category) => category.categoryName).filter(Boolean).join(", ") || agent.categoryName || "",
    assigned_location: agentLocation,
    employee_name: employee.name || "",
    employee_id: employee.employeeId || "",
    employee_code: employee.employeeCode || "",
    designation: employee.designation || "",
    department: employee.department || "",
    role_name: employee.roleName || "",
    login_url:
      context.loginUrl ||
      (provider.providerId ? process.env.PROVIDER_PORTAL_LOGIN_URL : "") ||
      (agent.agentId ? process.env.AGENT_PORTAL_LOGIN_URL : "") ||
      (employee.employeeId ? process.env.EMPLOYEE_CRM_LOGIN_URL || process.env.CRM_LOGIN_URL : "") ||
      "",
    support_email: supportEmail,
    registration_date: registrationDate(context, provider.providerId ? provider : agent.agentId ? agent : employee),
    note,
    "1": lead.name || provider.name || agent.name || employee.name || "Customer",
    "2": lead.enquiryId || provider.providerId || agent.agentId || employee.employeeId || "",
    "3": lead.requirementTitle || provider.businessName || agent.businessName || employee.designation || "",
    "4": status || provider.status || agent.status || employee.status || "",
    "5": lead.category || lead.categorySlug || provider.categorySlugs?.join(", ") || agent.categoryName || employee.department || "",
    "6": provider.name || provider.businessName || agent.name || employee.name || context.providerName || "",
    "7": note,
  };
  if (provider.providerId) {
    values["1"] = provider.name || provider.businessName || "Provider";
    values["2"] = provider.providerId || "";
    values["3"] = provider.businessName || provider.name || "";
    values["4"] = Array.isArray(provider.categorySlugs) ? provider.categorySlugs.join(", ") : "";
    values["5"] = values.login_url || "";
    values["6"] = values.support_email || "support@findoly.com";
  }
  if (context.trigger === "nearby_lead_available" || context.event === "nearby_lead_available") {
    values["1"] = provider.name || provider.businessName || "Provider";
    values["2"] = lead.category || lead.categorySlug || lead.serviceType || "Service";
    values["3"] = joinLocation(lead.city, lead.state, lead.pincode || lead.locationPincode);
    values["4"] = lead.requirementTitle || lead.serviceType || "New customer requirement";
    values["5"] = context.marketplaceUrl || process.env.PROVIDER_PORTAL_MARKETPLACE_URL || process.env.PROVIDER_PORTAL_LOGIN_URL || "";
  }
  return values;
};

const sendRule = async function (rule, context, actor) {
  const recipient = resolveRecipient(rule, context);
  const variables = variablesFor(context);
  const lead = context.lead || {};
  const provider = context.provider || {};
  const agent = context.agent || {};
  const employee = context.employee || {};
  const entityId = context.idempotencyEntityId
    || (lead.enquiryId || lead.id || provider.providerId || agent.agentId || employee.employeeId || rule.event);
  const base = {
    enquiryId: lead.enquiryId || lead.id || "",
    providerId: recipient.providerId || provider.providerId || "",
    agentId: recipient.agentId || agent.agentId || lead.agentId || "",
    recipientName: recipient.name,
    ruleId: rule.ruleId,
    purpose: rule.event,
    trigger: context.trigger || rule.event,
    automatic: true,
    variables,
    metadata: {
      event: rule.event,
      status: context.status || lead.status || provider.status || agent.status || employee.status || "",
      note: context.note || context.reason || "",
      accountType: provider.providerId ? "provider" : agent.agentId ? "agent" : employee.employeeId ? "employee" : "",
      accountId: provider.providerId || agent.agentId || employee.employeeId || "",
      employeeId: employee.employeeId || "",
    },
  };
  const suffix = String(context.idempotencySuffix || lead.statusUpdatedAt || provider.createdAt || agent.createdAt || employee.createdAt || Date.now());
  const results = [];
  const whatsappOnly = rule.event === "nearby_lead_available";
  if (rule.whatsappEnabled && rule.whatsappTemplateId && recipient.mobile) {
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "whatsapp",
          templateId: rule.whatsappTemplateId,
          recipientContact: recipient.mobile,
          idempotencyKey: `${rule.ruleId}:whatsapp:${entityId}:${suffix}`,
        },
        actor,
      ),
    );
  }
  if (!whatsappOnly && rule.emailEnabled && rule.emailTemplateId && recipient.email) {
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "email",
          templateId: rule.emailTemplateId,
          recipientContact: recipient.email,
          idempotencyKey: `${rule.ruleId}:email:${entityId}:${suffix}`,
        },
        actor,
      ),
    );
  }
  const slackMessage = String(rule.slackMessage || "").trim();
  if (!whatsappOnly && rule.slackEnabled && slackMessage) {
    const channelId = String(rule.slackChannelId || process.env.SLACK_DEFAULT_CHANNEL_ID || "").trim();
    const channelName = String(rule.slackChannelName || process.env.SLACK_DEFAULT_CHANNEL_NAME || "internal-team").replace(/^#/, "");
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
          idempotencyKey: `${rule.ruleId}:slack:${entityId}:${suffix}`,
          metadata: { ...base.metadata, slackChannelId: channelId, slackChannelName: channelName },
        },
        actor,
      ),
    );
  }
  return results;
};

const trigger = async function (event, context, actor) {
  await ensureDefaultRules();
  const source = context || {};
  const events = [event];
  if (event !== "lead_status_changed" && event.startsWith("lead_")) events.push("lead_status_changed");
  const rules = await CommunicationRule.find({ event: { $in: events }, enabled: true }).lean();
  const output = [];

  if (source.skipSystemDispatch !== true) {
    output.push(...(await systemEventService.dispatch(event, source, actor || "system")));
  }

  for (const rule of rules) {
    try {
      output.push(...(await sendRule(rule, source, actor || "system")));
    } catch (error) {
      console.error(`Communication rule ${rule.ruleId} failed:`, error.message);
    }
  }
  return output;
};

const triggerSafe = async function (event, context, actor) {
  try {
    return await trigger(event, context, actor);
  } catch (error) {
    console.error(`Communication event ${event} failed after the business action completed:`, error.message);
    return [];
  }
};

const testRule = async function (ruleId, context, actor) {
  const rule = await CommunicationRule.findOne({ ruleId }).lean();
  if (!rule) throw Object.assign(new Error("Communication rule not found"), { status: 404 });
  if (rule.whatsappTemplateId) await CommunicationTemplate.exists({ templateId: rule.whatsappTemplateId });
  return sendRule(rule, context || {}, actor || "admin");
};

module.exports = { ensureDefaultRules, trigger, triggerSafe, testRule, variablesFor, resolveRecipient, DEFAULT_RULES };
