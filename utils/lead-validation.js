"use strict";

const VALIDATION_QUESTIONS = Object.freeze([
  Object.freeze({
    id: "requirement_confirmed",
    prompt: "Did the customer confirm this service requirement belongs to them?",
    options: Object.freeze([
      Object.freeze({ id: "yes", label: "Yes" }),
      Object.freeze({ id: "no", label: "No" }),
    ]),
  }),
  Object.freeze({
    id: "contact_verification",
    prompt: "Were the customer's contact details successfully verified?",
    options: Object.freeze([
      Object.freeze({ id: "verified", label: "Verified" }),
      Object.freeze({ id: "unable_to_verify", label: "Unable to verify" }),
      Object.freeze({ id: "incorrect", label: "Incorrect details" }),
    ]),
  }),
  Object.freeze({
    id: "category_match",
    prompt: "Does the requirement match the selected service or category?",
    options: Object.freeze([
      Object.freeze({ id: "yes", label: "Yes" }),
      Object.freeze({ id: "no", label: "No" }),
    ]),
  }),
  Object.freeze({
    id: "duplicate_requirement",
    prompt: "Is this a duplicate of an existing active requirement?",
    options: Object.freeze([
      Object.freeze({ id: "no", label: "No" }),
      Object.freeze({ id: "yes", label: "Yes" }),
    ]),
  }),
  Object.freeze({
    id: "current_interest",
    prompt: "After speaking with the customer, what is their current interest in getting this service?",
    options: Object.freeze([
      Object.freeze({ id: "wants_service", label: "Wants the service" }),
      Object.freeze({ id: "not_decided", label: "Not decided yet" }),
      Object.freeze({ id: "does_not_want", label: "Does not want the service" }),
    ]),
  }),
]);

function validationError(message) {
  return Object.assign(new Error(message), { status: 400, code: "LEAD_VALIDATION_QUESTIONNAIRE_INVALID" });
}

function publicQuestions() {
  return VALIDATION_QUESTIONS.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: question.options.map((option) => ({ id: option.id, label: option.label })),
  }));
}

function normalizeAnswers(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("Lead validation answers are required");
  }
  const normalized = {};
  for (const question of VALIDATION_QUESTIONS) {
    const answerId = String(input[question.id] || "").trim();
    if (!question.options.some((option) => option.id === answerId)) {
      throw validationError(`Select an answer for: ${question.prompt}`);
    }
    normalized[question.id] = answerId;
  }
  return normalized;
}

function answerDetails(answers) {
  return VALIDATION_QUESTIONS.map((question) => {
    const option = question.options.find((item) => item.id === answers[question.id]);
    return {
      questionId: question.id,
      question: question.prompt,
      answerId: option.id,
      answer: option.label,
    };
  });
}

function evaluateValidation(inputAnswers = {}) {
  const answers = normalizeAnswers(inputAnswers);
  const invalidReasons = [];
  const reviewReasons = [];
  let invalidReason = "";

  if (answers.requirement_confirmed === "no") {
    invalidReasons.push("Customer did not confirm that the requirement belongs to them");
    invalidReason ||= "other";
  }
  if (answers.contact_verification === "incorrect") {
    invalidReasons.push("Customer contact details are incorrect");
    invalidReason ||= "incorrect_details";
  } else if (answers.contact_verification === "unable_to_verify") {
    reviewReasons.push("Customer contact details could not be verified");
  }
  if (answers.category_match === "no") {
    invalidReasons.push("Requirement does not match the selected service or category");
    invalidReason ||= "outside_assigned_category";
  }
  if (answers.duplicate_requirement === "yes") {
    invalidReasons.push("An existing active requirement already covers this request");
    invalidReason = "duplicate";
  }
  if (answers.current_interest === "does_not_want") {
    invalidReasons.push("Customer confirmed they do not want or need the service");
    invalidReason ||= "customer_not_interested";
  }

  const decision = invalidReasons.length
    ? "invalid"
    : reviewReasons.length
      ? "needs_review"
      : "valid";

  return {
    answers: answerDetails(answers),
    system: {
      decision,
      reasons: decision === "invalid" ? invalidReasons : decision === "needs_review" ? reviewReasons : ["All validation checks passed"],
      invalidReason: decision === "invalid" ? (invalidReason || "other") : "",
    },
  };
}

module.exports = {
  VALIDATION_QUESTIONS,
  publicQuestions,
  normalizeAnswers,
  answerDetails,
  evaluateValidation,
};
