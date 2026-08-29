"use strict";

const CommunicationTemplate = require("../../models/CommunicationTemplate");
const CommunicationRule = require("../../models/CommunicationRule");
const { parameterDefinitions } = require("./gupshup-template-service");

const EMAIL_TEMPLATE_NAME = "findoly_provider_account_created_email";
const WHATSAPP_TEMPLATE_NAME = "findoly_provider_account_created";
const NEARBY_LEAD_WHATSAPP_TEMPLATE_NAME = "findoly_nearby_lead_available";

const emailTemplate = Object.freeze({
  name: EMAIL_TEMPLATE_NAME,
  displayName: "Provider account created",
  channel: "email",
  category: "transactional",
  language: "en_US",
  subject: "Welcome to Findoly — Your provider account is ready",
  body: [
    "Hello {{provider_name}},",
    "",
    "Your Findoly provider account has been created successfully.",
    "",
    "Provider ID: {{provider_id}}",
    "Business name: {{business_name}}",
    "Service categories: {{service_categories}}",
    "Service location: {{service_location}}",
    "Account status: {{status}}",
    "",
    "You can sign in using your registered mobile number:",
    "{{login_url}}",
    "",
    "For assistance, contact {{support_email}}.",
    "",
    "Welcome to Findoly.",
    "",
    "Team Findoly",
  ].join("\n"),
  bodyHtml: [
    "<p>Hello {{provider_name}},</p>",
    "<p>Your Findoly provider account has been created successfully.</p>",
    "<p><strong>Provider ID:</strong> {{provider_id}}<br>",
    "<strong>Business name:</strong> {{business_name}}<br>",
    "<strong>Service categories:</strong> {{service_categories}}<br>",
    "<strong>Service location:</strong> {{service_location}}<br>",
    "<strong>Account status:</strong> {{status}}</p>",
    "<p>You can sign in using your registered mobile number:<br><a href=\"{{login_url}}\">{{login_url}}</a></p>",
    "<p>For assistance, contact {{support_email}}.</p>",
    "<p>Welcome to Findoly.<br>Team Findoly</p>",
  ].join(""),
  footer: "",
  sampleVariables: [
    "provider_name",
    "provider_id",
    "business_name",
    "service_categories",
    "service_location",
    "status",
    "login_url",
    "support_email",
  ],
  status: "active",
  isActive: true,
});

const whatsappTemplate = Object.freeze({
  name: WHATSAPP_TEMPLATE_NAME,
  displayName: "Provider account created",
  channel: "whatsapp",
  category: "utility",
  language: "en_US",
  subject: "",
  headerType: "none",
  headerText: "",
  body: [
    "Hello {{1}},",
    "",
    "Your Findoly provider account has been created successfully.",
    "",
    "Provider ID: {{2}}",
    "Business: {{3}}",
    "Categories: {{4}}",
    "",
    "Log in to the Provider Portal using your registered mobile number:",
    "{{5}}",
    "",
    "For support, contact {{6}}.",
    "",
    "Thank you,",
    "Team Findoly",
  ].join("\n"),
  bodyHtml: "",
  footer: "",
  sampleVariables: [
    "Provider name",
    "PROVIDER-001",
    "Business name",
    "Painting",
    "https://provider.findoly.com/login",
    "support@findoly.com",
  ],
  status: "draft",
  isActive: true,
});

const nearbyLeadWhatsappTemplate = Object.freeze({
  name: NEARBY_LEAD_WHATSAPP_TEMPLATE_NAME,
  displayName: "Nearby lead available",
  channel: "whatsapp",
  category: "utility",
  language: "en_US",
  subject: "",
  headerType: "none",
  headerText: "",
  body: [
    "Hello {{1}},",
    "",
    "A new customer enquiry matching your service profile is available on Findoly.",
    "",
    "Service: {{2}}",
    "Service area: {{3}}",
    "Requirement: {{4}}",
    "",
    "Tap the button below to review the enquiry details in your Provider Portal.",
    "",
    "Thank you,",
    "Team Findoly",
  ].join("\n"),
  bodyHtml: "",
  footer: "",
  buttons: [
    { type: "QUICK_REPLY", text: "Unlock Lead" },
    { type: "URL", text: "View Lead", url: "https://provider.findoly.com/lead/{{1}}" },
  ],
  sampleVariables: [
    "Provider name",
    "Painting",
    "Malad West, 400064 https://www.google.com/maps/search/?api=1&query=19.186%2C72.849",
    "Interior painting requirement",
    "https://provider.findoly.com/lead/ENQUIRY-ID",
  ],
  status: "draft",
  isActive: true,
});

