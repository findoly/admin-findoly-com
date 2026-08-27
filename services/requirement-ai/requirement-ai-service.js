"use strict";

const crypto = require("crypto");
const Enquiry = require("../../models/Enquiry");
const uuid = require("../../utils/uuid");
const { canonicalLeadStatus } = require("../../utils/lead-journey");
const leadQualificationService = require("../lead-qualification/lead-qualification-service");
const enquiryService = require("../enquiry/enquiry-service");
const customerVerificationService = require("../enquiry/customer-verification-service");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const SCHEMA_VERSION = 1;
const MAX_RAW_CHARACTERS = 5000;
const MAX_TITLE_WORDS = 20;
const MAX_DETAILS_WORDS = 100;
const CLARIFICATION_REASONS = Object.freeze([
  "missing_core_requirement",
  "ambiguous_requirement",
  "conflicting_information",
  "insufficient_context",
]);
const TIMELINE_LIMIT = 50;

function requirementError(message, status = 400, code = "LEAD_REQUIREMENT_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

function enquiryQuery(enquiryId) {
  const value = String(enquiryId || "").trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw requirementError("Lead Reference ID is invalid");
  }
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function compactText(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function wordCount(value) {
  const text = compactText(value);
  return text ? text.split(/\s+/).length : 0;
}

function rawRequirement(value) {
  const text = String(value || "").trim();
  if (!text) throw requirementError("Enter the customer's requirement before checking with AI");
  if (text.length > MAX_RAW_CHARACTERS) {
    throw requirementError(`Customer requirement must be ${MAX_RAW_CHARACTERS} characters or less`);
  }
  return text;
}

function redactContactDetails(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted contact]")
    .replace(/(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}\b/g, "[redacted contact]");
}

function containsRestrictedContact(value) {
  const text = String(value || "");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  const digits = text.replace(/\D/g, "");
  return /[6-9]\d{9}/.test(digits);
}

function validateProviderText(title, details) {
  const providerTitle = compactText(title);
  const providerDetails = compactText(details);
  if (!providerTitle) throw requirementError("Provider alert title is required");
  if (!providerDetails) throw requirementError("Provider requirement details are required");
  if (wordCount(providerTitle) > MAX_TITLE_WORDS) {
    throw requirementError(`Provider alert title must be ${MAX_TITLE_WORDS} words or less`);
  }
  if (wordCount(providerDetails) > MAX_DETAILS_WORDS) {
    throw requirementError(`Provider requirement details must be ${MAX_DETAILS_WORDS} words or less`);
  }
  if (providerTitle.length > 300 || providerDetails.length > 2000) {
    throw requirementError("Provider requirement wording is too long");
  }
  if (containsRestrictedContact(providerTitle) || containsRestrictedContact(providerDetails)) {
    throw requirementError("Provider requirement wording must not contain a customer mobile number or email address");
  }
  return { providerTitle, providerDetails };
}

function buildSchema() {
  return {
    type: "object",
    properties: {
      schemaVersion: { type: "integer", enum: [SCHEMA_VERSION] },
      status: { type: "string", enum: ["ready", "clarify"] },
      clarificationReason: {
        type: ["string", "null"],
        enum: [...CLARIFICATION_REASONS, null],
      },
      clarificationMessage: { type: ["string", "null"] },
      providerTitle: { type: ["string", "null"] },
      providerDetails: { type: ["string", "null"] },
    },
    required: [
      "schemaVersion",
      "status",
      "clarificationReason",
      "clarificationMessage",
      "providerTitle",
      "providerDetails",
    ],
    additionalProperties: false,
  };
}

function instructions() {
  return [
    "You prepare provider-facing wording for Findoly customer requirements.",
    "This is only a LOW-LEVEL clarity check. Do not judge lead quality, commercial value, seriousness, category eligibility, purchase likelihood, or whether every detail is known.",
    "Return status ready whenever the customer's fundamental product or service need can be stated truthfully without inventing the core requirement.",
    "Valid needs include buying or sourcing products, obtaining quotations with purchase intent, hiring services, repairs, maintenance, installation, inspection, rental, supply, consultation, or similar procurement.",
    "Do not require budget, exact model, quantity, date, specification, or detailed symptoms unless their absence makes the fundamental need impossible to understand.",
    "Use clarify only when the main customer need cannot be described without guessing, or when conflicting information must be resolved.",
    "For clarify, provide one short, specific instruction telling the employee what to clarify. providerTitle and providerDetails must be null.",
    "For ready, clarificationReason and clarificationMessage must be null.",
    `For ready, providerTitle must be a factual provider alert title of no more than ${MAX_TITLE_WORDS} words.`,
    `For ready, providerDetails must be a factual provider description of no more than ${MAX_DETAILS_WORDS} words.`,
    "Correct grammar and wording while preserving uncertainty exactly. Never invent facts.",
    "Do not include customer mobile numbers, email addresses, exact contact details, expected spend/budget, internal scores, responsiveness, confidence labels, or CRM-only notes.",
    "Return only the JSON required by the schema.",
  ].join("\n");
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text.trim();
      }
    }
  }
  return "";
}

function validateAiResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw requirementError("OpenAI returned an invalid requirement response", 502, "AI_OUTPUT_INVALID");
  }
  const expectedKeys = [
    "clarificationMessage",
    "clarificationReason",
    "providerDetails",
    "providerTitle",
    "schemaVersion",
    "status",
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw requirementError("OpenAI returned unexpected requirement fields", 502, "AI_OUTPUT_INVALID");
  }
  if (value.schemaVersion !== SCHEMA_VERSION || !["ready", "clarify"].includes(value.status)) {
    throw requirementError("OpenAI returned an unsupported requirement response", 502, "AI_OUTPUT_INVALID");
  }

  if (value.status === "clarify") {
    if (!CLARIFICATION_REASONS.includes(value.clarificationReason)) {
      throw requirementError("OpenAI returned an invalid clarification reason", 502, "AI_OUTPUT_INVALID");
    }
    const clarificationMessage = compactText(value.clarificationMessage);
    if (!clarificationMessage || clarificationMessage.length > 1000) {
      throw requirementError("OpenAI returned an invalid clarification message", 502, "AI_OUTPUT_INVALID");
    }
    if (value.providerTitle !== null || value.providerDetails !== null) {
      throw requirementError("OpenAI clarification response must not contain provider wording", 502, "AI_OUTPUT_INVALID");
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "clarify",
      clarificationReason: value.clarificationReason,
      clarificationMessage,
      providerTitle: null,
      providerDetails: null,
    };
  }

  if (value.clarificationReason !== null || value.clarificationMessage !== null) {
    throw requirementError("OpenAI ready response must not contain clarification fields", 502, "AI_OUTPUT_INVALID");
  }
  const validated = validateProviderText(value.providerTitle, value.providerDetails);
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "ready",
    clarificationReason: null,
    clarificationMessage: null,
    ...validated,
  };
}

function answerContext(snapshot = {}, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  return (Array.isArray(snapshot?.answers) ? snapshot.answers : [])
    .filter((item) => item?.questionId && !excluded.has(item.questionId))
    .map((item) => ({
      question: compactText(item.question || item.questionId),
      answer: compactText(item.answer || item.answerId),
    }))
    .filter((item) => item.question && item.answer);
}

function sourcePayload(lead = {}, raw = lead.customerRequirementRaw || "") {
  return {
    schemaVersion: SCHEMA_VERSION,
    raw: String(raw || "").trim(),
    category: compactText(lead.category || lead.categorySlug),
    serviceTypes: (Array.isArray(lead.serviceTypes) ? lead.serviceTypes : [])
      .map((item) => compactText(item?.name || item))
      .filter(Boolean)
      .slice(0, 5),
    validation: answerContext(lead.leadValidationDecision),
    qualification: answerContext(lead.leadQualification, { exclude: ["expected_spend"] }),
  };
}

