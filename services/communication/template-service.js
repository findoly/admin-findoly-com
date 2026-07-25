const CommunicationTemplate = require("../../models/CommunicationTemplate");
const whatsappService = require("./whatsapp-service");
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
    } catch (error) {
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
  };
  if (channel === "email" && !data.bodyHtml) data.bodyHtml = body;
  if (channel === "whatsapp" && data.headerType !== "text") data.headerText = "";
  return data;
};

const list = async function (filters) {
  const query = {};
  if (filters?.channel) query.channel = enumValue(filters.channel, CHANNELS, { label: "Template channel filter" });
  if (filters?.status) query.status = enumValue(filters.status, STATUSES, { label: "Template status filter" });
  if (filters?.active !== undefined && filters.active !== "") {
    query.isActive = booleanValue(filters.active, { label: "Template active filter" });
  }
  if (filters?.q) {
    const q = textValue(filters.q, { label: "Template search", maxLength: 100 });
    const search = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: search }, { displayName: search }, { body: search }, { subject: search }];
  }
  const limit = numberValue(filters?.limit, { label: "Template list limit", fallback: 100, min: 1, max: 500, integer: true });
  return CommunicationTemplate.find(query).sort({ updatedAt: -1, _id: -1 }).limit(limit).lean();
};

const get = async function (templateId) {
  const id = identifierValue(templateId, { label: "Template ID" });
  const template = await CommunicationTemplate.findOne({ templateId: id }).lean();
  if (!template) throw Object.assign(new Error("Communication template not found"), { status: 404 });
  return template;
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
  if (current.channel === "whatsapp" && current.status === "approved") {
    const editableFields = ["displayName", "isActive"];
    const changedProviderField = Object.keys(data).some(function (key) {
      return !editableFields.includes(key) && JSON.stringify(data[key]) !== JSON.stringify(current[key]);
    });
    if (changedProviderField) {
      throw validationError("Approved WhatsApp template content cannot be edited; create a new template version");
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
  if (current.channel !== "whatsapp") throw validationError("Only WhatsApp templates are submitted to Meta");
  if (!["draft", "rejected"].includes(current.status)) {
    throw validationError("Only draft or rejected WhatsApp templates can be submitted");
  }
  const response = await whatsappService.submitTemplate(current);
  await CommunicationTemplate.updateOne(
    { templateId: current.templateId },
    {
      $set: {
        externalTemplateId: response.id || current.externalTemplateId || "",
        status: String(response.status || "pending").toLowerCase(),
        providerPayload: response,
        rejectionReason: "",
        submittedAt: new Date(),
        syncedAt: new Date(),
        updatedBy: actor || "admin",
      },
    },
  );
  return get(current.templateId);
};

const providerStatus = function (value) {
  const status = String(value || "pending").toLowerCase();
  if (["approved", "rejected", "paused", "disabled", "pending"].includes(status)) return status;
  return "pending";
};

const remoteComponent = function (remote, type) {
  return (remote.components || []).find(function (component) {
    return String(component.type || "").toUpperCase() === type;
  }) || {};
};

const sync = async function (actor) {
  const remoteTemplates = await whatsappService.listTemplates();
  let updated = 0;
  let imported = 0;
  for (const remote of remoteTemplates) {
    const bodyComponent = remoteComponent(remote, "BODY");
    const headerComponent = remoteComponent(remote, "HEADER");
    const footerComponent = remoteComponent(remote, "FOOTER");
    const buttonsComponent = remoteComponent(remote, "BUTTONS");
    const query = {
      channel: "whatsapp",
      name: String(remote.name || "").toLowerCase(),
      language: remote.language || "en_US",
    };
    const result = await CommunicationTemplate.updateOne(
      query,
      {
        $set: {
          externalTemplateId: remote.id || "",
          category: String(remote.category || "utility").toLowerCase(),
          status: providerStatus(remote.status),
          rejectionReason: remote.rejected_reason || remote.rejection_reason || "",
          providerPayload: remote,
          syncedAt: new Date(),
          updatedBy: actor || "system",
        },
        $setOnInsert: {
          displayName: remote.name || "WhatsApp template",
          headerType: headerComponent.text ? "text" : "none",
          headerText: headerComponent.text || "",
          body: bodyComponent.text || (String(remote.category || "").toLowerCase() === "authentication" ? "Authentication code" : "Imported WhatsApp template"),
          footer: footerComponent.text || "",
          buttons: buttonsComponent.buttons || [],
          sampleVariables: [],
          otpExpiryMinutes: Number(footerComponent.code_expiration_minutes || 5),
          isActive: true,
          createdBy: actor || "system",
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) imported += result.upsertedCount;
    else updated += result.matchedCount || 0;
  }
  return { remoteCount: remoteTemplates.length, updated, imported };
};

module.exports = {
  list,
  get,
  create,
  update,
  submit,
  sync,
  normalizeTemplateInput,
  CHANNELS,
  CATEGORIES,
  STATUSES,
};