async function ensureTemplate(definition) {
  const query = {
    channel: definition.channel,
    name: definition.name,
    language: definition.language,
  };
  let current = await CommunicationTemplate.findOne(query).lean();
  if (current) return current;
  try {
    const created = await CommunicationTemplate.create({
      ...definition,
      createdBy: "system",
      updatedBy: "system",
    });
    return created.toObject ? created.toObject() : created;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    current = await CommunicationTemplate.findOne(query).lean();
    if (!current) throw error;
    return current;
  }
}

async function linkRule({ event, recipientSource, templateField, template, defaultName }) {
  const rule = await CommunicationRule.findOne({ event, recipientSource }).lean();
  if (!rule) return null;
  const update = {};
  if (!rule.name || (event === "provider_created" && rule.name === "Provider registration")) update.name = defaultName;
  if (!String(rule[templateField] || "").trim()) update[templateField] = template.templateId;
  if (Object.keys(update).length) {
    update.updatedBy = "system";
    await CommunicationRule.updateOne({ ruleId: rule.ruleId }, { $set: update });
  }
  return { ...rule, ...update };
}

async function ensureDefaultProviderTemplates() {
  const [email, whatsapp] = await Promise.all([
    ensureTemplate(emailTemplate),
    ensureTemplate(whatsappTemplate),
  ]);
  const providerRule = await linkRule({
    event: "provider_created",
    recipientSource: "provider",
    templateField: "emailTemplateId",
    template: email,
    defaultName: "Provider account created",
  });
  if (providerRule && !String(providerRule.whatsappTemplateId || "").trim()) {
    await CommunicationRule.updateOne(
      { ruleId: providerRule.ruleId },
      { $set: { whatsappTemplateId: whatsapp.templateId, updatedBy: "system" } },
    );
    providerRule.whatsappTemplateId = whatsapp.templateId;
  }
  const nearbyLeadWhatsapp = await CommunicationTemplate.findOne({
    channel: "whatsapp",
    name: NEARBY_LEAD_WHATSAPP_TEMPLATE_NAME,
  }).lean();
  let nearbyLeadRule = await CommunicationRule.findOne({
    event: "nearby_lead_available",
    recipientSource: "provider",
  }).lean();
  if (nearbyLeadRule?.whatsappTemplateId) {
    const assignedTemplate = await CommunicationTemplate.findOne({
      templateId: nearbyLeadRule.whatsappTemplateId,
      channel: "whatsapp",
    }).lean();
    if (assignedTemplate) {
      const definitions = Array.isArray(assignedTemplate.parameterDefinitions) && assignedTemplate.parameterDefinitions.length
        ? assignedTemplate.parameterDefinitions
        : parameterDefinitions(assignedTemplate);
      const defaults = ["provider_name", "service_name", "lead_area_map", "requirement_title", "lead_url"];
      const quickReply = (assignedTemplate.buttons || []).map((button, index) => ({
        index: Number.isInteger(Number(button?.index)) ? Number(button.index) : index,
        type: String(button?.type || button?.buttonType || "").toUpperCase(),
      })).find((button) => button.type.includes("QUICK") || button.type === "REPLY");
      const update = {};
      const currentMappings = Array.isArray(nearbyLeadRule.whatsappParameterMappings)
        ? nearbyLeadRule.whatsappParameterMappings
        : [];
      if (!currentMappings.length) {
        update.whatsappParameterMappings = definitions.map((definition, index) => defaults[index] || definition.placeholder || String(index + 1));
      } else if (currentMappings[2] === "lead_location") {
        update.whatsappParameterMappings = currentMappings.map((mapping, index) =>
          index === 2 ? "lead_area_map" : mapping,
        );
      }
      if (!nearbyLeadRule.whatsappActionType && quickReply) update.whatsappActionType = "unlock_lead";
      if ((nearbyLeadRule.whatsappActionButtonIndex === null || nearbyLeadRule.whatsappActionButtonIndex === undefined) && quickReply) {
        update.whatsappActionButtonIndex = quickReply.index;
      }
      if (Object.keys(update).length) {
        update.updatedBy = "system";
        await CommunicationRule.updateOne({ ruleId: nearbyLeadRule.ruleId }, { $set: update });
        nearbyLeadRule = { ...nearbyLeadRule, ...update };
      }
    }
  }
  return { email, whatsapp, nearbyLeadWhatsapp, rule: providerRule, nearbyLeadRule };
}