function sourceHash(lead = {}, raw = lead.customerRequirementRaw || "") {
  return crypto.createHash("sha256").update(JSON.stringify(sourcePayload(lead, raw)), "utf8").digest("hex");
}

function aiInput(lead, raw) {
  const payload = sourcePayload(lead, redactContactDetails(raw));
  return JSON.stringify({
    customerRequirement: payload.raw,
    category: payload.category,
    serviceTypes: payload.serviceTypes,
    validationAnswers: payload.validation,
    qualificationAnswers: payload.qualification,
  });
}

async function getLead(enquiryId) {
  const lead = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!lead) throw requirementError("Lead not found", 404, "LEAD_NOT_FOUND");
  return lead;
}

function assertPrerequisites(lead = {}) {
  if (lead.isActive === false) {
    throw requirementError("Reactivate the lead before preparing the customer requirement", 409, "LEAD_INACTIVE");
  }
  if (leadQualificationService.isProviderControlled(lead)) {
    throw requirementError("Customer requirement is locked after approval or provider access", 409, "LEAD_REQUIREMENT_LOCKED");
  }
  if (!leadQualificationService.isValidationQuestionnaireComplete(lead)) {
    throw requirementError(
      "Complete lead validation with a final Valid decision before preparing the customer requirement",
      400,
      "LEAD_VALIDATION_REQUIRED",
    );
  }
  if (!leadQualificationService.isQualificationComplete(lead)) {
    throw requirementError(
      "Complete lead qualification before preparing the customer requirement",
      400,
      "LEAD_QUALIFICATION_REQUIRED",
    );
  }
}

function openAiConfig(options = {}) {
  const apiKey = options.apiKey === undefined
    ? String(process.env.CRM_OPENAI_API_KEY || "").trim()
    : String(options.apiKey || "").trim();
  const model = String(options.model || process.env.CRM_OPENAI_MODEL || "gpt-5.6-luna").trim();
  const reasoningEffort = String(
    options.reasoningEffort === undefined
      ? process.env.CRM_OPENAI_REASONING_EFFORT || ""
      : options.reasoningEffort || "",
  ).trim();
  const timeoutMs = Math.max(
    1500,
    Math.min(Number(options.timeoutMs || process.env.CRM_OPENAI_TIMEOUT_MS || 8000), 30000),
  );
  if (!apiKey) throw requirementError("OpenAI requirement assistance is not configured", 503, "AI_NOT_CONFIGURED");
  return { apiKey, model, reasoningEffort, timeoutMs };
}

