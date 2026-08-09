"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const gupshup = require("../services/communication/gupshup-template-service");

function loadWithStubs(relativePath, stubs) {
  const absolute = require.resolve(path.join(root, relativePath));
  delete require.cache[absolute];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolute);
  } finally {
    Module._load = originalLoad;
    delete require.cache[absolute];
  }
}

test("normalizes a Gupshup template with body and dynamic URL parameters", () => {
  const template = gupshup.normalizeRemoteTemplate({
    id: "836bbf22-3a63-4340-a98d-2fffdc7f3b32",
    appId: "app-1",
    elementName: "findoly_provider_lead_alert",
    languageCode: "en_US",
    status: "APPROVED",
    category: "MARKETING",
    templateType: "TEXT",
    data: JSON.stringify({
      body: "Hello {{1}}\nService: {{2}}\nLocation: {{3}}\nRequirement: {{4}}",
      buttons: [
        { type: "QUICK_REPLY", text: "Unlock Lead" },
        { type: "URL", text: "View Lead", url: "https://provider.findoly.com/lead/{{1}}" },
      ],
    }),
  }, "app-1");

  assert.equal(template.status, "approved");
  assert.equal(template.category, "marketing");
  assert.equal(template.externalTemplateId, "836bbf22-3a63-4340-a98d-2fffdc7f3b32");
  assert.equal(template.parameterDefinitions.length, 5);
  assert.equal(template.parameterDefinitions[4].component, "button");
  assert.equal(template.parameterDefinitions[4].buttonIndex, 1);
  assert.equal(template.providerPayload.managedExternally, true);
});


test("normalizes Gupshup containerMeta data and button definitions", () => {
  const template = gupshup.normalizeRemoteTemplate({
    id: "remote-container-meta-1",
    elementName: "findoly_container_meta",
    languageCode: "en_US",
    status: "APPROVED",
    category: "UTILITY",
    containerMeta: JSON.stringify({
      appId: "app-1",
      data: "Hello {{1}}, your enquiry {{2}} is ready.",
      footer: "Team Findoly",
      buttons: [
        { type: "QUICK_REPLY", text: "Unlock Lead" },
        { type: "URL", text: "View Lead", url: "https://provider.findoly.com/lead/{{1}}" },
      ],
    }),
  }, "app-1");

  assert.equal(template.body, "Hello {{1}}, your enquiry {{2}} is ready.");
  assert.equal(template.buttons.length, 2);
  assert.equal(template.parameterDefinitions.length, 3);
  assert.equal(template.parameterDefinitions[2].component, "button");
});

test("extracts templates from supported paginated response containers", () => {
  const item = { id: "template-1", elementName: "template_one", body: "Hello" };
  assert.deepEqual(gupshup.extractTemplates({ templates: [item] }), [item]);
  assert.deepEqual(gupshup.extractTemplates({ data: { templates: [item] } }), [item]);
});

test("CRM stores template assignment and mappings instead of nearby template env overrides", () => {
  const notification = source("services/communication/notification-service.js");
  const rule = source("models/CommunicationRule.js");
  const runtime = source("utils/runtime-config.js");
  assert.match(rule, /whatsappParameterMappings/);
  assert.match(rule, /whatsappActionButtonIndex/);
  assert.match(notification, /rule\.whatsappParameterMappings/);
  assert.doesNotMatch(notification, /CRM_GUPSHUP_NEARBY_LEAD_TEMPLATE_ID/);
  assert.doesNotMatch(runtime, /CRM_GUPSHUP_NEARBY_LEAD_TEMPLATE_ID/);
  assert.match(runtime, /CRM_GUPSHUP_APP_ID/);
});

test("Communication Center exposes Gupshup synchronization and rule mapping controls", () => {
  const templates = source("views/communication/templates.ejs");
  const rules = source("views/communication/rules.ejs");
  assert.match(templates, /Sync from Gupshup/);
  assert.match(templates, /Newly imported templates stay disabled/);
  assert.match(rules, /Template parameters/);
  assert.match(rules, /Unlock Lead quick-reply button/);
});

test("Gupshup template events are handled by the CRM webhook", () => {
  const webhook = source("services/communication/webhook-service.js");
  assert.match(webhook, /event\.type === "template-event"/);
  assert.match(webhook, /templateService\.processProviderEvent/);
});

test("normalizes template status and category webhook values safely", () => {
  assert.equal(gupshup.normalizeStatus("PENDING_APPROVAL"), "pending");
  assert.equal(gupshup.normalizeStatus("DELETED"), "deleted");
  assert.equal(gupshup.normalizeStatus("UNKNOWN_REMOTE_STATE"), "pending");
  assert.equal(gupshup.normalizeCategory("AUTHENTICATION"), "authentication");
  assert.equal(gupshup.normalizeCategory("unexpected"), "utility");
});

