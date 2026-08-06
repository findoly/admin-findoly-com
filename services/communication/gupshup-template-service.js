"use strict";

const { gupshupBaseUrl } = require("./communication-config");
const { validationError } = require("../../utils/validation");
const { enrichParameterDefinitions } = require("../../utils/communication-variables");

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function timeoutSignal(milliseconds) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds).unref();
  return controller.signal;
}

function requireSyncConfig() {
  const config = {
    apiKey: String(process.env.CRM_GUPSHUP_API_KEY || "").trim(),
    appId: String(process.env.CRM_GUPSHUP_APP_ID || "").trim(),
  };
  if (!config.apiKey) throw validationError("Gupshup API key is not configured", 503);
  if (!config.appId) throw validationError("Gupshup app ID is not configured", 503);
  return config;
}

function parseJsonMaybe(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function isTemplateCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(
    value.id
      || value.templateId
      || value.template_id
      || value.elementName
      || value.templateName,
  );
}

function extractTemplates(payload) {
  if (Array.isArray(payload)) return payload.filter(isTemplateCandidate);
  if (!payload || typeof payload !== "object") return [];
  const directKeys = ["templates", "templateList", "items", "results", "content"];
  for (const key of directKeys) {
    if (Array.isArray(payload[key])) return payload[key].filter(isTemplateCandidate);
  }
  if (Array.isArray(payload.data)) return payload.data.filter(isTemplateCandidate);
  if (payload.data && typeof payload.data === "object") {
    const nested = extractTemplates(payload.data);
    if (nested.length) return nested;
  }
  return isTemplateCandidate(payload) ? [payload] : [];
}

function stringValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeStatus(value) {
  const status = stringValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["approved", "rejected", "paused", "disabled", "deleted", "pending", "draft"].includes(status)) {
    return status;
  }
  if (["active", "enabled"].includes(status)) return "approved";
  if (["submitted", "in_review", "pending_approval"].includes(status)) return "pending";
  return "pending";
}

function normalizeCategory(value) {
  const category = stringValue(value).toLowerCase();
  if (["authentication", "utility", "marketing"].includes(category)) return category;
  if (["otp", "auth"].includes(category)) return "authentication";
  return "utility";
}

function normalizeLanguage(value) {
  return stringValue(value, "en_US").replace(/-/g, "_");
}

function humanizeName(value) {
  return stringValue(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeButton(button, index) {
  const source = button && typeof button === "object" ? button : {};
  const type = stringValue(source.type, source.buttonType, source.sub_type).toUpperCase();
  const text = stringValue(source.text, source.title, source.buttonText);
  const url = stringValue(source.url, source.value, source.websiteUrl);
  return {
    ...JSON.parse(JSON.stringify(source)),
    index: Number.isInteger(Number(source.index)) ? Number(source.index) : index,
    type: type || (url ? "URL" : "QUICK_REPLY"),
    text,
    ...(url ? { url } : {}),
  };
}

function componentValue(components, type) {
  return components.find((component) => String(component?.type || "").toUpperCase() === type) || null;
}

function normalizeButtons(source, components) {
  const buttonsComponent = componentValue(components, "BUTTONS");
  let sourceButtons = source.buttons;
  if (typeof sourceButtons === "string") {
    try { sourceButtons = JSON.parse(sourceButtons); } catch (_error) { sourceButtons = []; }
  }
  const list = Array.isArray(sourceButtons)
    ? sourceButtons
    : Array.isArray(buttonsComponent?.buttons)
      ? buttonsComponent.buttons
      : [];
  return list.slice(0, 10).map(normalizeButton);
}

function placeholderMatches(value) {
  return Array.from(String(value || "").matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g), (match) => match[1]);
}

function parameterDefinitions({ headerText = "", body = "", footer = "", buttons = [], sampleVariables = [] } = {}) {
  const definitions = [];
  const add = (component, text, extra = {}) => {
    placeholderMatches(text).forEach((key) => {
      definitions.push({
        position: definitions.length + 1,
        component,
        placeholder: key,
        label: `${extra.label || humanizeName(component)} {{${key}}}`,
        ...extra,
      });
    });
  };
  add("header", headerText);
  add("body", body);
  add("footer", footer);
  buttons.forEach((button, index) => {
    if (String(button?.type || "").toUpperCase().includes("URL")) {
      add("button", button.url || button.value || "", {
        buttonIndex: Number.isInteger(Number(button.index)) ? Number(button.index) : index,
        label: `${button.text || `Button ${index + 1}`} URL`,
      });
    }
  });
  return enrichParameterDefinitions(definitions, sampleVariables);
}

function flattenExampleValues(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    if (value.length === 1 && Array.isArray(value[0])) return flattenExampleValues(value[0]);
    return value.flatMap(flattenExampleValues);
  }
  if (typeof value === "object") return [];
  const text = String(value).trim();
  return text ? [text] : [];
}

