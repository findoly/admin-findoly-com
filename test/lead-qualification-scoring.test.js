const test = require("node:test");
const assert = require("node:assert/strict");

const {
  QUALIFICATION_VERSION,
  QUESTIONS,
  PRICE_WEIGHTS,
  INTENT_WEIGHTS,
  PRIORITY_WEIGHTS,
  calculateQualification,
  calculateLeadPricePaise,
  roundScoreToTen,
  normalizeFinalSelection,
} = require("../utils/lead-qualification");

const strongestAnswers = {
  readiness: "ready_now",
  timeline: "within_3_hours",
  clarity: "exact",
  responsiveness: "highly_responsive",
  expected_spend: "above_10000",
  genuine_confidence: "very_high",
};

const weakestAnswers = {
  readiness: "information_only",
  timeline: "later_or_unsure",
  clarity: "unclear",
  responsiveness: "difficult",
  expected_spend: "up_to_800",
  genuine_confidence: "very_low",
};

test("qualification V2 uses exactly six distinct questions with employee-friendly urgency labels", () => {
  assert.equal(QUALIFICATION_VERSION, 2);
  assert.equal(QUESTIONS.length, 6);
  assert.deepEqual(QUESTIONS.map((question) => question.id), [
    "readiness",
    "timeline",
    "clarity",
    "responsiveness",
    "expected_spend",
    "genuine_confidence",
  ]);
  assert.equal(QUESTIONS.some((question) => question.id === "budget"), false);
  assert.equal(QUESTIONS.some((question) => question.id === "requirement_size"), false);

  const urgency = QUESTIONS.find((question) => question.id === "timeline");
  assert.equal(urgency.prompt, "How urgently does the customer need the service?");
  assert.deepEqual(urgency.options.map((option) => [option.id, option.label, option.score]), [
    ["within_3_hours", "Emergency — Within 3 hours", 100],
    ["within_24_hours", "Very urgent — Within 24 hours", 90],
    ["within_3_days", "Urgent — Within 3 days", 75],
    ["within_7_days", "Soon — Within 7 days", 60],
    ["within_30_days", "Planned — Within 30 days", 40],
    ["later_or_unsure", "Flexible — Later or unsure", 20],
  ]);
});

test("expected spend and genuine-confidence choices use the approved score bands", () => {
  const spend = QUESTIONS.find((question) => question.id === "expected_spend");
  assert.equal(spend.prompt, "What is the customer's expected spend for this service?");
  assert.deepEqual(spend.options.map((option) => [option.id, option.score]), [
    ["not_known", 35],
    ["up_to_800", 25],
    ["801_to_2000", 45],
    ["2001_to_4000", 65],
    ["4001_to_10000", 85],
    ["above_10000", 100],
  ]);

  const genuine = QUESTIONS.find((question) => question.id === "genuine_confidence");
  assert.equal(genuine.prompt, "How confident are you that this is a genuine service requirement?");
  assert.deepEqual(genuine.options.map((option) => [option.id, option.score]), [
    ["very_high", 100],
    ["high", 85],
    ["medium", 60],
    ["low", 35],
    ["very_low", 10],
  ]);
});

