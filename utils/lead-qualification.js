const DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE = 10000;
const MAX_LEAD_PRICE_PAISE = 1_000_000_000;
const PRICE_ROUNDING_PAISE = 1000;

const QUESTIONS = Object.freeze([
  Object.freeze({
    id: "readiness",
    prompt: "How ready is the customer to proceed with the service?",
    options: Object.freeze([
      Object.freeze({ id: "ready_now", label: "Ready to proceed now", score: 100 }),
      Object.freeze({ id: "comparing", label: "Comparing providers", score: 70 }),
      Object.freeze({ id: "exploring", label: "Exploring options", score: 35 }),
      Object.freeze({ id: "information_only", label: "Information only", score: 10 }),
    ]),
  }),
  Object.freeze({
    id: "timeline",
    prompt: "When does the customer need the service?",
    options: Object.freeze([
      Object.freeze({ id: "within_24_hours", label: "Within 24 hours", score: 100 }),
      Object.freeze({ id: "within_7_days", label: "Within 7 days", score: 80 }),
      Object.freeze({ id: "within_30_days", label: "Within 30 days", score: 55 }),
      Object.freeze({ id: "later_or_unsure", label: "Later or unsure", score: 25 }),
    ]),
  }),
  Object.freeze({
    id: "clarity",
    prompt: "How clear is the requirement?",
    options: Object.freeze([
      Object.freeze({ id: "exact", label: "Exact requirement confirmed", score: 100 }),
      Object.freeze({ id: "mostly_clear", label: "Mostly clear", score: 75 }),
      Object.freeze({ id: "partially_clear", label: "Partially clear", score: 50 }),
      Object.freeze({ id: "unclear", label: "Unclear", score: 20 }),
    ]),
  }),
  Object.freeze({
    id: "budget",
    prompt: "What is the customer's budget status?",
    options: Object.freeze([
      Object.freeze({ id: "confirmed", label: "Budget confirmed", score: 100 }),
      Object.freeze({ id: "range_known", label: "Budget range known", score: 80 }),
      Object.freeze({ id: "willing_not_fixed", label: "Budget not fixed but willing to spend", score: 50 }),
      Object.freeze({ id: "not_discussed", label: "No budget discussed", score: 15 }),
    ]),
  }),
  Object.freeze({
    id: "responsiveness",
    prompt: "How responsive is the customer?",
    options: Object.freeze([
      Object.freeze({ id: "highly_responsive", label: "Highly responsive", score: 100 }),
      Object.freeze({ id: "normally_responsive", label: "Normally responsive", score: 75 }),
      Object.freeze({ id: "slow", label: "Slow to respond", score: 40 }),
      Object.freeze({ id: "difficult", label: "Difficult to reach", score: 15 }),
    ]),
  }),
  Object.freeze({
    id: "requirement_size",
    prompt: "What is the approximate size or value of the requirement?",
    options: Object.freeze([
      Object.freeze({ id: "very_large", label: "Very large", score: 100 }),
      Object.freeze({ id: "large", label: "Large", score: 80 }),
      Object.freeze({ id: "medium", label: "Medium", score: 55 }),
      Object.freeze({ id: "small", label: "Small", score: 30 }),
    ]),
  }),
]);

const PRICE_WEIGHTS = Object.freeze({
  readiness: 25,
  timeline: 10,
  clarity: 15,
  budget: 20,
  responsiveness: 10,
  requirement_size: 20,
});

const INTENT_WEIGHTS = Object.freeze({
  readiness: 35,
  timeline: 15,
  clarity: 15,
  budget: 20,
  responsiveness: 15,
});

const PRIORITY_WEIGHTS = Object.freeze({
  timeline: 70,
  readiness: 30,
});

function qualificationError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCategoryMaxLeadPricePaise(value, fallback = DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE) {
  const requested = value === undefined || value === null || String(value).trim() === ""
    ? Number(fallback)
    : Number(value);
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_LEAD_PRICE_PAISE) {
    throw qualificationError("Maximum lead price must be a valid non-negative amount");
  }
  if (requested % PRICE_ROUNDING_PAISE !== 0) {
    throw qualificationError("Maximum lead price must be set in ₹10 increments");
  }
  return requested;
}

function publicQuestions() {
  return QUESTIONS.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: question.options.map((option) => ({ id: option.id, label: option.label })),
  }));
}

function normalizeAnswers(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw qualificationError("Lead qualification answers are required");
  }
  const normalized = {};
  for (const question of QUESTIONS) {
    const answerId = String(input[question.id] || "").trim();
    const option = question.options.find((item) => item.id === answerId);
    if (!option) throw qualificationError(`Select an answer for: ${question.prompt}`);
    normalized[question.id] = answerId;
  }
  return normalized;
}

