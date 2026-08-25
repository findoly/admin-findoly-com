"use strict";

const Enquiry = require("../../models/Enquiry");
const partnerPayoutService = require("../partner-payout/partner-payout-service");
const { canonicalLeadStatus } = require("../../utils/lead-journey");
const uuid = require("../../utils/uuid");
const { publicQuestions, evaluateValidation } = require("../../utils/lead-validation");

const VALIDATION_METHODS = Object.freeze(["phone_call", "whatsapp", "email", "in_person", "other"]);
const FINAL_DECISIONS = Object.freeze(["valid", "invalid"]);
const HISTORY_LIMIT = 10;
const TIMELINE_LIMIT = 50;

function validationError(message, status = 400, code = "LEAD_VALIDATION_QUESTIONNAIRE_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

function identifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw validationError("Lead Reference ID is invalid");
  }
  return normalized;
}

function enquiryQuery(enquiryId) {
  const value = identifier(enquiryId);
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function isProviderControlled(lead = {}) {
  return canonicalLeadStatus(lead.status) === "approved"
    || lead.marketplaceAvailable === true
    || String(lead.marketplaceStatus || "").toLowerCase() === "published"
    || Number(lead.unlockedCount || 0) > 0
    || Number(lead.reservedUnlockCount || 0) > 0;
}

async function getLead(enquiryId) {
  const lead = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!lead) throw validationError("Lead not found", 404, "LEAD_NOT_FOUND");
  return lead;
}

function answerMap(snapshot = []) {
  const answers = {};
  for (const item of Array.isArray(snapshot) ? snapshot : []) {
    if (item?.questionId && item?.answerId) answers[item.questionId] = item.answerId;
  }
  return answers;
}

function presentValidation(lead = {}) {
  const snapshot = lead.leadValidationDecision && typeof lead.leadValidationDecision === "object"
    ? lead.leadValidationDecision
    : null;
  return {
    questions: publicQuestions(),
    answers: answerMap(snapshot?.answers),
    system: snapshot?.system || null,
    final: snapshot?.final || null,
    completed: Boolean(snapshot?.completed && snapshot?.final?.decision),
    locked: isProviderControlled(lead),
    method: snapshot?.method || lead.leadValidationMethod || "",
    note: snapshot?.note || lead.agentReferralValidationNote || "",
    overrideReason: snapshot?.overrideReason || "",
    completedAt: snapshot?.completedAt || lead.agentReferralValidatedAt || null,
    completedBy: snapshot?.completedBy || lead.agentReferralValidatedBy || "",
    version: snapshot?.version || 1,
  };
}

async function getValidation(enquiryId) {
  return presentValidation(await getLead(enquiryId));
}

function assertEditableLead(lead = {}) {
  if (lead.isActive === false) {
    throw validationError("Reactivate the lead before changing validation", 409, "LEAD_INACTIVE");
  }
  if (isProviderControlled(lead)) {
    throw validationError(
      "Lead validation is locked after approval or provider access",
      409,
      "LEAD_VALIDATION_LOCKED",
    );
  }
}

async function previewValidation(enquiryId, input = {}) {
  const lead = await getLead(enquiryId);
  assertEditableLead(lead);
  return evaluateValidation(input.answers || {});
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw validationError(`Text must not exceed ${maxLength} characters`);
  return text;
}

function normalizeMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (!VALIDATION_METHODS.includes(method)) throw validationError("Select how the lead was validated");
  return method;
}

function normalizeFinalDecision(value, systemDecision) {
  const requested = String(value || "").trim().toLowerCase();
  if (requested && !FINAL_DECISIONS.includes(requested)) {
    throw validationError("Final validation decision must be Valid or Invalid");
  }
  if (requested) return requested;
  if (FINAL_DECISIONS.includes(systemDecision)) return systemDecision;
  throw validationError("Review the system result and select a final Valid or Invalid decision");
}

function derivedInvalidReason(system = {}, finalDecision = "valid") {
  if (finalDecision !== "invalid") return "";
  return system.decision === "invalid" && system.invalidReason
    ? system.invalidReason
    : "other";
}

async function saveValidation(enquiryId, input = {}, actor = "admin") {
  const lead = await getLead(enquiryId);
  assertEditableLead(lead);

  const calculated = evaluateValidation(input.answers || {});
  const finalDecision = normalizeFinalDecision(input.finalDecision ?? input.status, calculated.system.decision);
  const method = normalizeMethod(input.method);
  const note = cleanText(input.note);
  const overrideReason = cleanText(input.overrideReason, 1000);
  const requiresEmployeeReason = calculated.system.decision === "needs_review"
    || finalDecision !== calculated.system.decision;

  if (requiresEmployeeReason && !overrideReason) {
    throw validationError(
      calculated.system.decision === "needs_review"
        ? "Enter a reason for the final decision because the system requires review"
        : "Enter an override reason when changing the system validation decision",
    );
  }
  if (method === "other" && !note) {
    throw validationError("Describe how the lead was validated when using Other");
  }

  const automaticReason = calculated.system.reasons.join("; ");
  const partnerNote = note || overrideReason || automaticReason;
  const invalidReason = derivedInvalidReason(calculated.system, finalDecision);

  await partnerPayoutService.updateReferralValidation(enquiryId, {
    status: finalDecision,
    method,
    note: partnerNote,
    reason: invalidReason,
  }, actor);

  const now = new Date();
  const previous = lead.leadValidationDecision && typeof lead.leadValidationDecision === "object"
    ? lead.leadValidationDecision
    : null;
  const snapshot = {
    version: 1,
    completed: true,
    answers: calculated.answers,
    system: calculated.system,
    final: { decision: finalDecision },
    overridden: FINAL_DECISIONS.includes(calculated.system.decision)
      ? finalDecision !== calculated.system.decision
      : false,
    manualReviewResolved: calculated.system.decision === "needs_review",
    overrideReason,
    method,
    note,
    completedAt: now,
    completedBy: String(actor || "admin").slice(0, 254),
  };

  const push = {
    timeline: {
      $each: [{
        timelineId: uuid(),
        type: "lead_validation_questionnaire",
        message: `Validation questionnaire completed: system ${calculated.system.decision}, final ${finalDecision}`,
        systemDecision: calculated.system.decision,
        finalDecision,
        overrideReason,
        actor: snapshot.completedBy,
        createdAt: now,
      }],
      $slice: -TIMELINE_LIMIT,
    },
  };
  if (previous) {
    push.leadValidationDecisionHistory = { $each: [previous], $slice: -HISTORY_LIMIT };
  }

  const update = await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: { leadValidationDecision: snapshot, updatedAt: now },
    $push: push,
  });
  if (update.matchedCount !== 1) {
    throw validationError("Lead validation changed while it was being saved", 409, "LEAD_VALIDATION_CONCURRENT_UPDATE");
  }

  const updated = await getLead(enquiryId);
  return { lead: updated, validation: presentValidation(updated) };
}

module.exports = {
  getValidation,
  previewValidation,
  saveValidation,
  isProviderControlled,
};