test("template synchronization can fetch detail for list results without content", () => {
  const syncSource = source("services/communication/gupshup-template-service.js");
  assert.match(syncSource, /fetchById/);
  assert.match(syncSource, /missing its name, ID or body/);
  assert.match(syncSource, /\/template\/\$\{encodeURIComponent\(id\)\}/);
});

test("rule assignment blocks unsupported WhatsApp media-header templates", () => {
  const ruleSource = source("services/communication/rule-service.js");
  assert.match(ruleSource, /media-header template/);
  assert.match(ruleSource, /\["image", "video", "document"\]/);
});

test("template webhook updates are scoped to the configured Gupshup app", () => {
  const templateSource = source("services/communication/template-service.js");
  assert.match(templateSource, /CRM_GUPSHUP_APP_NAME/);
  assert.match(templateSource, /gupshup_app_mismatch/);
});

test("sync imports new Gupshup templates disabled until an admin enables them", async () => {
  const created = [];
  const templateService = loadWithStubs("services/communication/template-service.js", {
    "../../models/CommunicationTemplate": {
      findOne() { return { async lean() { return null; } }; },
      find() { return { select() { return { async lean() { return []; } }; } }; },
      async create(input) { created.push(input); return input; },
    },
    "../../models/CommunicationRule": {},
    "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, async cursorPaginate() { return { data: [], pagination: {} }; } },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
    "./gupshup-template-service": {
      async fetchAll() {
        return {
          templates: [{
            name: "findoly_provider_lead_alert",
            displayName: "Findoly Provider Lead Alert",
            channel: "whatsapp",
            category: "marketing",
            language: "en_US",
            headerType: "none",
            headerText: "",
            body: "Hello {{1}}",
            footer: "",
            buttons: [],
            parameterDefinitions: [{ position: 1, component: "body", placeholder: "1" }],
            status: "approved",
            externalTemplateId: "remote-template-1",
            rejectionReason: "",
            remoteTemplateType: "text",
            remoteQuality: "GREEN",
            gupshupAppId: "app-1",
            providerPayload: { provider: "gupshup", managedExternally: true },
            syncedAt: new Date("2026-08-05T00:00:00Z"),
          }],
          failures: [],
        };
      },
    },
  });
  const result = await templateService.sync("admin@example.com");
  assert.equal(result.imported, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].isActive, false);
  assert.equal(created[0].createdBy, "admin@example.com");
});

test("nearby lead rule accepts a synced template and stores mappings plus selected quick reply", async () => {
  const template = {
    templateId: "crm-template-1",
    channel: "whatsapp",
    status: "approved",
    isActive: true,
    externalTemplateId: "remote-template-1",
    headerType: "none",
    parameterDefinitions: [
      { position: 1, component: "body", placeholder: "1" },
      { position: 2, component: "body", placeholder: "2" },
      { position: 3, component: "body", placeholder: "3" },
      { position: 4, component: "body", placeholder: "4" },
      { position: 5, component: "button", placeholder: "1", buttonIndex: 1 },
    ],
    buttons: [
      { index: 0, type: "QUICK_REPLY", text: "Unlock Lead" },
      { index: 1, type: "URL", text: "View Lead", url: "https://provider.findoly.com/lead/{{1}}" },
    ],
  };
  const ruleService = loadWithStubs("services/communication/rule-service.js", {
    "../../models/CommunicationRule": {},
    "../../models/CommunicationTemplate": {
      findOne() { return { async lean() { return template; } }; },
    },
    "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, async cursorPaginate() { return { data: [], pagination: {} }; } },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
  });
  const normalized = await ruleService.normalizeInput({
    name: "Nearby provider lead alert",
    event: "nearby_lead_available",
    enabled: true,
    whatsappEnabled: true,
    whatsappTemplateId: "crm-template-1",
    whatsappParameterMappings: [
      "provider_name",
      "service_name",
      "lead_location",
      "requirement_title",
      "lead_url",
    ],
    whatsappActionType: "unlock_lead",
    whatsappActionButtonIndex: 0,
    recipientSource: "provider",
  }, {});
  assert.deepEqual(normalized.whatsappParameterMappings, [
    "provider_name",
    "service_name",
    "lead_location",
    "requirement_title",
    "lead_url",
  ]);
  assert.equal(normalized.whatsappActionType, "unlock_lead");
  assert.equal(normalized.whatsappActionButtonIndex, 0);
  assert.equal(normalized.emailEnabled, false);
});


