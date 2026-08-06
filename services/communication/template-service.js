"use strict";

const CommunicationTemplate = require("../../models/CommunicationTemplate");
const CommunicationRule = require("../../models/CommunicationRule");
const gupshupTemplateService = require("./gupshup-template-service");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { templateVariableDefinitions } = require("../../utils/communication-variables");
const {
  textValue,
  enumValue,
  booleanValue,
  numberValue,
  identifierValue,
  stringArrayValue,
  validationError,
} = require("../../utils/validation");

const CHANNELS = Object.freeze(["whatsapp", "email"]);
const CATEGORIES = Object.freeze(["authentication", "utility", "marketing", "transactional"]);
const STATUSES = Object.freeze([
  "draft",
  "pending",
  "approved",
  "rejected",
  "paused",
  "disabled",
  "deleted",
  "active",
  "inactive",
]);
const HEADER_TYPES = Object.freeze(["none", "text", "image", "video", "document"]);

const normalizeName = function (value) {
  const name = textValue(value, {
    label: "Template name",
    required: true,
    maxLength: 512,
  }).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw validationError("Template name may contain only lowercase letters, numbers and underscores");
  }
  return name;
};

const normalizeButtons = function (value) {
  if (value === undefined || value === null || value === "") return [];
  let buttons = value;
  if (typeof buttons === "string") {
    try {
      buttons = JSON.parse(buttons);
    } catch (_error) {
      throw validationError("Template buttons must be valid JSON");
    }
  }
  if (!Array.isArray(buttons)) throw validationError("Template buttons must be a list");
  if (buttons.length > 10) throw validationError("Template cannot contain more than 10 buttons");
  return buttons.map(function (button) {
    if (!button || typeof button !== "object" || Array.isArray(button)) {
      throw validationError("Each template button must be an object");
    }
    return JSON.parse(JSON.stringify(button));
  });
};

const normalizeTemplateInput = function (input, current) {
  const existing = current || {};
  const channel = enumValue(input.channel, CHANNELS, {
    label: "Template channel",
    fallback: existing.channel || "whatsapp",
  });
  let category = enumValue(input.category, CATEGORIES, {
    label: "Template category",
    fallback: existing.category || (channel === "email" ? "transactional" : "utility"),
  });
  if (channel === "email" && category === "authentication") category = "transactional";
  if (channel === "whatsapp" && category === "transactional") category = "utility";

  const body = textValue(input.body ?? existing.body, {
    label: "Template body",
    required: true,
    maxLength: 20000,
    preserveWhitespace: true,
  });
  const data = {
    name: normalizeName(input.name ?? existing.name),
    displayName: textValue(input.displayName ?? existing.displayName, {
      label: "Template display name",
      maxLength: 160,
    }),
    channel,
    category,
    language: textValue(input.language ?? existing.language, {
      label: "Template language",
      fallback: "en_US",
      required: true,
      maxLength: 20,
    }),
    subject: textValue(input.subject ?? existing.subject, {
      label: "Email subject",
      required: channel === "email",
      maxLength: 300,
    }),
    headerType: enumValue(input.headerType, HEADER_TYPES, {
      label: "Template header type",
      fallback: existing.headerType || "none",
    }),
    headerText: textValue(input.headerText ?? existing.headerText, {
      label: "Template header",
      maxLength: 500,
    }),
    body,
    bodyHtml: textValue(input.bodyHtml ?? existing.bodyHtml, {
      label: "Email HTML body",
      maxLength: 100000,
      preserveWhitespace: true,
    }),
    footer: textValue(input.footer ?? existing.footer, {
      label: "Template footer",
      maxLength: 1000,
      preserveWhitespace: true,
    }),
    buttons: normalizeButtons(input.buttons ?? existing.buttons),
    sampleVariables: stringArrayValue(input.sampleVariables ?? existing.sampleVariables, {
      label: "Sample variables",
      maxItems: 50,
      itemMaxLength: 500,
    }),
    otpExpiryMinutes: numberValue(input.otpExpiryMinutes, {
      label: "OTP expiry minutes",
      fallback: existing.otpExpiryMinutes || 5,
      min: 1,
      max: 90,
      integer: true,
    }),
    isActive: booleanValue(input.isActive, {
      label: "Template active state",
      fallback: existing.isActive !== false,
    }),
    externalTemplateId: textValue(input.externalTemplateId ?? existing.externalTemplateId, {
      label: "Gupshup template ID",
      maxLength: 500,
    }),
  };
  if (channel === "email" && !data.bodyHtml) data.bodyHtml = body;
  if (channel === "whatsapp" && data.headerType !== "text") data.headerText = "";
  const existingDefinitions = Array.isArray(existing.parameterDefinitions) ? existing.parameterDefinitions : [];
  const lockedWhatsappContent = channel === "whatsapp"
    && (existing.providerPayload?.managedExternally === true || existing.status === "approved");
  data.parameterDefinitions = lockedWhatsappContent
    ? existingDefinitions
    : templateVariableDefinitions({ ...existing, ...data });
  return data;
};

