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
              whatsappParameterMappings: [],
              whatsappActionType: "",
              whatsappActionButtonIndex: null,
              emailEnabled: false,
              emailTemplateId: "",
              createdBy: "system",
              updatedBy: "system",
            },
          },
          { upsert: true },
        );
      }
      const providerTemplates = await defaultTemplateService.ensureDefaultProviderTemplates();
      const internalAlerts = await defaultTemplateService.ensureInternalAlertTemplatesAndRules();
      return { providerTemplates, internalAlerts };
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
  const providerJoinRequest = context.providerJoinRequest || context.joinRequest || {};
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
  if (rule.recipientSource === "internal") {
    return {
      name: "Findoly internal alerts",
      mobile: "",
      email: String(process.env.INTERNAL_ALERT_EMAIL || "alert@findoly.com").trim().toLowerCase(),
    };
  }
  return { name: lead.name || "Customer", mobile: lead.mobile || "", email: lead.email || "" };
};

const joinLocation = function (...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(", ");
};

const urlSuffix = function (value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.pathname.split("/").filter(Boolean).pop() || "";
  } catch (_error) {
    return text.split("/").filter(Boolean).pop() || text;
  }
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
  const providerJoinRequest = context.providerJoinRequest || context.joinRequest || {};
  const note = context.note || context.reason || "";
  const status = context.status || lead.status || lead.journeyStatus || "";
  const supportEmail = process.env.SUPPORT_EMAIL || "support@findoly.com";
  const providerLocation = joinLocation(provider.city, provider.state);
  const agentLocation = joinLocation(agent.city, agent.state);
  const values = {
    customer_name: lead.name || "Customer",
    lead_id: lead.enquiryId || lead.id || "",
    requirement_title: lead.providerRequirementTitle || lead.requirementTitle || lead.serviceType || "",
    service_type: lead.serviceType || "",
    service_types: Array.isArray(lead.serviceTypes) ? lead.serviceTypes.map((item) => item?.name || item).filter(Boolean).join(", ") : (lead.serviceType || ""),
    priority: lead.priority || "normal",
    lead_status: status,
    category: lead.category || lead.categorySlug || "",
    lead_location: joinLocation(lead.city, lead.state, lead.pincode || lead.locationPincode),
    source_channel: lead.sourceChannel || context.source || "",
    source_website: lead.sourceWebsite || "",
    provider_name: provider.name || provider.businessName || context.providerName || "",
    provider_id: provider.providerId || "",
    provider_join_request_id: providerJoinRequest.providerJoinRequestId || context.providerJoinRequestId || "",
    business_name: providerJoinRequest.businessName || provider.businessName || agent.businessName || "",
    email: provider.email || agent.email || employee.email || lead.email || "",
    phone: provider.mobile || agent.mobile || employee.mobile || lead.mobile || "",
    status: provider.status || agent.status || employee.status || status,
    onboarding_stage: provider.onboardingStage || "",
    service_categories: Array.isArray(provider.categorySlugs) ? provider.categorySlugs.join(", ") : "",
    service_location: providerJoinRequest.providerJoinRequestId ? joinLocation(providerJoinRequest.city, providerJoinRequest.state, providerJoinRequest.servicePincode) : providerLocation,
    city: providerJoinRequest.city || provider.city || agent.city || "",
    state: providerJoinRequest.state || provider.state || agent.state || "",
    agent_name: agent.name || agent.businessName || lead.agentName || lead.agentBusinessName || "",
    agent_id: agent.agentId || lead.agentId || "",
    referral_id: agent.referralId || lead.referralId || "",
    agent_type: agent.agentType || lead.agentType || "",
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
    registration_date: registrationDate(context, providerJoinRequest.providerJoinRequestId ? providerJoinRequest : provider.providerId ? provider : agent.agentId ? agent : employee),
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
  if (context.trigger === "partner_lead_submitted" || context.event === "partner_lead_submitted") {
    values.agent_name = agent.name || agent.businessName || lead.agentName || lead.agentBusinessName || "Partner";
    values.agent_id = agent.agentId || lead.agentId || "";
    values.referral_id = agent.referralId || lead.referralId || "";
    values.customer_name = lead.name || "Customer";
    values.lead_id = lead.enquiryId || lead.id || "";
    values.service_type = lead.serviceType || "";
    values.service_types = Array.isArray(lead.serviceTypes)
      ? lead.serviceTypes.map((item) => item?.name || item).filter(Boolean).join(", ")
      : (lead.serviceType || "");
    values.category = lead.category || lead.categorySlug || "";
    values.lead_location = joinLocation(lead.city, lead.state, lead.pincode || lead.locationPincode);
    values.requirement_title = lead.requirementTitle || lead.serviceType || "New customer enquiry";
    values["1"] = values.agent_name;
    values["2"] = values.lead_id;
    values["3"] = values.customer_name;
    values["4"] = values.service_types || values.service_type;
    values["5"] = values.lead_location;
    values["6"] = values.requirement_title;
    values["7"] = values.referral_id;
  }
  if (context.trigger === "nearby_lead_available" || context.event === "nearby_lead_available") {
    const leadUrl = context.leadUrl || context.marketplaceUrl || process.env.PROVIDER_PORTAL_MARKETPLACE_URL || process.env.PROVIDER_PORTAL_LOGIN_URL || "";
    const serviceName = lead.category || lead.categorySlug || lead.serviceType || "Service";
    const leadLocation = joinLocation(lead.city, lead.state, lead.pincode || lead.locationPincode);
    values.provider_name = provider.name || provider.businessName || "Provider";
    values.service_name = serviceName;
    values.lead_location = leadLocation;
    values.requirement_title = lead.requirementTitle || lead.serviceType || "New customer requirement";
    values.lead_url = leadUrl;
    values.lead_url_suffix = urlSuffix(leadUrl);
    values["1"] = values.provider_name;
    values["2"] = serviceName;
    values["3"] = leadLocation;
    values["4"] = values.requirement_title;
    values["5"] = leadUrl;
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
  const providerJoinRequest = context.providerJoinRequest || context.joinRequest || {};
  const entityId = context.idempotencyEntityId
    || (lead.enquiryId || lead.id || provider.providerId || agent.agentId || employee.employeeId || providerJoinRequest.providerJoinRequestId || rule.event);
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
      accountType: provider.providerId ? "provider" : agent.agentId ? "agent" : employee.employeeId ? "employee" : providerJoinRequest.providerJoinRequestId ? "provider_join_request" : "",
      accountId: provider.providerId || agent.agentId || employee.employeeId || providerJoinRequest.providerJoinRequestId || "",
      providerJoinRequestId: providerJoinRequest.providerJoinRequestId || "",
      employeeId: employee.employeeId || "",
    },
  };
  const suffix = String(context.idempotencySuffix || lead.statusUpdatedAt || provider.createdAt || agent.createdAt || employee.createdAt || Date.now());
  const results = [];
  const whatsappOnly = rule.event === "nearby_lead_available";
  if (whatsappOnly) {
    console.info({
      event: "communication_rule_evaluated",
      eventName: rule.event,
      ruleId: rule.ruleId,
      enquiryId: lead.enquiryId || lead.id || "",
      providerId: provider.providerId || "",
      enabled: rule.enabled === true,
      whatsappEnabled: rule.whatsappEnabled === true,
      templateSelected: Boolean(rule.whatsappTemplateId),
      recipientMobileAvailable: Boolean(recipient.mobile),
      actionType: rule.whatsappActionType || "",
      actionButtonIndex: Number.isInteger(Number(rule.whatsappActionButtonIndex))
        ? Number(rule.whatsappActionButtonIndex)
        : null,
      parameterMappingCount: Array.isArray(rule.whatsappParameterMappings)
        ? rule.whatsappParameterMappings.length
        : 0,
    });
  }
  if (rule.whatsappEnabled && rule.whatsappTemplateId && recipient.mobile) {
    const nearbyLead = rule.event === "nearby_lead_available";
    results.push(
      await communicationService.send(
        {
          ...base,
          channel: "whatsapp",
          templateId: rule.whatsappTemplateId,
          recipientContact: recipient.mobile,
          idempotencyKey: `${rule.ruleId}:whatsapp:${entityId}:${suffix}`,
          ...(Array.isArray(rule.whatsappParameterMappings) && rule.whatsappParameterMappings.length ? {
            templateParamsOverride: rule.whatsappParameterMappings.map((key) => String(variables[key] ?? "")),
          } : {}),
          ...(nearbyLead ? {
            ...(rule.whatsappActionType === "unlock_lead" ? {
              whatsappAction: {
                type: "unlock_lead",
                buttonIndex: Number(rule.whatsappActionButtonIndex),
              },
            } : {}),
            metadata: {
              ...base.metadata,
              distanceKm: Number.isFinite(Number(context.distanceKm)) ? Number(context.distanceKm) : null,
              leadUrl: context.leadUrl || variables.lead_url || variables["5"] || "",
              whatsappActionType: rule.whatsappActionType || "",
              whatsappActionButtonIndex: Number.isInteger(Number(rule.whatsappActionButtonIndex))
                ? Number(rule.whatsappActionButtonIndex)
                : null,
              whatsappParameterMappings: rule.whatsappParameterMappings || [],
            },
          } : {}),
        },
        actor,
      ),
    );
  } else if (whatsappOnly) {
    const reason = !rule.whatsappEnabled
      ? "whatsapp_disabled"
      : !rule.whatsappTemplateId
        ? "template_missing"
        : "provider_mobile_missing";
    console.warn({
      event: "communication_rule_skipped",
      eventName: rule.event,
      ruleId: rule.ruleId,
      enquiryId: lead.enquiryId || lead.id || "",
      providerId: provider.providerId || "",
      reason,
    });
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
  return results;
};

