const test = require("node:test");
const assert = require("node:assert/strict");

const {
  QUALIFICATION_VERSION,
  QUESTIONS,
  PRICE_WEIGHTS,
  PRICE_RISK_RULES,
  PRICE_RISK_SCORE_SUBSTITUTIONS,
  INTENT_WEIGHTS,
  PRIORITY_WEIGHTS,
  calculateQualification,
  calculatePriceScore,
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
    readiness: 25,
    timeline: 20,
    clarity: 10,
    responsiveness: 20,
    expected_spend: 20,
    genuine_confidence: 5,
  });
  assert.deepEqual(PRICE_RISK_RULES, {
    readiness: { exploring: 60, information_only: 30 },
    responsiveness: { difficult: 50 },
    clarity: { unclear: 60 },
    genuine_confidence: { low: 50 },
  });
  assert.deepEqual(PRICE_RISK_SCORE_SUBSTITUTIONS, {
    readiness: { exploring: "comparing", information_only: "exploring" },
    responsiveness: { difficult: "slow" },
    clarity: { unclear: "partially_clear" },
    genuine_confidence: { low: "medium" },
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
  assert.equal(result.system.priceScorePercent, 84);
  assert.equal(result.system.roundedPricePercent, 80);
  assert.equal(result.system.leadPricePaise, 40000);
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
  assert.equal(result.system.priceScorePercent, 80);
  assert.equal(result.system.roundedPricePercent, 80);
  assert.equal(result.system.leadPricePaise, 40000);
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
  assert.equal(result.system.priceScorePercent, 30);
  assert.equal(result.system.roundedPricePercent, 30);
  assert.equal(result.system.leadPricePaise, 15000);
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
  assert.equal(result.system.priceScorePercent, 60);
  assert.equal(result.system.roundedPricePercent, 60);
  assert.equal(result.system.leadPricePaise, 12000);
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
  assert.equal(result.system.priceScorePercent, 60);
  assert.equal(result.system.roundedPricePercent, 60);
  assert.equal(result.system.intentScorePercent, 74);
  assert.equal(result.system.leadIntent, "medium");
  assert.equal(result.system.priorityScorePercent, 87);
  assert.equal(result.system.priority, "urgent");
});

test("suspicious genuine confidence resets price to twenty percent while intent and priority keep their guardrails", () => {
  const answers = {
    readiness: "ready_now",
    timeline: "within_3_hours",
    clarity: "exact",
    responsiveness: "highly_responsive",
    expected_spend: "above_10000",
    genuine_confidence: "very_low",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 20);
  assert.equal(result.system.roundedPricePercent, 20);
  assert.equal(result.system.leadPricePaise, 10000);
  assert.equal(result.system.intentScorePercent, 44);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 69);
  assert.equal(result.system.priority, "normal");
});

test("weak answers stay low while retaining a non-zero proportional price", () => {
  const result = calculateQualification(weakestAnswers, 20000);
  assert.equal(result.system.priceScorePercent, 20);
  assert.equal(result.system.roundedPricePercent, 20);
  assert.equal(result.system.leadPricePaise, 4000);
  assert.equal(result.system.intentScorePercent, 14);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 16);
  assert.equal(result.system.priority, "low");
});


test("pricing risk states apply one punishment only and the strictest active ceiling wins", () => {
  const singleRisk = {
    readiness: "comparing",
    timeline: "later_or_unsure",
    clarity: "partially_clear",
    responsiveness: "difficult",
    expected_spend: "up_to_800",
    genuine_confidence: "medium",
  };
  assert.equal(calculatePriceScore(singleRisk), 43);

  const multipleRisks = {
    readiness: "exploring",
    timeline: "within_3_hours",
    clarity: "unclear",
    responsiveness: "difficult",
    expected_spend: "above_10000",
    genuine_confidence: "low",
  };
  assert.equal(calculatePriceScore(multipleRisks), 50);
});

