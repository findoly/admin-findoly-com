"use strict";

const CommunicationRule = require("../../models/CommunicationRule");
const CommunicationTemplate = require("../../models/CommunicationTemplate");
const { parameterDefinitions } = require("./gupshup-template-service");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { metadataForKeys } = require("../../utils/communication-variables");
const {
  textValue,
  booleanValue,
  enumValue,
  identifierValue,
  validationError,
  queryTextValue,
} = require("../../utils/validation");

const RECIPIENT_SOURCES = Object.freeze(["customer", "provider", "agent", "employee", "manual", "internal"]);
const INTERNAL_ALERT_EVENTS = Object.freeze([
  "lead_created",
  "partner_lead_submitted",
  "agent_created",
  "provider_join_request_submitted",
  "provider_created",
]);
const EVENTS = Object.freeze([
  "lead_created",
  "lead_status_changed",
  "lead_approved",
  "lead_rejected",
  "lead_on_hold",
  "provider_confirmed",
  "provider_not_confirmed",
  "provider_contacted",
  "provider_valid",
  "provider_follow_up",
  "provider_on_hold",
  "provider_rejected",
  "provider_invalid",
  "provider_not_interested",
  "provider_other",
  "sale_conversion_updated",
  "manual_message",
  "nearby_lead_available",
  "provider_created",
  "agent_created",
  "employee_created",
  "partner_lead_submitted",
  "provider_join_request_submitted",
]);

const COMMON_VARIABLES = Object.freeze([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "customer_name", "lead_id", "requirement_title", "service_type", "service_types",
  "priority", "lead_status", "category", "provider_name", "note",
]);
const EVENT_VARIABLES = Object.freeze({
  nearby_lead_available: Object.freeze([
    "provider_name",
    "service_name",
    "lead_area",
    "lead_map_url",
    "lead_area_map",
    "lead_location",
    "requirement_title",
    "lead_url",
    "lead_url_suffix",
    ...COMMON_VARIABLES,
  ]),
  provider_created: Object.freeze([
    "provider_name", "provider_id", "business_name", "email", "phone", "status",
    "onboarding_stage", "service_categories", "service_location", "city", "state",
    "login_url", "support_email", "registration_date", ...COMMON_VARIABLES,
  ]),
  agent_created: Object.freeze([
    "agent_name", "agent_id", "referral_id", "business_name", "agent_type", "email",
    "phone", "category_name", "city", "state", "assigned_location", "login_url",
    "support_email", "registration_date", ...COMMON_VARIABLES,
  ]),
  employee_created: Object.freeze([
    "employee_name", "employee_id", "employee_code", "email", "phone", "designation",
    "department", "role_name", "login_url", "support_email", "registration_date",
    ...COMMON_VARIABLES,
  ]),
  partner_lead_submitted: Object.freeze([
    "agent_name", "agent_id", "referral_id", "customer_name", "lead_id", "service_type",
    "service_types", "category", "lead_location", "requirement_title", "priority",
    "source_channel", "source_website", ...COMMON_VARIABLES,
  ]),
  provider_join_request_submitted: Object.freeze([
    "provider_join_request_id", "provider_name", "business_name", "category",
    "service_location", "city", "state", "registration_date", ...COMMON_VARIABLES,
  ]),
  default: COMMON_VARIABLES,
});
const DEFAULT_NEARBY_MAPPINGS = Object.freeze([
  "provider_name",
  "service_name",
  "lead_area_map",
  "requirement_title",
  "lead_url",
]);
const EVENT_VARIABLE_METADATA = Object.freeze(Object.fromEntries(
  Object.entries(EVENT_VARIABLES).map(([event, variables]) => [event, Object.freeze(metadataForKeys(variables))]),
));

const normalizeEvent = function (value) {
  const event = textValue(value, { label: "Rule event", required: true, maxLength: 100 }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(event)) throw validationError("Rule event is invalid");
  return event;
};

function definitionsFor(template) {
  if (!template) return [];
  if (Array.isArray(template.parameterDefinitions) && template.parameterDefinitions.length) {
    return template.parameterDefinitions;
  }
  return parameterDefinitions(template);
}

function quickReplyIndexes(template) {
  return (Array.isArray(template?.buttons) ? template.buttons : [])
    .map((button, index) => ({
      index: Number.isInteger(Number(button?.index)) ? Number(button.index) : index,
      type: String(button?.type || button?.buttonType || "").toUpperCase(),
    }))
    .filter((button) => button.type.includes("QUICK") || button.type === "REPLY")
    .map((button) => button.index);
}

