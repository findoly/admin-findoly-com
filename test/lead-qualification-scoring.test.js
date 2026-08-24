const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
  timeline: "within_24_hours",
  clarity: "exact",
  budget: "confirmed",
  responsiveness: "highly_responsive",
  requirement_size: "very_large",
};

const weakestAnswers = {
  readiness: "information_only",
  timeline: "later_or_unsure",
  clarity: "unclear",
  budget: "not_discussed",
  responsiveness: "difficult",
  requirement_size: "small",
};

test("qualification uses exactly six selectable questions with approved wording", () => {
  assert.equal(QUESTIONS.length, 6);
  assert.equal(QUESTIONS[0].prompt, "How ready is the customer to proceed with the service?");
  const prompts = QUESTIONS.map((question) => question.prompt.toLowerCase()).join(" ");
  assert.equal(prompts.includes("hiring decision"), false);
  assert.equal(prompts.includes("how important is it"), false);
  assert.equal(prompts.includes("hire"), false);
  for (const question of QUESTIONS) {
    assert.equal(question.options.length, 4);
    for (const option of question.options) {
      assert.ok(option.id);
      assert.ok(option.label);
      assert.ok(Number.isInteger(option.score));
    }
  }
});

test("all scoring weight groups total one hundred percent", () => {
  const total = (weights) => Object.values(weights).reduce((sum, value) => sum + value, 0);
  assert.equal(total(PRICE_WEIGHTS), 100);
  assert.equal(total(INTENT_WEIGHTS), 100);
  assert.equal(total(PRIORITY_WEIGHTS), 100);
});

test("a strongest qualification reaches the category maximum", () => {
  const result = calculateQualification(strongestAnswers, 15000);
  assert.equal(result.system.priceScorePercent, 100);
  assert.equal(result.system.roundedPricePercent, 100);
  assert.equal(result.system.leadPricePaise, 15000);
  assert.equal(result.system.intentScorePercent, 100);
  assert.equal(result.system.leadIntent, "high");
  assert.equal(result.system.priorityScorePercent, 100);
  assert.equal(result.system.priority, "urgent");
});

test("a 56 percent price score rounds to 60 percent and prices a ₹150 maximum at ₹90", () => {
  const answers = {
    readiness: "ready_now",
    timeline: "within_24_hours",
    clarity: "partially_clear",
    budget: "not_discussed",
    responsiveness: "slow",
    requirement_size: "small",
  };
  const result = calculateQualification(answers, 15000);
  assert.equal(result.system.priceScorePercent, 56);
  assert.equal(result.system.roundedPricePercent, 60);
  assert.equal(result.system.leadPricePaise, 9000);
  assert.equal(result.system.intentScorePercent, 67);
  assert.equal(result.system.leadIntent, "medium");
  assert.equal(result.system.priorityScorePercent, 100);
  assert.equal(result.system.priority, "urgent");
});

test("price, intent and priority remain independent outputs from the same answers", () => {
  const answers = {
    readiness: "comparing",
    timeline: "within_7_days",
    clarity: "mostly_clear",
    budget: "range_known",
    responsiveness: "normally_responsive",
    requirement_size: "medium",
  };
  const result = calculateQualification(answers, 50000);
  assert.equal(result.system.priceScorePercent, 71);
  assert.equal(result.system.roundedPricePercent, 70);
  assert.equal(result.system.leadPricePaise, 35000);
  assert.equal(result.system.intentScorePercent, 75);
  assert.equal(result.system.leadIntent, "high");
  assert.equal(result.system.priorityScorePercent, 77);
  assert.equal(result.system.priority, "high");
});

test("weak answers stay low while retaining a non-zero proportional price", () => {
  const result = calculateQualification(weakestAnswers, 20000);
  assert.equal(result.system.priceScorePercent, 19);
  assert.equal(result.system.roundedPricePercent, 20);
  assert.equal(result.system.leadPricePaise, 4000);
  assert.equal(result.system.intentScorePercent, 16);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 21);
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
