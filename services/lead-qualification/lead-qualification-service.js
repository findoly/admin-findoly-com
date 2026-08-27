const Enquiry = require("../../models/Enquiry");
const Category = require("../../models/Category");
const uuid = require("../../utils/uuid");
const { canonicalLeadStatus, LEAD_JOURNEY } = require("../../utils/lead-journey");
const {
  DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE,
  QUALIFICATION_VERSION,
  publicQuestions,
  normalizeCategoryMaxLeadPricePaise,
  calculateQualification,
  normalizeFinalSelection,
} = require("../../utils/lead-qualification");

const TIMELINE_LIMIT = 50;
const QUALIFICATION_HISTORY_LIMIT = 10;

function qualificationError(message, status = 400, code = "LEAD_QUALIFICATION_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

function identifier(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw qualificationError(`${label} is invalid`);
  }
  return normalized;
}

function enquiryQuery(enquiryId) {
  const value = identifier(enquiryId, "Lead Reference ID");
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function categoryQuery(categoryId) {
  const value = identifier(categoryId, "Category ID");
  return { $or: [{ categoryId: value }, { id: value }] };
}

function isQualificationComplete(lead = {}) {
  return Boolean(
    lead.leadQualification
    && lead.leadQualification.completed === true
    && lead.leadQualification.completedAt
    && lead.leadQualification.final
    && String(lead.leadQualification.categorySlug || "") === String(lead.categorySlug || ""),
  );
}

function isValidationQuestionnaireComplete(lead = {}) {
  return Boolean(
    lead.leadValidationDecision
    && lead.leadValidationDecision.completed === true
    && lead.leadValidationDecision.final?.decision === "valid"
    && lead.agentReferralValidation === "valid",
  );
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
  if (!lead) throw qualificationError("Lead not found", 404, "LEAD_NOT_FOUND");
  return lead;
}

async function getCategoryMaxLeadPricePaise(categorySlug) {
  const slug = String(categorySlug || "").trim().toLowerCase();
  if (!slug) return DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE;
  const category = await Category.findOne({ slug })
    .select({ maxLeadPricePaise: 1 })
    .lean();
  try {
    return normalizeCategoryMaxLeadPricePaise(
      category?.maxLeadPricePaise,
      DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE,
    );
  } catch (error) {
    return DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE;
  }
}

function answerMap(snapshot = []) {
  const answers = {};
  for (const item of Array.isArray(snapshot) ? snapshot : []) {
    if (item?.questionId && item?.answerId) answers[item.questionId] = item.answerId;
  }
  return answers;
}

function qualificationPayload(lead, categoryMaxLeadPricePaise) {
  const current = lead.leadQualification && typeof lead.leadQualification === "object"
    ? lead.leadQualification
    : null;
  return {
    questions: publicQuestions(),
    answers: answerMap(current?.answers),
    system: current?.system || null,
    final: current?.final || null,
    completed: isQualificationComplete(lead),
    locked: isProviderControlled(lead),
    categoryMaxLeadPricePaise,
    completedAt: current?.completedAt || null,
    completedBy: current?.completedBy || "",
    version: current ? (current.version || 1) : QUALIFICATION_VERSION,
  };
}

async function getQualification(enquiryId) {
  const lead = await getLead(enquiryId);
  const categoryMaxLeadPricePaise = await getCategoryMaxLeadPricePaise(lead.categorySlug);
  return qualificationPayload(lead, categoryMaxLeadPricePaise);
}

function assertLeadCanBeQualified(lead = {}) {
  if (lead.isActive === false) {
    throw qualificationError("Reactivate the lead before completing qualification", 409, "LEAD_INACTIVE");
  }
  if (!isValidationQuestionnaireComplete(lead)) {
    throw qualificationError(
      "Complete the lead validation questionnaire with a final Valid decision before qualification",
      409,
      "LEAD_VALIDATION_QUESTIONNAIRE_REQUIRED",
    );
  }
  if (canonicalLeadStatus(lead.status) === "rejected") {
    throw qualificationError("Restore the rejected lead before completing qualification", 409, "LEAD_REJECTED");
  }
  if (isProviderControlled(lead)) {
    throw qualificationError(
      "Lead qualification is locked after approval or provider access",
      409,
      "LEAD_QUALIFICATION_LOCKED",
    );
  }
}

async function previewQualification(enquiryId, input = {}) {
  const lead = await getLead(enquiryId);
  assertLeadCanBeQualified(lead);
  const categoryMaxLeadPricePaise = await getCategoryMaxLeadPricePaise(lead.categorySlug);
  return calculateQualification(input.answers || {}, categoryMaxLeadPricePaise);
}

async function saveQualification(enquiryId, input = {}, actor = "admin") {
  const lead = await getLead(enquiryId);
  assertLeadCanBeQualified(lead);
  const categoryMaxLeadPricePaise = await getCategoryMaxLeadPricePaise(lead.categorySlug);
  const calculated = calculateQualification(input.answers || {}, categoryMaxLeadPricePaise);
  const final = normalizeFinalSelection(input.overrides || input.final || {}, calculated.system);
  const now = new Date();
  const requalifying = Boolean(lead.leadQualification?.completed);
  const snapshot = {
    version: QUALIFICATION_VERSION,
    completed: true,
    categorySlug: String(lead.categorySlug || ""),
    answers: calculated.answers,
    system: calculated.system,
    final,
    overrides: {
      leadPrice: final.leadPricePaise !== calculated.system.leadPricePaise,
      leadIntent: final.leadIntent !== calculated.system.leadIntent,
      priority: final.priority !== calculated.system.priority,
    },
    completedAt: now,
    completedBy: String(actor || "admin").slice(0, 254),
  };
  const event = {
    timelineId: uuid(),
    type: requalifying ? "lead_requalified" : "lead_qualification",
    message: requalifying ? "Lead qualification updated" : "Lead qualification completed",
    priceScorePercent: calculated.system.priceScorePercent,
    roundedPricePercent: calculated.system.roundedPricePercent,
    categoryMaxLeadPricePaise,
    systemLeadPricePaise: calculated.system.leadPricePaise,
    finalLeadPricePaise: final.leadPricePaise,
    systemLeadIntent: calculated.system.leadIntent,
    finalLeadIntent: final.leadIntent,
    systemPriority: calculated.system.priority,
    finalPriority: final.priority,
    actor: snapshot.completedBy,
    createdAt: now,
  };

  const push = {
    timeline: { $each: [event], $slice: -TIMELINE_LIMIT },
  };
  if (requalifying && lead.leadQualification) {
    push.leadQualificationHistory = {
      $each: [lead.leadQualification],
      $slice: -QUALIFICATION_HISTORY_LIMIT,
    };
  }

  const updateQuery = {
    $and: [
      enquiryQuery(enquiryId),
      { status: { $ne: "approved" } },
      { marketplaceAvailable: { $ne: true } },
      { marketplaceStatus: { $ne: "published" } },
      { $or: [{ unlockedCount: 0 }, { unlockedCount: null }, { unlockedCount: { $exists: false } }] },
      { $or: [{ reservedUnlockCount: 0 }, { reservedUnlockCount: null }, { reservedUnlockCount: { $exists: false } }] },
    ],
  };
  const result = await Enquiry.updateOne(updateQuery, {
    $set: {
      leadQualification: snapshot,
      leadIntent: final.leadIntent,
      priority: final.priority,
      leadPricePaise: final.leadPricePaise,
      updatedAt: now,
    },
    $push: push,
  });
  if (result.matchedCount !== 1) {
    throw qualificationError(
      "Lead qualification was locked while it was being saved. Reload the lead and try again.",
      409,
      "LEAD_QUALIFICATION_CONCURRENT_LOCK",
    );
  }

  const updatedLead = await getLead(enquiryId);
  return {
    qualification: qualificationPayload(updatedLead, categoryMaxLeadPricePaise),
    lead: updatedLead,
  };
}

function isForwardTransition(lead = {}, input = {}) {
  const current = canonicalLeadStatus(lead.status);
  const action = String(input.action || "").trim().toLowerCase();
  if (action === "next") return true;
  if (["previous", "reject", "restore"].includes(action)) return false;
  const requested = String(input.status || "").trim().toLowerCase();
  if (!requested) return false;
  const canonicalRequested = canonicalLeadStatus(requested);
  const currentIndex = LEAD_JOURNEY.indexOf(current);
  const targetIndex = LEAD_JOURNEY.indexOf(canonicalRequested);
  return currentIndex >= 0 && targetIndex > currentIndex;
}

function isProviderRequirementApproved(lead = {}) {
  return Boolean(
    lead.requirementAiApprovedAt
    && String(lead.providerRequirementTitle || "").trim()
    && String(lead.providerRequirementDetails || "").trim()
  );
}

async function assertJourneyTransitionAllowed(enquiryId, input = {}) {
  const lead = await getLead(enquiryId);
  if (!isForwardTransition(lead, input)) return;
  if (!isValidationQuestionnaireComplete(lead)) {
    throw qualificationError(
      "Complete the lead validation questionnaire with a final Valid decision before moving the journey forward",
      400,
      "LEAD_VALIDATION_QUESTIONNAIRE_REQUIRED",
    );
  }
  if (!isQualificationComplete(lead)) {
    throw qualificationError(
      "Complete lead qualification before moving the journey forward",
      400,
      "LEAD_QUALIFICATION_REQUIRED",
    );
  }
  if (canonicalLeadStatus(lead.status) === "verification" && !isProviderRequirementApproved(lead)) {
    throw qualificationError(
      "Approve the AI-assisted customer requirement before approving this lead",
      400,
      "LEAD_CUSTOMER_REQUIREMENT_REQUIRED",
    );
  }
}

function normalizedProtectedValue(field, value) {
  if (field === "leadPricePaise") return Number(value);
  return String(value || "").trim().toLowerCase();
}

async function assertDirectLeadValueEditAllowed(enquiryId, input = {}) {
  const protectedFields = ["leadPricePaise", "leadIntent", "priority"];
  const suppliedFields = protectedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(input || {}, field),
  );
  if (!suppliedFields.length) return;

  const lead = await getLead(enquiryId);
  const changedFields = suppliedFields.filter((field) =>
    normalizedProtectedValue(field, input[field]) !== normalizedProtectedValue(field, lead[field]),
  );
  if (!changedFields.length) return;

  if (isProviderControlled(lead)) {
    throw qualificationError(
      "Lead price, intent and priority are locked after approval or provider access",
      409,
      "LEAD_QUALIFICATION_LOCKED",
    );
  }
  if (isQualificationComplete(lead)) {
    throw qualificationError(
      "Use Lead Qualification to change price, intent or priority so the override is recorded",
      400,
      "LEAD_QUALIFICATION_OVERRIDE_REQUIRED",
    );
  }
}

async function applyCategoryMaxLeadPrice(category = {}, input = {}) {
  const categoryId = String(category.categoryId || category.id || "").trim();
  const supplied = Object.prototype.hasOwnProperty.call(input || {}, "maxLeadPricePaise");
  const fallback = category.maxLeadPricePaise ?? DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE;
  const maxLeadPricePaise = normalizeCategoryMaxLeadPricePaise(
    supplied ? input.maxLeadPricePaise : fallback,
    DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE,
  );
  if (supplied && categoryId) {
    const result = await Category.updateOne(categoryQuery(categoryId), {
      $set: { maxLeadPricePaise, updatedAt: new Date() },
    });
    if (result.matchedCount !== 1) {
      throw qualificationError("Category not found", 404, "CATEGORY_NOT_FOUND");
    }
  }
  return { ...category, maxLeadPricePaise };
}

module.exports = {
  getQualification,
  previewQualification,
  saveQualification,
  assertJourneyTransitionAllowed,
  assertDirectLeadValueEditAllowed,
  applyCategoryMaxLeadPrice,
  getCategoryMaxLeadPricePaise,
  isQualificationComplete,
  isValidationQuestionnaireComplete,
  isProviderRequirementApproved,
  isProviderControlled,
};