function presentTemplate(template, assignedEvents = []) {
  const templateVariables = templateVariableDefinitions(template);
  return {
    ...template,
    parameterDefinitions: templateVariables,
    templateVariables,
    variableCount: templateVariables.length,
    assignedEvents,
    providerManaged: template.channel === "whatsapp" && template.providerPayload?.managedExternally === true,
  };
}

const list = async function (filters) {
  const source = filters || {};
  const { limit, cursor } = getPagination(source);
  const query = {};
  if (source.channel) query.channel = enumValue(source.channel, CHANNELS, { label: "Template channel filter" });
  if (source.status) query.status = enumValue(source.status, STATUSES, { label: "Template status filter" });
  if (source.category) query.category = enumValue(source.category, CATEGORIES, { label: "Template category filter" });
  if (source.active !== undefined && source.active !== "") {
    query.isActive = booleanValue(source.active, { label: "Template active filter" });
  }
  if (source.language) {
    query.language = textValue(source.language, { label: "Template language filter", maxLength: 20 });
  }
  if (source.q) {
    const q = textValue(source.q, { label: "Template search", maxLength: 100 });
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["templateId", "name", "externalTemplateId"],
      prefixFields: ["displayName", "subject"],
    });
  }

  const sortOrder = source.sortOrder
    ? enumValue(source.sortOrder, ["newest", "oldest", "name"], { label: "Template sort order" })
    : "newest";
  const sort = sortOrder === "name"
    ? { name: 1, _id: 1 }
    : { updatedAt: sortOrder === "oldest" ? 1 : -1, _id: sortOrder === "oldest" ? 1 : -1 };

  const result = await cursorPaginate(CommunicationTemplate, { query, sort, limit, cursor });
  const ids = result.data.map((template) => template.templateId).filter(Boolean);
  const rules = ids.length
    ? await CommunicationRule.find({
      $or: [
        { whatsappTemplateId: { $in: ids } },
        { emailTemplateId: { $in: ids } },
      ],
    }).select({ event: 1, whatsappTemplateId: 1, emailTemplateId: 1, enabled: 1 }).lean()
    : [];
  const assignments = new Map();
  rules.forEach((rule) => {
    [rule.whatsappTemplateId, rule.emailTemplateId].filter(Boolean).forEach((id) => {
      if (!assignments.has(id)) assignments.set(id, []);
      assignments.get(id).push({ event: rule.event, enabled: rule.enabled === true });
    });
  });
  result.data = result.data.map((template) => presentTemplate(
    template,
    assignments.get(template.templateId) || [],
  ));
  return result;
};

const get = async function (templateId) {
  const id = identifierValue(templateId, { label: "Template ID" });
  const template = await CommunicationTemplate.findOne({ templateId: id }).lean();
  if (!template) throw Object.assign(new Error("Communication template not found"), { status: 404 });
  const rules = await CommunicationRule.find({
    $or: [{ whatsappTemplateId: id }, { emailTemplateId: id }],
  }).select({ event: 1, enabled: 1 }).lean();
  return presentTemplate(
    template,
    rules.map((rule) => ({ event: rule.event, enabled: rule.enabled === true })),
  );
};

const translateTemplateWriteError = function (error) {
  if (error?.code === 11000) {
    throw validationError("A template with this name, channel and language already exists", 409);
  }
  throw error;
};

const create = async function (input, actor) {
  const data = normalizeTemplateInput(input || {}, {});
  data.status = data.channel === "email" ? "active" : "draft";
  data.createdBy = actor || "admin";
  data.updatedBy = actor || "admin";
  try {
    return await CommunicationTemplate.create(data);
  } catch (error) {
    return translateTemplateWriteError(error);
  }
};