const trigger = async function (event, context, actor) {
  await ensureDefaultRules();
  const source = context || {};
  const events = [event];
  if (event !== "lead_status_changed" && event.startsWith("lead_")) events.push("lead_status_changed");
  const rules = await CommunicationRule.find({ event: { $in: events }, enabled: true, recipientSource: { $ne: "internal" } }).lean();
  const output = [];
  console.info({
    event: "communication_rules_loaded",
    eventName: event,
    enquiryId: source.lead?.enquiryId || source.lead?.id || "",
    providerId: source.provider?.providerId || "",
    enabledRuleCount: rules.length,
  });
  if (event === "nearby_lead_available" && rules.length === 0) {
    console.warn({
      event: "communication_rule_skipped",
      eventName: event,
      enquiryId: source.lead?.enquiryId || source.lead?.id || "",
      providerId: source.provider?.providerId || "",
      reason: "no_enabled_rule",
    });
  }

  if (source.skipSystemDispatch !== true) {
    output.push(...(await systemEventService.dispatch(event, source, actor || "system")));
  }

  for (const rule of rules) {
    try {
      output.push(...(await sendRule(rule, source, actor || "system")));
    } catch (error) {
      console.error({
        event: "communication_rule_failed",
        eventName: event,
        ruleId: rule.ruleId,
        enquiryId: source.lead?.enquiryId || source.lead?.id || "",
        providerId: source.provider?.providerId || "",
        code: String(error.code || "COMMUNICATION_RULE_FAILED"),
        message: String(error.message || error).slice(0, 2000),
      });
    }
  }
  console.info({
    event: "communication_dispatch_completed",
    eventName: event,
    enquiryId: source.lead?.enquiryId || source.lead?.id || "",
    providerId: source.provider?.providerId || "",
    resultCount: output.length,
  });
  return output;
};

const triggerSafe = async function (event, context, actor) {
  try {
    return await trigger(event, context, actor);
  } catch (error) {
    console.error({
      event: "communication_event_failed",
      eventName: event,
      enquiryId: context?.lead?.enquiryId || context?.lead?.id || "",
      providerId: context?.provider?.providerId || "",
      code: String(error.code || "COMMUNICATION_EVENT_FAILED"),
      message: String(error.message || error).slice(0, 2000),
    });
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