function extractSampleVariables(source, components = []) {
  const direct = [source?.sampleVariables, source?.sampleValues, source?.exampleValues]
    .find((value) => Array.isArray(value) && value.length);
  if (direct) return flattenExampleValues(direct).slice(0, 50);

  const examples = parseJsonMaybe(source?.example);
  const values = [
    ...flattenExampleValues(examples.header_text),
    ...flattenExampleValues(examples.body_text),
    ...flattenExampleValues(examples.footer_text),
    ...flattenExampleValues(examples.button_url),
  ];
  if (values.length) return values.slice(0, 50);

  components.forEach((component) => {
    const example = parseJsonMaybe(component?.example);
    values.push(
      ...flattenExampleValues(example.header_text),
      ...flattenExampleValues(example.body_text),
      ...flattenExampleValues(example.footer_text),
      ...flattenExampleValues(example.button_url),
    );
    if (String(component?.type || "").toUpperCase() === "BUTTONS") {
      (Array.isArray(component.buttons) ? component.buttons : []).forEach((button) => {
        values.push(...flattenExampleValues(button?.example));
      });
    }
  });
  return values.slice(0, 50);
}

function normalizeRemoteTemplate(item, appId = "") {
  const data = parseJsonMaybe(item?.data);
  const rawDataText = typeof item?.data === "string" && !Object.keys(data).length ? item.data : "";
  const containerMeta = parseJsonMaybe(item?.containerMeta);
  const merged = { ...item, ...containerMeta, ...data };
  const components = Array.isArray(merged.components)
    ? merged.components
    : Array.isArray(containerMeta.components)
      ? containerMeta.components
      : [];
  const header = componentValue(components, "HEADER");
  const bodyComponent = componentValue(components, "BODY");
  const footerComponent = componentValue(components, "FOOTER");
  const headerType = stringValue(
    merged.headerType,
    header?.format,
    header?.type === "HEADER" ? "text" : "none",
  ).toLowerCase();
  const headerText = stringValue(
    merged.headerText,
    typeof merged.header === "string" ? merged.header : "",
    header?.text,
  );
  const body = stringValue(
    merged.body,
    merged.content,
    merged.templateBody,
    typeof merged.data === "string" ? merged.data : "",
    bodyComponent?.text,
    rawDataText,
  );
  const footer = stringValue(
    typeof merged.footer === "string" ? merged.footer : "",
    footerComponent?.text,
  );
  const buttons = normalizeButtons(merged, components);
  const sampleVariables = extractSampleVariables(merged, components);
  const name = stringValue(merged.elementName, merged.name, merged.templateName).toLowerCase();
  const externalTemplateId = stringValue(merged.id, merged.templateId, merged.template_id);
  if (!name || !externalTemplateId || !body) {
    throw validationError("Gupshup template response is missing its name, ID or body", 502);
  }
  const categorySource = typeof merged.category === "object"
    ? merged.category.current || merged.category.new || merged.category.correct
    : stringValue(merged.category, merged.new_category, merged.current_category, merged.correct_category);
  const normalized = {
    name,
    displayName: humanizeName(name),
    channel: "whatsapp",
    category: normalizeCategory(stringValue(categorySource, merged.templateCategory)),
    language: normalizeLanguage(stringValue(merged.languageCode, merged.language, merged.language_code)),
    subject: "",
    headerType: ["text", "image", "video", "document"].includes(headerType) ? headerType : "none",
    headerText,
    body,
    bodyHtml: "",
    footer,
    buttons,
    parameterDefinitions: parameterDefinitions({ headerText, body, footer, buttons, sampleVariables }),
    sampleVariables,
    status: normalizeStatus(stringValue(merged.status, merged.templateStatus)),
    externalTemplateId,
    rejectionReason: stringValue(merged.rejectedReason, merged.rejectionReason, merged.reason),
    remoteTemplateType: stringValue(merged.templateType, merged.template_type, merged.type).toLowerCase(),
    remoteQuality: stringValue(merged.quality, merged.qualityScore, merged.qualityRating).toUpperCase(),
    gupshupAppId: stringValue(merged.appId, merged.app_id, appId),
    providerPayload: {
      provider: "gupshup",
      managedExternally: true,
      synchronized: true,
      raw: JSON.parse(JSON.stringify(item)),
    },
    syncedAt: new Date(),
  };
  return normalized;
}

