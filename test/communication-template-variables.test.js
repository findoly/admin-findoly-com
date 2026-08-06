"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const variables = require("../utils/communication-variables");
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

function templateServiceForUnitTest() {
  return loadWithStubs("services/communication/template-service.js", {
    "../../models/CommunicationTemplate": {},
    "../../models/CommunicationRule": {},
    "./gupshup-template-service": gupshup,
    "../../utils/pagination": { getPagination() { return { limit: 20, cursor: "" }; }, async cursorPaginate() { return { data: [], pagination: {} }; } },
    "../../utils/search-query": { buildSearchAlternatives() { return []; } },
  });
}

test("email variables are detected once in first-occurrence order", () => {
  const definitions = variables.detectEmailVariables({
    subject: "Lead {{lead_id}} received for {{provider_name}}",
    body: "Hello {{provider_name}}, customer {{customer_name}} created {{lead_id}}.",
    bodyHtml: "<strong>{{customer_name}}</strong><span>{{service_type}}</span>",
    footer: "Reference {{lead_id}}",
  });

  assert.deepEqual(definitions.map((item) => item.placeholder), [
    "lead_id",
    "provider_name",
    "customer_name",
    "service_type",
  ]);
  assert.deepEqual(definitions.map((item) => item.component), [
    "subject",
    "subject",
    "body",
    "body_html",
  ]);
  assert.equal(definitions[0].label, "Lead ID");
  assert.match(definitions[0].description, /Unique CRM enquiry/i);
});

test("WhatsApp parameters preserve component and delivery order including dynamic URL", () => {
  const definitions = variables.detectWhatsappVariables({
    channel: "whatsapp",
    headerText: "Enquiry {{1}}",
    body: "Hello {{2}}. Service {{3}}.",
    footer: "Reference {{4}}",
    buttons: [{ index: 1, type: "URL", text: "View Lead", url: "https://provider.findoly.com/lead/{{1}}" }],
    sampleVariables: ["FND-100", "Dhiraj", "Painter", "REF-1", "FND-100"],
  });

  assert.deepEqual(definitions.map((item) => item.component), ["header", "body", "body", "footer", "button"]);
  assert.equal(definitions[4].buttonIndex, 1);
  assert.equal(definitions[4].label, "View Lead URL");
  assert.equal(definitions[4].example, "FND-100");
});

test("known event variables expose labels, descriptions and examples", () => {
  const metadata = variables.metadataForKeys(["provider_name", "lead_location", "lead_url_suffix"]);
  assert.equal(metadata.length, 3);
  assert.equal(metadata[0].label, "Provider name");
  assert.match(metadata[1].description, /city, state and PIN/i);
  assert.equal(metadata[2].example, "FND-ENQ-10245");
});

test("Gupshup examples enrich synchronized parameter definitions", () => {
  const template = gupshup.normalizeRemoteTemplate({
    id: "template-example-1",
    elementName: "findoly_variable_example",
    languageCode: "en_US",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hello {{1}}, enquiry {{2}} is ready.",
        example: { body_text: [["Dhiraj", "FND-1024"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "View Enquiry", url: "https://provider.findoly.com/lead/{{1}}", example: ["FND-1024"] }],
      },
    ],
  }, "app-1");

  assert.deepEqual(template.sampleVariables, ["Dhiraj", "FND-1024", "FND-1024"]);
  assert.deepEqual(template.parameterDefinitions.map((item) => item.example), ["Dhiraj", "FND-1024", "FND-1024"]);
});

test("Communication Center displays template requirements and event-provided values", () => {
  const templatesView = source("views/communication/templates.ejs");
  const templateView = source("views/communication/template-form.ejs");
  const rulesView = source("views/communication/rules.ejs");
  const controller = source("controllers/communicationController.js");

  assert.match(templatesView, /<th>Variables<\/th>/);
  assert.match(templatesView, /crm-template-variable-preview/);
  assert.match(templateView, /Template variables/);
  assert.match(templateView, /Dynamic values detected in this template/);
  assert.match(rulesView, /Event provides/);
  assert.match(rulesView, /Template requires/);
  assert.match(rulesView, /Mapping incomplete/);
  assert.match(controller, /eventVariableMetadata/);
});

test("existing mappings are preserved and newly added template parameters remain visibly unmapped", () => {
  const rulesView = source("views/communication/rules.ejs");
  assert.match(rulesView, /preserveExisting = preserve && existing\.length > 0/);
  assert.match(rulesView, /preserveExisting \? \(existing\[index\] \|\| ''\)/);
  assert.match(rulesView, /missingWhatsappMappings/);
});


test("email template writes persist detected variable metadata", () => {
  const service = templateServiceForUnitTest();
  const normalized = service.normalizeTemplateInput({
    channel: "email",
    name: "partner_lead_email",
    displayName: "Partner lead email",
    category: "transactional",
    language: "en_US",
    subject: "Lead {{lead_id}} received",
    body: "Hello {{provider_name}}, review {{lead_id}}.",
    bodyHtml: "<p>{{provider_name}}</p>",
    footer: "",
    isActive: true,
  }, {});
  assert.deepEqual(normalized.parameterDefinitions.map((item) => item.placeholder), ["lead_id", "provider_name"]);
  assert.equal(normalized.parameterDefinitions[0].component, "subject");
});

test("approved WhatsApp updates preserve stored provider structure", () => {
  const service = templateServiceForUnitTest();
  const current = {
    templateId: "crm-template-1",
    channel: "whatsapp",
    name: "approved_template",
    displayName: "Approved template",
    category: "utility",
    language: "en_US",
    subject: "",
    headerType: "none",
    headerText: "",
    body: "Hello {{1}}",
    bodyHtml: "",
    footer: "",
    buttons: [],
    sampleVariables: [],
    parameterDefinitions: [],
    otpExpiryMinutes: 5,
    isActive: true,
    externalTemplateId: "remote-1",
    status: "approved",
  };
  const normalized = service.normalizeTemplateInput({ ...current, displayName: "Updated display name" }, current);
  assert.deepEqual(normalized.parameterDefinitions, []);
  assert.equal(normalized.displayName, "Updated display name");
});
