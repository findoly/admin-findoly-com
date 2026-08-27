"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const requirementAi = require("../services/requirement-ai/requirement-ai-service");

function words(count) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");
}

test("requirement AI accepts ready structured output within provider word limits", () => {
  const result = requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: "Two CCTV cameras not working; inspection and possible replacement required",
    providerDetails: "Customer has two CCTV cameras that are not displaying video and requires inspection. Repair is preferred, but replacement cameras may be purchased if the existing units cannot be repaired.",
  });
  assert.equal(result.status, "ready");
  assert.ok(requirementAi.wordCount(result.providerTitle) <= 20);
  assert.ok(requirementAi.wordCount(result.providerDetails) <= 100);
});

test("requirement AI clarification output contains no provider wording", () => {
  const result = requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "clarify",
    clarificationReason: "missing_core_requirement",
    clarificationMessage: "Please mention what product or service the customer needs.",
    providerTitle: null,
    providerDetails: null,
  });
  assert.equal(result.status, "clarify");
  assert.equal(result.providerTitle, null);
  assert.equal(result.providerDetails, null);
});

test("saved clarification response preserves null provider fields", () => {
  const result = requirementAi.presentRequirement({
    customerRequirementRaw: "Need help",
    requirementAiStatus: "clarify",
    requirementAiClarificationReason: "missing_core_requirement",
    requirementAiClarificationMessage: "Please clarify what product or service the customer needs.",
    requirementAiProviderTitle: "",
    requirementAiProviderDetails: "",
  });
  assert.equal(result.status, "clarify");
  assert.equal(result.providerTitle, null);
  assert.equal(result.providerDetails, null);
});

test("requirement AI rejects provider wording over the approved limits", () => {
  assert.throws(() => requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: words(21),
    providerDetails: "Customer requires a provider.",
  }), /20 words or less/);

  assert.throws(() => requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: "Customer requires a provider",
    providerDetails: words(101),
  }), /100 words or less/);
});

test("requirement AI rejects mobile numbers and email addresses from provider wording", () => {
  assert.throws(() => requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: "Call customer on 9876543210 for CCTV repair",
    providerDetails: "Customer needs CCTV repair.",
  }), /mobile number or email address/);

  assert.throws(() => requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: "CCTV repair required",
    providerDetails: "Customer needs CCTV repair. Email customer@example.com for details.",
  }), /mobile number or email address/);
});

test("requirement AI rejects budget information from provider wording", () => {
  assert.throws(() => requirementAi.validateAiResult({
    schemaVersion: 1,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    providerTitle: "CCTV repair required with ₹5,000 budget",
    providerDetails: "Customer needs CCTV repair and has an expected budget of ₹5,000.",
  }), /budget or expected-spend information/);
});

test("requirement AI source context excludes expected spend from provider wording input", () => {
  const payload = requirementAi.sourcePayload({
    category: "CCTV",
    serviceTypes: [{ name: "CCTV Repair" }],
    leadValidationDecision: {
      answers: [{ questionId: "requirement_confirmed", question: "Confirmed?", answer: "Yes" }],
    },
    leadQualification: {
      answers: [
        { questionId: "timeline", question: "Timeline?", answer: "Within 3 days" },
        { questionId: "expected_spend", question: "Expected spend?", answer: "Above ₹10,000" },
      ],
    },
  }, "Two cameras are not working");
  assert.deepEqual(payload.qualification, [{ question: "Timeline?", answer: "Within 3 days" }]);
});

test("requirement AI prompt is explicitly a low-level clarity gate", () => {
  const prompt = requirementAi.instructions();
  assert.match(prompt, /LOW-LEVEL clarity check/);
  assert.match(prompt, /Do not judge lead quality/);
  assert.match(prompt, /Use clarify only when the main customer need cannot be described without guessing/);
});

test("nearby provider alert resolves the approved short requirement first", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/communication/notification-service.js"), "utf8");
  assert.match(source, /lead\.providerRequirementTitle \|\| lead\.requirementTitle/);
});

test("WhatsApp View Enquiry keeps the service title and uses the approved provider description", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/communication/provider-whatsapp-action-service.js"), "utf8");
  assert.match(source, /lead\.serviceType \|\| lead\.category/);
  assert.match(source, /providerRequirementDetails/);
  assert.match(source, /Description:/);
  assert.doesNotMatch(source, /customerRequirementRaw/);
});

test("requirement AI timeline snapshots preserve each generated suggestion", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/requirement-ai/requirement-ai-service.js"), "utf8");
  assert.match(source, /generationNumber/);
  assert.match(source, /customerRequirementRaw: raw/);
  assert.match(source, /providerTitle: result\.providerTitle/);
  assert.match(source, /providerDetails: result\.providerDetails/);
  assert.match(source, /model: generated\.model/);
});

test("requirement form separates read-only AI suggestions from editable final provider wording", () => {
  const source = fs.readFileSync(path.join(__dirname, "../views/enquiry/show.ejs"), "utf8");
  assert.match(source, /AI corrected title/);
  assert.match(source, /AI corrected description/);
  assert.match(source, /requirementForm\.aiTitle/);
  assert.match(source, /requirementForm\.aiDetails/);
  assert.match(source, /Final WhatsApp requirement/);
  assert.match(source, /Final provider description/);
});


test("lead approval is hard-gated by the approved customer requirement", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/enquiry/enquiry-service.js"), "utf8");
  assert.match(source, /Approve the customer requirement before approving this lead/);
  assert.match(source, /providerRequirementTitle/);
  assert.match(source, /providerRequirementDetails/);
});

test("CRM keeps legacy approved leads clearly backward compatible", () => {
  const source = fs.readFileSync(path.join(__dirname, "../views/enquiry/show.ejs"), "utf8");
  assert.match(source, /AI requirement was not captured for this existing approved lead/);
  assert.match(source, /existing provider access is unchanged/);
});

test("CRM exposes dedicated generate and approve requirement routes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/enquiry.js"), "utf8");
  assert.match(source, /requirement\/generate/);
  assert.match(source, /requirement\/approve/);
});