async function requestOpenAi(lead, raw, options = {}) {
  const config = openAiConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw requirementError("OpenAI requirement assistance is unavailable", 503, "AI_FETCH_UNAVAILABLE");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const body = {
    model: config.model,
    store: false,
    input: [
      { role: "system", content: instructions() },
      { role: "user", content: aiInput(lead, raw) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "findoly_provider_requirement",
        strict: true,
        schema: buildSchema(),
      },
    },
    max_output_tokens: 420,
  };
  if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };

  try {
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch (_error) {}
    if (!response.ok) {
      const providerCode = compactText(payload?.error?.code);
      throw requirementError(
        `OpenAI requirement assistance failed${providerCode ? ` (${providerCode})` : ""}`,
        502,
        "AI_PROVIDER_ERROR",
      );
    }
    const outputText = extractOutputText(payload);
    if (!outputText) throw requirementError("OpenAI returned an empty requirement response", 502, "AI_OUTPUT_EMPTY");
    let parsed;
    try { parsed = JSON.parse(outputText); }
    catch (_error) {
      throw requirementError("OpenAI returned invalid requirement JSON", 502, "AI_OUTPUT_INVALID");
    }
    return {
      result: validateAiResult(parsed),
      model: config.model,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw requirementError("OpenAI requirement assistance timed out", 504, "AI_TIMEOUT");
    }
    if (error?.code && error?.status) throw error;
    throw requirementError("OpenAI requirement assistance is temporarily unavailable", 503, "AI_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}

function presentRequirement(lead = {}) {
  return {
    customerRequirementRaw: lead.customerRequirementRaw || "",
    status: lead.requirementAiStatus || "",
    clarificationReason: lead.requirementAiClarificationReason || null,
    clarificationMessage: lead.requirementAiClarificationMessage || null,
    providerTitle: lead.requirementAiProviderTitle || lead.providerRequirementTitle || "",
    providerDetails: lead.requirementAiProviderDetails || lead.providerRequirementDetails || "",
    approvedProviderTitle: lead.providerRequirementTitle || "",
    approvedProviderDetails: lead.providerRequirementDetails || "",
    schemaVersion: Number(lead.requirementAiSchemaVersion || 0),
    sourceHash: lead.requirementAiSourceHash || "",
    model: lead.requirementAiModel || "",
    generatedAt: lead.requirementAiGeneratedAt || null,
    generationCount: Number(lead.requirementAiGenerationCount || 0),
    approvedAt: lead.requirementAiApprovedAt || null,
    approvedBy: lead.requirementAiApprovedBy || "",
    approved: Boolean(
      lead.requirementAiApprovedAt
      && lead.providerRequirementTitle
      && lead.providerRequirementDetails
    ),
  };
}

async function generateRequirement(enquiryId, input = {}, actor = "admin", options = {}) {
  let lead = await getLead(enquiryId);
  assertPrerequisites(lead);
  const raw = rawRequirement(input.customerRequirementRaw);
  const rawChanged = raw !== String(lead.customerRequirementRaw || "").trim();
  const rawUpdate = {
    customerRequirementRaw: raw,
    updatedAt: new Date(),
  };
  if (rawChanged) {
    Object.assign(rawUpdate, {
      requirementAiStatus: "",
      requirementAiClarificationReason: "",
      requirementAiClarificationMessage: "",
      requirementAiProviderTitle: "",
      requirementAiProviderDetails: "",
      providerRequirementTitle: "",
      providerRequirementDetails: "",
      requirementAiApprovedAt: null,
      requirementAiApprovedBy: "",
      requirementAiSourceHash: "",
      requirementAiGeneratedAt: null,
    });
  }
  const rawSave = await Enquiry.updateOne(enquiryQuery(enquiryId), { $set: rawUpdate });
  if (rawSave.matchedCount !== 1) {
    throw requirementError("Lead requirement changed while it was being saved", 409, "LEAD_REQUIREMENT_CONCURRENT_UPDATE");
  }
  lead = { ...lead, ...rawUpdate };

  const generated = await requestOpenAi(lead, raw, options);
  const result = generated.result;
  const now = new Date();
  const hash = sourceHash(lead, raw);

  const update = await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: {
      customerRequirementRaw: raw,
      requirementAiStatus: result.status,
      requirementAiClarificationReason: result.clarificationReason || "",
      requirementAiClarificationMessage: result.clarificationMessage || "",
      requirementAiProviderTitle: result.providerTitle || "",
      requirementAiProviderDetails: result.providerDetails || "",
      requirementAiSchemaVersion: SCHEMA_VERSION,
      requirementAiSourceHash: hash,
      requirementAiModel: generated.model,
      requirementAiGeneratedAt: now,
      updatedAt: now,
    },
    $inc: { requirementAiGenerationCount: 1 },
    $push: {
      timeline: {
        $each: [{
          timelineId: uuid(),
          type: result.status === "ready" ? "requirement_ai_generated" : "requirement_ai_clarification",
          message: result.status === "ready"
            ? "AI prepared provider-facing customer requirement wording"
            : result.clarificationMessage,
          actor: String(actor || "admin").slice(0, 254),
          createdAt: now,
        }],
        $slice: -TIMELINE_LIMIT,
      },
    },
  });
  if (update.matchedCount !== 1) {
    throw requirementError("Lead requirement changed while it was being generated", 409, "LEAD_REQUIREMENT_CONCURRENT_UPDATE");
  }
  const updated = await getLead(enquiryId);
  return { lead: updated, requirement: presentRequirement(updated) };
}