const validateTemplate = async function (templateId, channel, enabled) {
  if (!enabled) return null;
  const id = identifierValue(templateId, { label: `${channel} template ID` });
  const template = await CommunicationTemplate.findOne({ templateId: id, channel, isActive: true }).lean();
  if (!template) throw validationError(`${channel} template was not found or is disabled in CRM`);
  if (channel === "whatsapp" && (template.status !== "approved" || !template.externalTemplateId)) {
    throw validationError("WhatsApp rule requires a synchronized, approved Gupshup template");
  }
  if (channel === "whatsapp" && ["image", "video", "document"].includes(String(template.headerType || "").toLowerCase())) {
    throw validationError("This WhatsApp media-header template is synchronized for visibility but is not supported by the current CRM sender");
  }
  if (channel === "email" && template.status !== "active") {
    throw validationError("Email rule requires an active email template");
  }
  return template;
};

function normalizeMappings(value, event, template, currentMappings = []) {
  let mappings = value;
  if (typeof mappings === "string") {
    try {
      mappings = JSON.parse(mappings);
    } catch (_error) {
      mappings = mappings.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(mappings)) mappings = Array.isArray(currentMappings) ? currentMappings : [];
  const definitions = definitionsFor(template);
  if (!mappings.length && definitions.length) {
    if (event === "nearby_lead_available") {
      mappings = definitions.map((definition, index) => DEFAULT_NEARBY_MAPPINGS[index] || definition.placeholder || String(index + 1));
    } else {
      mappings = definitions.map((definition, index) => definition.placeholder || String(index + 1));
    }
  }
  mappings = mappings.map((entry) => String(entry || "").trim());
  if (mappings.length > 50) throw validationError("WhatsApp template cannot map more than 50 parameters");
  if (definitions.length && mappings.length !== definitions.length) {
    throw validationError(`WhatsApp template requires ${definitions.length} mapped parameters`);
  }
  const allowed = new Set(EVENT_VARIABLES[event] || EVENT_VARIABLES.default);
  mappings.forEach((mapping, index) => {
    if (!mapping) throw validationError(`WhatsApp parameter ${index + 1} must be mapped`);
    if (!allowed.has(mapping)) {
      throw validationError(`WhatsApp parameter mapping ${mapping} is not available for ${event}`);
    }
  });
  return mappings;
}

const normalizeInput = async function (input, current) {
  const existing = current || {};
  const event = normalizeEvent(input.event ?? existing.event);
  const requestedRecipientSource = input.recipientSource ?? existing.recipientSource ?? "customer";
  const recipientSource = event === "nearby_lead_available"
    ? "provider"
    : enumValue(requestedRecipientSource, RECIPIENT_SOURCES, {
      label: "Rule recipient source",
      fallback: existing.recipientSource || "customer",
    });
  const whatsappOnly = event === "nearby_lead_available";
  const internalOnly = recipientSource === "internal";
  if (internalOnly && !INTERNAL_ALERT_EVENTS.includes(event)) {
    throw validationError("Select a supported internal email alert event");
  }
  const whatsappEnabled = internalOnly ? false : booleanValue(input.whatsappEnabled, {
    label: "WhatsApp enabled",
    fallback: existing.whatsappEnabled || false,
  });
  const emailEnabled = whatsappOnly
    ? false
    : internalOnly
      ? true
      : booleanValue(input.emailEnabled, {
          label: "Email enabled",
          fallback: existing.emailEnabled || false,
        });
  const whatsappTemplate = await validateTemplate(
    input.whatsappTemplateId ?? existing.whatsappTemplateId,
    "whatsapp",
    whatsappEnabled,
  );
  const emailTemplate = await validateTemplate(
    input.emailTemplateId ?? existing.emailTemplateId,
    "email",
    emailEnabled,
  );
  const whatsappParameterMappings = whatsappEnabled
    ? normalizeMappings(
      input.whatsappParameterMappings,
      event,
      whatsappTemplate,
      existing.whatsappParameterMappings,
    )
    : [];
  let whatsappActionType = whatsappEnabled
    ? enumValue(input.whatsappActionType, ["", "unlock_lead"], {
      label: "WhatsApp action",
      fallback: existing.whatsappActionType || (whatsappOnly ? "unlock_lead" : ""),
    })
    : "";
  if (whatsappOnly && whatsappEnabled) whatsappActionType = "unlock_lead";
  const availableQuickReplies = quickReplyIndexes(whatsappTemplate);
  const requestedButtonIndex = input.whatsappActionButtonIndex ?? existing.whatsappActionButtonIndex;
  let whatsappActionButtonIndex = null;
  if (whatsappActionType === "unlock_lead") {
    whatsappActionButtonIndex = requestedButtonIndex === undefined || requestedButtonIndex === null || requestedButtonIndex === ""
      ? (availableQuickReplies[0] ?? null)
      : Number(requestedButtonIndex);
    if (!Number.isInteger(whatsappActionButtonIndex) || !availableQuickReplies.includes(whatsappActionButtonIndex)) {
      throw validationError("Select a valid quick-reply button for the Unlock Lead action");
    }
  }

  const data = {
    name: textValue(input.name ?? existing.name, { label: "Rule name", required: true, maxLength: 160 }),
    event,
    enabled: booleanValue(input.enabled, { label: "Rule enabled", fallback: existing.enabled || false }),
    whatsappEnabled,
    whatsappTemplateId: whatsappTemplate?.templateId || "",
    whatsappParameterMappings,
    whatsappActionType,
    whatsappActionButtonIndex,
    emailEnabled,
    emailTemplateId: emailTemplate?.templateId || "",
    recipientSource,
    description: textValue(input.description ?? existing.description, {
      label: "Rule description",
      maxLength: 1000,
      preserveWhitespace: true,
    }),
  };
  if (whatsappOnly) {
    data.emailEnabled = false;
    data.emailTemplateId = "";
  }
  if (internalOnly) {
    data.whatsappEnabled = false;
    data.whatsappTemplateId = "";
    data.whatsappParameterMappings = [];
    data.whatsappActionType = "";
    data.whatsappActionButtonIndex = null;
  }
  if (data.enabled && !data.whatsappEnabled && !data.emailEnabled) {
    throw validationError("Enable WhatsApp or email before enabling the automation");
  }
  return data;
};

const list = async function (filters) {
  const source = filters || {};
  const { limit, cursor } = getPagination(source);
  const query = {};
  if (source.event) query.event = normalizeEvent(source.event);
  if (source.recipientSource) {
    query.recipientSource = enumValue(source.recipientSource, RECIPIENT_SOURCES, {
      label: "Rule recipient filter",
    });
  }
  if (!source.recipientSource && String(source.excludeInternal || "").toLowerCase() === "true") {
    query.recipientSource = { $ne: "internal" };
  }
  if (source.enabled !== undefined && source.enabled !== "") {
    query.enabled = booleanValue(source.enabled, { label: "Rule enabled filter" });
  }
  if (source.channel) {
    const channel = enumValue(source.channel, ["whatsapp", "email"], {
      label: "Rule channel filter",
    });
    query[`${channel}Enabled`] = true;
  }
  const q = queryTextValue(source.q, { label: "Rule search", maxLength: 100 });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["ruleId", "event"],
      prefixFields: ["name", "description"],
    });
  }
  const sortOrder = source.sortOrder
    ? enumValue(source.sortOrder, ["name", "event", "newest", "oldest"], { label: "Rule sort order" })
    : "event";
  const sort = sortOrder === "name"
    ? { name: 1, _id: 1 }
    : sortOrder === "newest"
      ? { updatedAt: -1, _id: -1 }
      : sortOrder === "oldest"
        ? { updatedAt: 1, _id: 1 }
        : { event: 1, name: 1, _id: 1 };
  return cursorPaginate(CommunicationRule, { query, sort, limit, cursor });
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
  const source = input || {};
  if (source.ruleId && String(source.ruleId) !== current.ruleId) {
    throw validationError("Rule ID cannot be changed");
  }
  if (current.recipientSource === "internal") {
    if (source.event !== undefined && String(source.event) !== current.event) {
      throw validationError("Internal alert event cannot be changed");
    }
    if (source.recipientSource !== undefined && String(source.recipientSource) !== "internal") {
      throw validationError("Internal alert recipient cannot be changed");
    }
  }
  const data = await normalizeInput(source, current);
  data.updatedBy = actor || "admin";
  try {
    await CommunicationRule.updateOne({ ruleId: current.ruleId }, { $set: data });
  } catch (error) {
    return translateRuleWriteError(error);
  }
  return get(current.ruleId);
};

module.exports = {
  list,
  get,
  create,
  update,
  normalizeInput,
  definitionsFor,
  quickReplyIndexes,
  EVENTS,
  RECIPIENT_SOURCES,
  INTERNAL_ALERT_EVENTS,
  EVENT_VARIABLES,
  EVENT_VARIABLE_METADATA,
  DEFAULT_NEARBY_MAPPINGS,
};
