"use strict";

const CommunicationTemplate = require("../../models/CommunicationTemplate");
const CommunicationRule = require("../../models/CommunicationRule");

const EMAIL_TEMPLATE_NAME = "findoly_provider_account_created_email";
const WHATSAPP_TEMPLATE_NAME = "findoly_provider_account_created";

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

async function linkProviderRule(email, whatsapp) {
  const rule = await CommunicationRule.findOne({
    event: "provider_created",
    recipientSource: "provider",
  }).lean();
  if (!rule) return null;

  const update = {};
  if (!rule.name || rule.name === "Provider registration") {
    update.name = "Provider account created";
  }
  if (!String(rule.emailTemplateId || "").trim()) {
    update.emailTemplateId = email.templateId;
  }
  if (!String(rule.whatsappTemplateId || "").trim()) {
    update.whatsappTemplateId = whatsapp.templateId;
  }
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
  const rule = await linkProviderRule(email, whatsapp);
  return { email, whatsapp, rule };
}

module.exports = {
  ensureDefaultProviderTemplates,
  EMAIL_TEMPLATE_NAME,
  WHATSAPP_TEMPLATE_NAME,
};