const INTERNAL_ALERT_DEFINITIONS = Object.freeze([
  {
    event: "lead_created",
    name: "findoly_internal_crm_lead_created",
    displayName: "Internal alert — CRM lead created",
    ruleName: "CRM lead created",
    description: "Email alert to the Findoly operations inbox when a CRM employee creates a lead.",
    subject: "[Findoly Alert] New CRM lead — {{lead_id}}",
    body: [
      "A new lead was created in Findoly CRM.",
      "",
      "Lead ID: {{lead_id}}",
      "Customer: {{customer_name}}",
      "Requirement: {{requirement_title}}",
      "Service types: {{service_types}}",
      "Category: {{category}}",
      "Location: {{lead_location}}",
      "Created by: {{created_by}}",
      "Created at: {{event_time}}",
    ].join("\n"),
  },
  {
    event: "partner_lead_submitted",
    name: "findoly_internal_partner_lead_submitted",
    displayName: "Internal alert — Partner lead submitted",
    ruleName: "Partner lead submitted",
    description: "Email alert to the Findoly operations inbox when a Partner submits a lead.",
    subject: "[Findoly Alert] New Partner lead — {{lead_id}}",
    body: [
      "A Partner submitted a new lead.",
      "",
      "Partner: {{agent_name}}",
      "Partner ID: {{agent_id}}",
      "Referral ID: {{referral_id}}",
      "Lead ID: {{lead_id}}",
      "Customer: {{customer_name}}",
      "Requirement: {{requirement_title}}",
      "Service types: {{service_types}}",
      "Category: {{category}}",
      "Location: {{lead_location}}",
      "Submitted at: {{event_time}}",
    ].join("\n"),
  },
  {
    event: "agent_created",
    name: "findoly_internal_partner_account_created",
    displayName: "Internal alert — Partner account created",
    ruleName: "Partner account created",
    description: "Email alert to the Findoly operations inbox when a Partner account is created.",
    subject: "[Findoly Alert] New Partner account — {{agent_id}}",
    body: [
      "A new Partner account was created.",
      "",
      "Partner: {{agent_name}}",
      "Partner ID: {{agent_id}}",
      "Referral ID: {{referral_id}}",
      "Business: {{business_name}}",
      "Partner type: {{agent_type}}",
      "Category: {{category_name}}",
      "Location: {{assigned_location}}",
      "Created at: {{registration_date}}",
    ].join("\n"),
  },
  {
    event: "provider_join_request_submitted",
    name: "findoly_internal_provider_join_request_submitted",
    displayName: "Internal alert — Provider joining request",
    ruleName: "Provider joining request submitted",
    description: "Email alert to the Findoly operations inbox when a provider submits a joining request.",
    subject: "[Findoly Alert] New provider joining request — {{provider_join_request_id}}",
    body: [
      "A new provider joining request was submitted.",
      "",
      "Request ID: {{provider_join_request_id}}",
      "Provider: {{provider_name}}",
      "Business: {{business_name}}",
      "Category: {{category}}",
      "Service location: {{service_location}}",
      "Submitted at: {{registration_date}}",
    ].join("\n"),
  },
  {
    event: "provider_created",
    name: "findoly_internal_provider_account_created",
    displayName: "Internal alert — Provider account created",
    ruleName: "Provider account created — internal",
    description: "Email alert to the Findoly operations inbox when a provider account is created.",
    subject: "[Findoly Alert] New provider account — {{provider_id}}",
    body: [
      "A new provider account was created.",
      "",
      "Provider: {{provider_name}}",
      "Provider ID: {{provider_id}}",
      "Business: {{business_name}}",
      "Categories: {{service_categories}}",
      "Service location: {{service_location}}",
      "Status: {{status}}",
      "Created at: {{registration_date}}",
    ].join("\n"),
  },
]);

async function ensureInternalAlertTemplatesAndRules() {
  const output = [];
  for (const definition of INTERNAL_ALERT_DEFINITIONS) {
    const template = await ensureTemplate({
      name: definition.name,
      displayName: definition.displayName,
      channel: "email",
      category: "transactional",
      language: "en_US",
      subject: definition.subject,
      body: definition.body,
      bodyHtml: "",
      footer: "",
      sampleVariables: [...new Set(
        Array.from(
          `${definition.subject}\n${definition.body}`.matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g),
          (match) => match[1],
        ),
      )],
      status: "active",
      isActive: true,
    });
    const result = await CommunicationRule.updateOne(
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
      await CommunicationRule.updateOne(
        { ruleId: rule.ruleId },
        { $set: { emailTemplateId: template.templateId, updatedBy: "system" } },
      );
      rule = { ...rule, emailTemplateId: template.templateId };
    }
    output.push({ definition, template, rule, created: Boolean(result.upsertedCount) });
  }
  return output;
}

module.exports = {
  ensureDefaultProviderTemplates,
  EMAIL_TEMPLATE_NAME,
  WHATSAPP_TEMPLATE_NAME,
  NEARBY_LEAD_WHATSAPP_TEMPLATE_NAME,
  INTERNAL_ALERT_DEFINITIONS,
  ensureInternalAlertTemplatesAndRules,
};