const update = async function (templateId, input, actor) {
  const current = await get(templateId);
  if (input.templateId && String(input.templateId) !== current.templateId) {
    throw validationError("Template ID cannot be changed");
  }
  const data = normalizeTemplateInput(input || {}, current);
  data.updatedBy = actor || "admin";
  const providerManaged = current.channel === "whatsapp" && current.providerPayload?.managedExternally === true;
  if (providerManaged) {
    const editableFields = ["displayName", "isActive"];
    const changedProviderField = Object.keys(data).some(function (key) {
      return !editableFields.includes(key) && JSON.stringify(data[key]) !== JSON.stringify(current[key]);
    });
    if (changedProviderField) {
      throw validationError("Synchronized WhatsApp content is read-only; edit it in Gupshup and synchronize again");
    }
  } else if (current.channel === "whatsapp" && current.status === "approved") {
    const editableFields = ["displayName", "isActive", "externalTemplateId"];
    const changedProviderField = Object.keys(data).some(function (key) {
      return !editableFields.includes(key) && JSON.stringify(data[key]) !== JSON.stringify(current[key]);
    });
    if (changedProviderField) {
      throw validationError("Approved WhatsApp template content cannot be edited; create a new template version");
    }
    if (data.externalTemplateId !== current.externalTemplateId) {
      data.status = "draft";
      data.submittedAt = null;
      data.syncedAt = null;
    }
  }
  try {
    await CommunicationTemplate.updateOne({ templateId: current.templateId }, { $set: data });
  } catch (error) {
    return translateTemplateWriteError(error);
  }
  return get(current.templateId);
};

const submit = async function (templateId, actor) {
  const current = await get(templateId);
  if (current.channel !== "whatsapp") throw validationError("Only WhatsApp templates use a Gupshup template ID");
  if (current.providerPayload?.managedExternally) {
    throw validationError("This template is managed by Gupshup; use Sync from Gupshup instead");
  }
  if (!current.externalTemplateId) throw validationError("Enter the approved Gupshup template ID before activating this template");
  await CommunicationTemplate.updateOne(
    { templateId: current.templateId },
    {
      $set: {
        status: "approved",
        providerPayload: { provider: "gupshup", managedExternally: true, templateId: current.externalTemplateId },
        rejectionReason: "",
        submittedAt: new Date(),
        syncedAt: new Date(),
        updatedBy: actor || "admin",
      },
    },
  );
  return get(current.templateId);
};

function comparableRemote(template) {
  return {
    name: template.name,
    category: template.category,
    language: template.language,
    headerType: template.headerType,
    headerText: template.headerText,
    body: template.body,
    footer: template.footer,
    buttons: template.buttons,
    parameterDefinitions: template.parameterDefinitions,
    status: template.status,
    externalTemplateId: template.externalTemplateId,
    rejectionReason: template.rejectionReason,
    remoteTemplateType: template.remoteTemplateType,
    remoteQuality: template.remoteQuality,
    gupshupAppId: template.gupshupAppId,
  };
}

const sync = async function (actor) {
  const fetched = await gupshupTemplateService.fetchAll();
  const remoteTemplates = Array.isArray(fetched) ? fetched : fetched.templates;
  const normalizationFailures = Array.isArray(fetched?.failures) ? fetched.failures : [];
  const summary = {
    remoteCount: remoteTemplates.length + normalizationFailures.length,
    imported: 0,
    updated: 0,
    unchanged: 0,
    failed: normalizationFailures.length,
    remotelyMissing: 0,
    syncedAt: new Date(),
    failures: [...normalizationFailures],
  };
  for (const remote of remoteTemplates) {
    try {
      const existing = await CommunicationTemplate.findOne({
        $or: [
          { channel: "whatsapp", externalTemplateId: remote.externalTemplateId, language: remote.language },
          { channel: "whatsapp", name: remote.name, language: remote.language },
        ],
      }).lean();
      if (!existing) {
        await CommunicationTemplate.create({
          ...remote,
          isActive: false,
          createdBy: actor || "admin",
          updatedBy: actor || "admin",
        });
        summary.imported += 1;
        continue;
      }
      const unchanged = JSON.stringify(comparableRemote(existing)) === JSON.stringify(comparableRemote(remote));
      if (unchanged) {
        await CommunicationTemplate.updateOne(
          { templateId: existing.templateId },
          { $set: { syncedAt: summary.syncedAt, updatedBy: actor || "admin", providerPayload: remote.providerPayload } },
        );
        summary.unchanged += 1;
        continue;
      }
      await CommunicationTemplate.updateOne(
        { templateId: existing.templateId },
        {
          $set: {
            ...remote,
            displayName: existing.displayName || remote.displayName,
            isActive: existing.isActive !== false,
            updatedBy: actor || "admin",
          },
        },
      );
      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        externalTemplateId: remote.externalTemplateId,
        name: remote.name,
        message: String(error.message || error),
      });
    }
  }

  const configuredAppId = String(process.env.CRM_GUPSHUP_APP_ID || "").trim();
  const observedExternalIds = [...new Set([
    ...remoteTemplates.map((template) => String(template.externalTemplateId || "").trim()),
    ...normalizationFailures.map((failure) => String(failure.externalTemplateId || "").trim()),
  ].filter(Boolean))];
  if (configuredAppId) {
    const missingQuery = {
      channel: "whatsapp",
      gupshupAppId: configuredAppId,
      "providerPayload.managedExternally": true,
      ...(observedExternalIds.length ? { externalTemplateId: { $nin: observedExternalIds } } : {}),
    };
    const missingTemplates = await CommunicationTemplate.find(missingQuery)
      .select({ templateId: 1, providerPayload: 1 })
      .lean();
    for (const missing of missingTemplates) {
      const providerPayload = {
        ...(missing.providerPayload && typeof missing.providerPayload === "object" ? missing.providerPayload : {}),
        provider: "gupshup",
        managedExternally: true,
        synchronized: true,
        remoteMissing: true,
        remoteMissingDetectedAt: summary.syncedAt,
      };
      await CommunicationTemplate.updateOne(
        { templateId: missing.templateId },
        {
          $set: {
            status: "deleted",
            isActive: false,
            syncedAt: summary.syncedAt,
            updatedBy: actor || "admin",
            providerPayload,
          },
        },
      );
      summary.remotelyMissing += 1;
    }
  }
  return summary;
};