test("full synchronization disables provider-managed templates missing from Gupshup", async () => {
  const updates = [];
  const previousAppId = process.env.CRM_GUPSHUP_APP_ID;
  process.env.CRM_GUPSHUP_APP_ID = "app-1";
  try {
    const templateService = loadWithStubs("services/communication/template-service.js", {
      "../../models/CommunicationTemplate": {
        findOne() { return { async lean() { return null; } }; },
        find(query) {
          assert.equal(query.gupshupAppId, "app-1");
          return { select() { return { async lean() { return [{ templateId: "crm-missing-1", providerPayload: { managedExternally: true } }]; } }; } };
        },
        async updateOne(query, operation) { updates.push({ query, operation }); return { matchedCount: 1, modifiedCount: 1 }; },
      },
      "../../models/CommunicationRule": {},
      "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, async cursorPaginate() { return { data: [], pagination: {} }; } },
      "../../utils/search-query": { buildSearchAlternatives() { return []; } },
      "./gupshup-template-service": { async fetchAll() { return { templates: [], failures: [] }; } },
    });
    const result = await templateService.sync("admin@example.com");
    assert.equal(result.remotelyMissing, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].operation.$set.status, "deleted");
    assert.equal(updates[0].operation.$set.isActive, false);
    assert.equal(updates[0].operation.$set.providerPayload.remoteMissing, true);
  } finally {
    if (previousAppId === undefined) delete process.env.CRM_GUPSHUP_APP_ID; else process.env.CRM_GUPSHUP_APP_ID = previousAppId;
  }
});

test("category correction alerts do not prematurely overwrite the current Gupshup category", async () => {
  let update = null;
  const current = {
    templateId: "crm-template-1",
    name: "findoly_provider_lead_alert",
    channel: "whatsapp",
    category: "marketing",
    language: "en_US",
    status: "approved",
    externalTemplateId: "remote-template-1",
    providerPayload: { provider: "gupshup", managedExternally: true },
  };
  const previousApp = process.env.CRM_GUPSHUP_APP_NAME;
  process.env.CRM_GUPSHUP_APP_NAME = "FindolyWhatsapp";
  try {
    const templateService = loadWithStubs("services/communication/template-service.js", {
      "../../models/CommunicationTemplate": {
        findOne() { return { async lean() { return current; } }; },
        async updateOne(_query, operation) { update = operation.$set; return { matchedCount: 1, modifiedCount: 1 }; },
      },
      "../../models/CommunicationRule": {},
      "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, async cursorPaginate() { return { data: [], pagination: {} }; } },
      "../../utils/search-query": { buildSearchAlternatives() { return []; } },
      "./gupshup-template-service": gupshup,
    });
    await templateService.processProviderEvent({
      app: "FindolyWhatsapp",
      type: "template-event",
      payload: {
        type: "category-update",
        id: "remote-template-1",
        languageCode: "en_US",
        category: { current: "MARKETING", correct: "UTILITY" },
      },
    });
    assert.equal(update.category, "marketing");
    assert.equal(update.providerPayload.suggestedCategory, "utility");
  } finally {
    if (previousApp === undefined) delete process.env.CRM_GUPSHUP_APP_NAME;
    else process.env.CRM_GUPSHUP_APP_NAME = previousApp;
  }
});

test("Gupshup sync uses the app template API and fetches missing template details", { concurrency: false }, async () => {
  const previous = {
    apiKey: process.env.CRM_GUPSHUP_API_KEY,
    appId: process.env.CRM_GUPSHUP_APP_ID,
    baseUrl: process.env.CRM_GUPSHUP_API_BASE_URL,
  };
  const originalFetch = global.fetch;
  const calls = [];
  process.env.CRM_GUPSHUP_API_KEY = "api-key-test";
  process.env.CRM_GUPSHUP_APP_ID = "app-id-test";
  process.env.CRM_GUPSHUP_API_BASE_URL = "https://api.gupshup.io";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const isDetail = String(url).endsWith("/template/template-detail-1");
    const payload = isDetail
      ? {
        id: "template-detail-1",
        elementName: "findoly_detail_template",
        languageCode: "en_US",
        status: "APPROVED",
        category: "UTILITY",
        body: "Hello {{1}}",
      }
      : {
        templates: [{
          id: "template-detail-1",
          elementName: "findoly_detail_template",
          languageCode: "en_US",
          status: "APPROVED",
          category: "UTILITY",
        }],
      };
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(payload); },
    };
  };
  try {
    const result = await gupshup.fetchAll();
    assert.equal(result.templates.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(result.templates[0].body, "Hello {{1}}");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/wa\/app\/app-id-test\/template\?pageNo=0&pageSize=100$/);
    assert.match(calls[1].url, /\/wa\/app\/app-id-test\/template\/template-detail-1$/);
    assert.equal(calls[0].options.headers.apikey, "api-key-test");
  } finally {
    global.fetch = originalFetch;
    if (previous.apiKey === undefined) delete process.env.CRM_GUPSHUP_API_KEY; else process.env.CRM_GUPSHUP_API_KEY = previous.apiKey;
    if (previous.appId === undefined) delete process.env.CRM_GUPSHUP_APP_ID; else process.env.CRM_GUPSHUP_APP_ID = previous.appId;
    if (previous.baseUrl === undefined) delete process.env.CRM_GUPSHUP_API_BASE_URL; else process.env.CRM_GUPSHUP_API_BASE_URL = previous.baseUrl;
  }
});