async function advanceToApproved(enquiryId, actor) {
  const note = "Customer requirement approved after AI-assisted review";
  let lead = await enquiryService.get(enquiryId);
  let status = canonicalLeadStatus(lead.status || lead.journeyStatus);

  if (status === "new") {
    lead = await enquiryService.updateStatus(enquiryId, { action: "next", note }, actor);
    status = canonicalLeadStatus(lead.status || lead.journeyStatus);
  }
  if (status !== "verification") {
    if (status === "approved") return lead;
    throw requirementError("Lead must be New or Verification before approval", 409, "LEAD_REQUIREMENT_APPROVAL_STATUS_INVALID");
  }

  let verificationPreparation = null;
  try {
    verificationPreparation = await customerVerificationService.prepareApprovalCustomerMobileVerification(lead);
    lead = await enquiryService.updateStatus(enquiryId, { action: "next", note }, actor);
    return await customerVerificationService.ensureApprovedCustomerMobileVerified(lead);
  } catch (error) {
    if (verificationPreparation) {
      await customerVerificationService.rollbackPreparedApprovalCustomerMobileVerification(verificationPreparation);
    }
    throw error;
  }
}

async function approveRequirement(enquiryId, input = {}, actor = "admin") {
  let lead = await getLead(enquiryId);
  assertPrerequisites(lead);

  if (lead.requirementAiStatus !== "ready") {
    throw requirementError("Check the customer requirement with AI and resolve any clarification before approval");
  }
  const currentHash = sourceHash(lead);
  if (!lead.requirementAiSourceHash || currentHash !== lead.requirementAiSourceHash) {
    throw requirementError(
      "Customer requirement or qualification details changed. Check the requirement with AI again before approval.",
      409,
      "LEAD_REQUIREMENT_AI_STALE",
    );
  }

  const { providerTitle, providerDetails } = validateProviderText(
    input.providerTitle ?? lead.requirementAiProviderTitle,
    input.providerDetails ?? lead.requirementAiProviderDetails,
  );
  const now = new Date();
  const approvedBy = String(actor || "admin").slice(0, 254);
  const save = await Enquiry.updateOne(
    {
      $and: [
        enquiryQuery(enquiryId),
        { status: { $ne: "approved" } },
        { marketplaceAvailable: { $ne: true } },
      ],
    },
    {
      $set: {
        providerRequirementTitle: providerTitle,
        providerRequirementDetails: providerDetails,
        requirementAiProviderTitle: providerTitle,
        requirementAiProviderDetails: providerDetails,
        requirementAiApprovedAt: now,
        requirementAiApprovedBy: approvedBy,
        updatedAt: now,
      },
      $push: {
        timeline: {
          $each: [{
            timelineId: uuid(),
            type: "customer_requirement_approved",
            message: "Customer requirement wording approved for providers",
            actor: approvedBy,
            createdAt: now,
          }],
          $slice: -TIMELINE_LIMIT,
        },
      },
    },
  );
  if (save.matchedCount !== 1) {
    throw requirementError("Lead requirement was locked while being approved", 409, "LEAD_REQUIREMENT_LOCKED");
  }

  lead = await advanceToApproved(enquiryId, actor);
  return { lead, requirement: presentRequirement(await getLead(enquiryId)) };
}

module.exports = {
  OPENAI_RESPONSES_URL,
  SCHEMA_VERSION,
  MAX_RAW_CHARACTERS,
  MAX_TITLE_WORDS,
  MAX_DETAILS_WORDS,
  CLARIFICATION_REASONS,
  buildSchema,
  instructions,
  extractOutputText,
  validateAiResult,
  wordCount,
  sourcePayload,
  sourceHash,
  presentRequirement,
  generateRequirement,
  approveRequirement,
};
