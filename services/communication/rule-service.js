const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const {
  textValue,
  booleanValue,
  enumValue,
  identifierValue,
  validationError,
} = require("../../utils/validation");
const { normalizeChannelId } = require("./slack-service");

const RECIPIENT_SOURCES = Object.freeze(["customer", "provider", "agent", "employee", "manual"]);
const EVENTS = Object.freeze([
  "lead_created",
  "lead_status_changed",
  "lead_approved",
  "lead_rejected",
  "lead_on_hold",
  "lead_distributed",
  "provider_confirmed",
  "provider_rejected",
  "provider_invalid",
  "sale_conversion_updated",
  "manual_message",
  "provider_created",
  "agent_created",
  "employee_created",
]);

const normalizeEvent = function (value) {
  const event = textValue(value, { label: "Rule event", required: true, maxLength: 100 }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(event)) throw validationError("Rule event is invalid");
  return event;
};

const validateTemplate = async function (templateId, channel, enabled) {
  if (!enabled) return "";
  const id = identifierValue(templateId, { label: `${channel} template ID` });
  const template = await CommunicationTemplate.findOne({ templateId: id, channel, isActive: true }).lean();
  if (!template) throw validationError(`${channel} template was not found or is inactive`);
  if (channel === "whatsapp" && template.status !== "approved") {
    throw validationError("WhatsApp rule requires an approved template");
  }
  if (channel === "email" && template.status !== "active") {
    throw validationError("Email rule requires an active email template");
  }
  return id;
};

const normalizeInput = async function (input, current) {
  const existing = current || {};
  const whatsappEnabled = booleanValue(input.whatsappEnabled, {
    label: "WhatsApp enabled",
    fallback: existing.whatsappEnabled || false,
  });
  const emailEnabled = booleanValue(input.emailEnabled, {
    label: "Email enabled",
    fallback: existing.emailEnabled || false,
  });
  const slackEnabled = booleanValue(input.slackEnabled, {
    label: "Slack enabled",
    fallback: existing.slackEnabled || false,
  });
  const data = {
    name: textValue(input.name ?? existing.name, { label: "Rule name", required: true, maxLength: 160 }),
    event: normalizeEvent(input.event ?? existing.event),
    enabled: booleanValue(input.enabled, { label: "Rule enabled", fallback: existing.enabled || false }),
    whatsappEnabled,
    whatsappTemplateId: await validateTemplate(
      input.whatsappTemplateId ?? existing.whatsappTemplateId,
      "whatsapp",
      whatsappEnabled,
    ),
    emailEnabled,
    emailTemplateId: await validateTemplate(
      input.emailTemplateId ?? existing.emailTemplateId,
      "email",
      emailEnabled,
    ),
    slackEnabled,
    slackChannelId: normalizeChannelId(
      input.slackChannelId ?? existing.slackChannelId ?? process.env.SLACK_DEFAULT_CHANNEL_ID ?? "",
      {
        label: "Slack channel ID",
        required: slackEnabled,
      },
    ),
    slackChannelName: textValue(
      input.slackChannelName ?? existing.slackChannelName ?? process.env.SLACK_DEFAULT_CHANNEL_NAME ?? "internal-team",
      {
        label: "Slack channel name",
        required: slackEnabled,
        maxLength: 100,
      },
    ).replace(/^#/, ""),
    slackMessage: textValue(input.slackMessage ?? existing.slackMessage, {
      label: "Slack message",
      required: slackEnabled,
      maxLength: 10000,
      preserveWhitespace: true,
    }),
    recipientSource: enumValue(input.recipientSource, RECIPIENT_SOURCES, {
      label: "Rule recipient source",
      fallback: existing.recipientSource || "customer",
    }),
    description: textValue(input.description ?? existing.description, {
      label: "Rule description",
      maxLength: 1000,
      preserveWhitespace: true,
    }),
  };
  if (data.enabled && !data.whatsappEnabled && !data.emailEnabled && !data.slackEnabled) {
    throw validationError("Enable at least one channel before enabling the rule");
  }
  if (data.slackEnabled && !data.slackMessage.trim()) {
    throw validationError("Slack message is required when Slack is enabled");
  }
  return data;
};

const list = async function () {
  return CommunicationRule.find({}).sort({ event: 1, name: 1 }).lean();
};

const get = async function (ruleId) {
  const id = identifierValue(ruleId, { label: "Rule ID" });
  const rule = await CommunicationRule.findOne({ ruleId: id }).lean();
  if (!rule) throw Object.assign(new Error("Communication rule not found"), { status: 404 });
  return rule;
};

const translateRuleWriteError = function (error) {
  if (error?.code === 11000) {
    throw validationError("A communication rule already exists for this event and recipient", 409);
  }
  throw error;
};

const create = async function (input, actor) {
  const data = await normalizeInput(input || {}, {});
  data.createdBy = actor || "admin";
  data.updatedBy = actor || "admin";
  try {
    return await CommunicationRule.create(data);
  } catch (error) {
    return translateRuleWriteError(error);
  }
};

const update = async function (ruleId, input, actor) {
  const current = await get(ruleId);
  if (input.ruleId && String(input.ruleId) !== current.ruleId) {
    throw validationError("Rule ID cannot be changed");
  }
  const data = await normalizeInput(input || {}, current);
  data.updatedBy = actor || "admin";
  try {
    await CommunicationRule.updateOne({ ruleId: current.ruleId }, { $set: data });
  } catch (error) {
    return translateRuleWriteError(error);
  }
  return get(current.ruleId);
};

module.exports = { list, get, create, update, normalizeInput, EVENTS, RECIPIENT_SOURCES };