test("eleven marketplace pricing scenarios follow the approved risk-adjusted outcomes", () => {
  const scenarios = [
    {
      name: "excellent small job",
      answers: { readiness: "ready_now", timeline: "within_3_days", clarity: "exact", responsiveness: "highly_responsive", expected_spend: "up_to_800", genuine_confidence: "high" },
      priceScorePercent: 79,
      roundedPricePercent: 80,
    },
    {
      name: "huge information-only requirement",
      answers: { readiness: "information_only", timeline: "within_3_hours", clarity: "exact", responsiveness: "highly_responsive", expected_spend: "above_10000", genuine_confidence: "very_high" },
      priceScorePercent: 30,
      roundedPricePercent: 30,
    },
    {
      name: "great answers but difficult to reach",
      answers: { readiness: "ready_now", timeline: "within_3_hours", clarity: "exact", responsiveness: "difficult", expected_spend: "above_10000", genuine_confidence: "high" },
      priceScorePercent: 50,
      roundedPricePercent: 50,
    },
    {
      name: "suspicious despite otherwise perfect answers",
      answers: { readiness: "ready_now", timeline: "within_3_hours", clarity: "exact", responsiveness: "highly_responsive", expected_spend: "above_10000", genuine_confidence: "very_low" },
      priceScorePercent: 20,
      roundedPricePercent: 20,
    },
    {
      name: "exploring despite otherwise perfect answers",
      answers: { readiness: "exploring", timeline: "within_3_hours", clarity: "exact", responsiveness: "highly_responsive", expected_spend: "above_10000", genuine_confidence: "very_high" },
      priceScorePercent: 60,
      roundedPricePercent: 60,
    },
    {
      name: "comparing but strong opportunity",
      answers: { readiness: "comparing", timeline: "within_24_hours", clarity: "mostly_clear", responsiveness: "normally_responsive", expected_spend: "4001_to_10000", genuine_confidence: "high" },
      priceScorePercent: 79,
      roundedPricePercent: 80,
    },
    {
      name: "ready but planned service",
      answers: { readiness: "ready_now", timeline: "within_30_days", clarity: "mostly_clear", responsiveness: "normally_responsive", expected_spend: "2001_to_4000", genuine_confidence: "high" },
      priceScorePercent: 73,
      roundedPricePercent: 70,
    },
    {
      name: "strong opportunity with unclear requirement",
      answers: { readiness: "ready_now", timeline: "within_24_hours", clarity: "unclear", responsiveness: "normally_responsive", expected_spend: "4001_to_10000", genuine_confidence: "high" },
      priceScorePercent: 60,
      roundedPricePercent: 60,
    },
    {
      name: "strong opportunity with low genuine confidence",
      answers: { readiness: "ready_now", timeline: "within_3_days", clarity: "exact", responsiveness: "normally_responsive", expected_spend: "above_10000", genuine_confidence: "low" },
      priceScorePercent: 50,
      roundedPricePercent: 50,
    },
    {
      name: "middling opportunity without hard risk state",
      answers: { readiness: "comparing", timeline: "later_or_unsure", clarity: "partially_clear", responsiveness: "slow", expected_spend: "not_known", genuine_confidence: "medium" },
      priceScorePercent: 45,
      roundedPricePercent: 50,
    },
    {
      name: "multiple risk states use strictest ceiling",
      answers: { readiness: "exploring", timeline: "within_3_hours", clarity: "unclear", responsiveness: "difficult", expected_spend: "above_10000", genuine_confidence: "low" },
      priceScorePercent: 50,
      roundedPricePercent: 50,
    },
  ];

  for (const scenario of scenarios) {
    const result = calculateQualification(scenario.answers, 50000);
    assert.equal(result.system.priceScorePercent, scenario.priceScorePercent, scenario.name);
    assert.equal(result.system.roundedPricePercent, scenario.roundedPricePercent, scenario.name);
    assert.equal(result.system.leadPricePaise, scenario.roundedPricePercent * 500, scenario.name);
  }
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