const processProviderEvent = async function (event, actor = "gupshup-webhook") {
  const configuredAppName = String(process.env.CRM_GUPSHUP_APP_NAME || "").trim();
  const eventAppName = String(event?.app || "").trim();
  if (configuredAppName && eventAppName && configuredAppName !== eventAppName) {
    return { matched: 0, updated: 0, ignored: true, reason: "gupshup_app_mismatch" };
  }

  const payload = event?.payload || {};
  const externalTemplateId = textValue(payload.id || "", {
    label: "Gupshup template ID",
    required: true,
    maxLength: 500,
  });
  const language = String(payload.languageCode || "").trim().replace(/-/g, "_");
  const query = {
    channel: "whatsapp",
    externalTemplateId,
    ...(language ? { language } : {}),
  };
  const current = await CommunicationTemplate.findOne(query).lean();
  if (!current) {
    return { matched: 0, updated: 0, externalTemplateId, reason: "template_not_synchronized" };
  }

  const providerPayload = {
    ...(current.providerPayload && typeof current.providerPayload === "object" ? current.providerPayload : {}),
    provider: "gupshup",
    managedExternally: true,
    latestEvent: JSON.parse(JSON.stringify(event)),
  };
  const set = {
    syncedAt: new Date(),
    updatedBy: actor,
    providerPayload,
  };
  const type = String(payload.type || "status-update").toLowerCase();
  if (type === "status-update" || payload.status) {
    set.status = gupshupTemplateService.normalizeStatus(payload.status || current.status);
    set.rejectionReason = String(payload.rejectedReason || payload.description || "").slice(0, 3000);
  } else if (type === "category-update") {
    const category = payload.category || {};
    const currentCategory = category.new || category.current;
    if (currentCategory) set.category = gupshupTemplateService.normalizeCategory(currentCategory);
    providerPayload.categoryEvent = JSON.parse(JSON.stringify(category));
    if (!category.new && category.correct) {
      providerPayload.suggestedCategory = gupshupTemplateService.normalizeCategory(category.correct);
    } else if (category.new) {
      delete providerPayload.suggestedCategory;
    }
  } else if (type === "quality-update") {
    set.remoteQuality = String(payload.quality || payload.qualityScore || payload.qualityRating || "").toUpperCase().slice(0, 40);
  }
  const result = await CommunicationTemplate.updateOne({ templateId: current.templateId }, { $set: set });
  return {
    matched: result.matchedCount || 0,
    updated: result.modifiedCount || 0,
    templateId: current.templateId,
    externalTemplateId,
    eventType: type,
  };
};

module.exports = {
  list,
  get,
  create,
  update,
  submit,
  sync,
  processProviderEvent,
  normalizeTemplateInput,
  presentTemplate,
  CHANNELS,
  CATEGORIES,
  STATUSES,
};