function answerDetails(answers) {
  return QUESTIONS.map((question) => {
    const option = question.options.find((item) => item.id === answers[question.id]);
    return {
      questionId: question.id,
      question: question.prompt,
      answerId: option.id,
      answer: option.label,
      score: option.score,
    };
  });
}

function weightedScore(answers, weights) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const [questionId, weight] of Object.entries(weights)) {
    const question = QUESTIONS.find((item) => item.id === questionId);
    const option = question?.options.find((item) => item.id === answers[questionId]);
    if (!option) throw qualificationError("Lead qualification answers are incomplete");
    weightedTotal += option.score * weight;
    weightTotal += weight;
  }
  if (!weightTotal) return 0;
  return clamp(Math.round(weightedTotal / weightTotal), 0, 100);
}

function roundScoreToTen(score) {
  return clamp(Math.round(Number(score || 0) / 10) * 10, 0, 100);
}

function roundPricePaiseToTenRupees(value) {
  return Math.round(Number(value || 0) / PRICE_ROUNDING_PAISE) * PRICE_ROUNDING_PAISE;
}

function leadIntentFromScore(score) {
  const value = clamp(Number(score || 0), 0, 100);
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function priorityFromScore(score) {
  const value = clamp(Number(score || 0), 0, 100);
  if (value >= 85) return "urgent";
  if (value >= 70) return "high";
  if (value >= 40) return "normal";
  return "low";
}

function calculateLeadPricePaise(maxLeadPricePaise, roundedPricePercent) {
  const maximum = normalizeCategoryMaxLeadPricePaise(maxLeadPricePaise);
  const percent = clamp(Number(roundedPricePercent || 0), 0, 100);
  const proportional = (maximum * percent) / 100;
  return clamp(roundPricePaiseToTenRupees(proportional), 0, maximum);
}

function calculateQualification(inputAnswers = {}, maxLeadPricePaise = DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE) {
  const answers = normalizeAnswers(inputAnswers);
  const maximum = normalizeCategoryMaxLeadPricePaise(maxLeadPricePaise);
  const priceScorePercent = weightedScore(answers, PRICE_WEIGHTS);
  const roundedPricePercent = roundScoreToTen(priceScorePercent);
  const intentScorePercent = weightedScore(answers, INTENT_WEIGHTS);
  const priorityScorePercent = weightedScore(answers, PRIORITY_WEIGHTS);
  return {
    answers: answerDetails(answers),
    system: {
      priceScorePercent,
      roundedPricePercent,
      categoryMaxLeadPricePaise: maximum,
      leadPricePaise: calculateLeadPricePaise(maximum, roundedPricePercent),
      intentScorePercent,
      leadIntent: leadIntentFromScore(intentScorePercent),
      priorityScorePercent,
      priority: priorityFromScore(priorityScorePercent),
    },
  };
}

function normalizeFinalSelection(input = {}, system = {}) {
  const maxLeadPricePaise = normalizeCategoryMaxLeadPricePaise(system.categoryMaxLeadPricePaise);
  const priceValue = input.leadPricePaise === undefined || input.leadPricePaise === null || input.leadPricePaise === ""
    ? Number(system.leadPricePaise)
    : Number(input.leadPricePaise);
  if (!Number.isInteger(priceValue) || priceValue < 0 || priceValue > maxLeadPricePaise) {
    throw qualificationError("Final lead price must be between ₹0 and the Category maximum lead price");
  }
  if (priceValue % PRICE_ROUNDING_PAISE !== 0) {
    throw qualificationError("Final lead price must be set in ₹10 increments");
  }

  const leadIntent = String(input.leadIntent || system.leadIntent || "").trim().toLowerCase();
  if (!["low", "medium", "high"].includes(leadIntent)) {
    throw qualificationError("Final lead intent must be Low, Medium or High");
  }
  const priority = String(input.priority || system.priority || "").trim().toLowerCase();
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    throw qualificationError("Final lead priority must be Low, Normal, High or Urgent");
  }

  return {
    leadPricePaise: priceValue,
    leadIntent,
    priority,
  };
}

module.exports = {
  DEFAULT_CATEGORY_MAX_LEAD_PRICE_PAISE,
  MAX_LEAD_PRICE_PAISE,
  PRICE_ROUNDING_PAISE,
  QUESTIONS,
  PRICE_WEIGHTS,
  INTENT_WEIGHTS,
  PRIORITY_WEIGHTS,
  publicQuestions,
  normalizeAnswers,
  normalizeCategoryMaxLeadPricePaise,
  weightedScore,
  roundScoreToTen,
  roundPricePaiseToTenRupees,
  leadIntentFromScore,
  priorityFromScore,
  calculateLeadPricePaise,
  calculateQualification,
  normalizeFinalSelection,
};