test("lead price uses the approved provider-value weights while intent and priority remain independent", () => {
  const total = (weights) => Object.values(weights).reduce((sum, value) => sum + value, 0);
  assert.deepEqual(PRICE_WEIGHTS, {
    readiness: 30,
    timeline: 15,
    clarity: 10,
    responsiveness: 20,
    expected_spend: 15,
    genuine_confidence: 10,
  });
  assert.equal(total(PRICE_WEIGHTS), 100);
  assert.equal(total(INTENT_WEIGHTS), 100);
  assert.equal(total(PRIORITY_WEIGHTS), 100);
  assert.equal(Object.prototype.hasOwnProperty.call(INTENT_WEIGHTS, "expected_spend"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(PRIORITY_WEIGHTS, "expected_spend"), false);
});

test("a strongest V2 qualification reaches the category maximum with high intent and urgent priority", () => {
  const result = calculateQualification(strongestAnswers, 15000);
  assert.equal(result.system.priceScorePercent, 100);
  assert.equal(result.system.roundedPricePercent, 100);
  assert.equal(result.system.leadPricePaise, 15000);
  assert.equal(result.system.intentScorePercent, 100);
  assert.equal(result.system.leadIntent, "high");
  assert.equal(result.system.priorityScorePercent, 100);
  assert.equal(result.system.priority, "urgent");
});

test("a strong but non-emergency lead produces independent price, intent and priority outputs", () => {
  const answers = {
    readiness: "ready_now",
    timeline: "within_3_days",
    clarity: "mostly_clear",
    responsiveness: "normally_responsive",
    expected_spend: "4001_to_10000",
    genuine_confidence: "high",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 85);
  assert.equal(result.system.roundedPricePercent, 90);
  assert.equal(result.system.leadPricePaise, 45000);
  assert.equal(result.system.intentScorePercent, 86);
  assert.equal(result.system.leadIntent, "high");
  assert.equal(result.system.priorityScorePercent, 81);
  assert.equal(result.system.priority, "high");
});

test("a ready and responsive smaller-spend customer can still be a high-value lead", () => {
  const answers = {
    readiness: "ready_now",
    timeline: "within_3_days",
    clarity: "exact",
    responsiveness: "highly_responsive",
    expected_spend: "up_to_800",
    genuine_confidence: "very_high",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 85);
  assert.equal(result.system.roundedPricePercent, 90);
  assert.equal(result.system.leadPricePaise, 45000);
});

test("high expected spend cannot dominate a weak customer opportunity", () => {
  const answers = {
    readiness: "information_only",
    timeline: "later_or_unsure",
    clarity: "unclear",
    responsiveness: "difficult",
    expected_spend: "above_10000",
    genuine_confidence: "high",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 35);
  assert.equal(result.system.roundedPricePercent, 40);
  assert.equal(result.system.leadPricePaise, 20000);
});

test("expected spend affects lead price without automatically raising intent or priority", () => {
  const answers = {
    readiness: "exploring",
    timeline: "within_30_days",
    clarity: "partially_clear",
    responsiveness: "slow",
    expected_spend: "above_10000",
    genuine_confidence: "medium",
  };
  const result = calculateQualification(answers, 20000);
  assert.equal(result.system.priceScorePercent, 50);
  assert.equal(result.system.roundedPricePercent, 50);
  assert.equal(result.system.leadPricePaise, 10000);
  assert.equal(result.system.intentScorePercent, 44);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 42);
  assert.equal(result.system.priority, "low");
});

test("exploring customers cannot be classified above medium intent even when other signals are strongest", () => {
  const answers = {
    readiness: "exploring",
    timeline: "within_3_hours",
    clarity: "exact",
    responsiveness: "highly_responsive",
    expected_spend: "above_10000",
    genuine_confidence: "very_high",
  };
  const result = calculateQualification(answers, 10000);
  assert.equal(result.system.intentScorePercent, 74);
  assert.equal(result.system.leadIntent, "medium");
  assert.equal(result.system.priorityScorePercent, 87);
  assert.equal(result.system.priority, "urgent");
});

test("very-low genuine confidence caps price, intent and priority even when all other answers are strongest", () => {
  const answers = {
    readiness: "ready_now",
    timeline: "within_3_hours",
    clarity: "exact",
    responsiveness: "highly_responsive",
    expected_spend: "above_10000",
    genuine_confidence: "very_low",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 40);
  assert.equal(result.system.roundedPricePercent, 40);
  assert.equal(result.system.leadPricePaise, 20000);
  assert.equal(result.system.intentScorePercent, 44);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 69);
  assert.equal(result.system.priority, "normal");
});

test("weak answers stay low while retaining a non-zero proportional price", () => {
  const result = calculateQualification(weakestAnswers, 20000);
  assert.equal(result.system.priceScorePercent, 16);
  assert.equal(result.system.roundedPricePercent, 20);
  assert.equal(result.system.leadPricePaise, 4000);
  assert.equal(result.system.intentScorePercent, 14);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 16);
  assert.equal(result.system.priority, "low");
});

test("score rounding uses the nearest ten percent", () => {
  assert.equal(roundScoreToTen(54), 50);
  assert.equal(roundScoreToTen(55), 60);
  assert.equal(roundScoreToTen(56), 60);
  assert.equal(roundScoreToTen(94), 90);
  assert.equal(roundScoreToTen(95), 100);
});

test("calculated lead price never exceeds the category maximum", () => {
  assert.equal(calculateLeadPricePaise(15000, 100), 15000);
  assert.equal(calculateLeadPricePaise(15000, 60), 9000);
});

test("employee can override final values within the category cap", () => {
  const system = calculateQualification(strongestAnswers, 15000).system;
  const final = normalizeFinalSelection({
    leadPricePaise: 12000,
    leadIntent: "medium",
    priority: "high",
  }, system);
  assert.deepEqual(final, {
    leadPricePaise: 12000,
    leadIntent: "medium",
    priority: "high",
  });
});

test("manual price override cannot exceed the category maximum or bypass ₹10 increments", () => {
  const system = calculateQualification(strongestAnswers, 15000).system;
  assert.throws(
    () => normalizeFinalSelection({ leadPricePaise: 16000, leadIntent: "high", priority: "urgent" }, system),
    /Category maximum lead price/,
  );
  assert.throws(
    () => normalizeFinalSelection({ leadPricePaise: 9550, leadIntent: "high", priority: "urgent" }, system),
    /₹10 increments/,
  );
});