async function requestJson(url) {
  const config = requireSyncConfig();
  const response = await fetch(url, {
    method: "GET",
    headers: { apikey: config.apiKey, Accept: "application/json" },
    signal: timeoutSignal(Number(process.env.COMMUNICATION_HTTP_TIMEOUT_MS || 15000)),
  });
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    payload = { raw };
  }
  if (!response.ok || String(payload?.status || "").toLowerCase() === "error") {
    const message = payload?.message || payload?.error || `Gupshup template API failed with status ${response.status}`;
    throw Object.assign(new Error(String(message)), {
      status: response.status >= 400 && response.status < 500 ? 400 : 502,
      providerResponse: payload,
    });
  }
  return { payload, appId: config.appId };
}

async function fetchById(templateId) {
  const config = requireSyncConfig();
  const id = stringValue(templateId);
  if (!id) throw validationError("Gupshup template ID is required");
  const url = new URL(`${gupshupBaseUrl()}/wa/app/${encodeURIComponent(config.appId)}/template/${encodeURIComponent(id)}`);
  const result = await requestJson(url);
  const candidates = extractTemplates(result.payload);
  const template = candidates[0]
    || (result.payload?.template && typeof result.payload.template === "object" ? result.payload.template : null)
    || (result.payload?.data && typeof result.payload.data === "object" && !Array.isArray(result.payload.data) ? result.payload.data : null);
  if (!template) throw Object.assign(new Error("Gupshup template detail response did not contain a template"), { status: 502 });
  return { template, appId: result.appId };
}

async function fetchPage(pageNo, pageSize = PAGE_SIZE) {
  const config = requireSyncConfig();
  const url = new URL(`${gupshupBaseUrl()}/wa/app/${encodeURIComponent(config.appId)}/template`);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("pageSize", String(pageSize));
  const result = await requestJson(url);
  return { payload: result.payload, templates: extractTemplates(result.payload), appId: result.appId };
}

async function fetchAll() {
  const output = [];
  const failures = [];
  const seen = new Set();
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo += 1) {
    const page = await fetchPage(pageNo, PAGE_SIZE);
    let addedThisPage = 0;
    for (const item of page.templates) {
      const templateId = stringValue(item?.id, item?.templateId, item?.template_id);
      try {
        let normalized;
        try {
          normalized = normalizeRemoteTemplate(item, page.appId);
        } catch (error) {
          if (!templateId || !/missing its name, ID or body/i.test(String(error.message || error))) throw error;
          const detail = await fetchById(templateId);
          normalized = normalizeRemoteTemplate({ ...item, ...detail.template }, detail.appId);
        }
        const key = `${normalized.externalTemplateId}:${normalized.language}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
        addedThisPage += 1;
      } catch (error) {
        failures.push({
          externalTemplateId: templateId,
          name: stringValue(item?.elementName, item?.name, item?.templateName),
          message: String(error.message || error),
        });
      }
    }
    if (page.templates.length < PAGE_SIZE || (pageNo > 0 && addedThisPage === 0)) break;
  }
  return { templates: output, failures };
}

module.exports = {
  PAGE_SIZE,
  MAX_PAGES,
  requireSyncConfig,
  extractTemplates,
  normalizeRemoteTemplate,
  normalizeStatus,
  normalizeCategory,
  parameterDefinitions,
  extractSampleVariables,
  fetchById,
  fetchPage,
  fetchAll,
};
