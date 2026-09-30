const test = require("node:test");
const assert = require("node:assert/strict");

const {
  QUALIFICATION_VERSION,
  QUESTIONS,
  INTENT_WEIGHTS,
  PRIORITY_WEIGHTS,
  calculateQualification,
  calculatePriceScore,
  calculateLeadPricePaise,
  normalizeCategoryMaxLeadPricePaise,
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

test("qualification V3 keeps the existing six questions", () => {
  assert.equal(QUALIFICATION_VERSION, 3);
  assert.equal(QUESTIONS.length, 6);
  assert.deepEqual(QUESTIONS.map((question) => question.id), [
    "readiness",
    "timeline",
    "clarity",
    "responsiveness",
    "expected_spend",
    "genuine_confidence",
  ]);
});

test("intent and priority scoring remain independent of expected spend", () => {
  const total = (weights) => Object.values(weights).reduce((sum, value) => sum + value, 0);
  assert.equal(total(INTENT_WEIGHTS), 100);
  assert.equal(total(PRIORITY_WEIGHTS), 100);
  assert.equal(Object.prototype.hasOwnProperty.call(INTENT_WEIGHTS, "expected_spend"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(PRIORITY_WEIGHTS, "expected_spend"), false);
});

test("strong qualification always uses the configured Category lead price", () => {
  const result = calculateQualification(strongestAnswers, 15000);
  assert.equal(result.system.categoryMaxLeadPricePaise, 15000);
  assert.equal(result.system.leadPricePaise, 15000);
  assert.equal(result.system.intentScorePercent, 100);
  assert.equal(result.system.leadIntent, "high");
  assert.equal(result.system.priorityScorePercent, 100);
  assert.equal(result.system.priority, "urgent");
  assert.equal(Object.prototype.hasOwnProperty.call(result.system, "priceScorePercent"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.system, "roundedPricePercent"), false);
});

test("weak qualification cannot reduce the Category lead price", () => {
  const result = calculateQualification(weakestAnswers, 20000);
  assert.equal(result.system.categoryMaxLeadPricePaise, 20000);
  assert.equal(result.system.leadPricePaise, 20000);
  assert.equal(result.system.intentScorePercent, 14);
  assert.equal(result.system.leadIntent, "low");
  assert.equal(result.system.priorityScorePercent, 16);
  assert.equal(result.system.priority, "low");
});

test("qualification answer changes never change the lead price", () => {
  const lowSpend = calculateQualification({
    ...strongestAnswers,
    expected_spend: "up_to_800",
  }, 50000);
  const highSpend = calculateQualification({
    ...strongestAnswers,
    expected_spend: "above_10000",
  }, 50000);
  assert.equal(lowSpend.system.leadPricePaise, 50000);
  assert.equal(highSpend.system.leadPricePaise, 50000);
});

test("exploring and suspicious answers still apply the existing intent and priority guardrails", () => {
  const exploring = calculateQualification({
    ...strongestAnswers,
    readiness: "exploring",
  }, 10000);
  assert.equal(exploring.system.leadPricePaise, 10000);
  assert.equal(exploring.system.leadIntent, "medium");
  assert.equal(exploring.system.priority, "urgent");

  const suspicious = calculateQualification({
    ...strongestAnswers,
    genuine_confidence: "very_low",
  }, 50000);
  assert.equal(suspicious.system.leadPricePaise, 50000);
  assert.equal(suspicious.system.leadIntent, "low");
  assert.equal(suspicious.system.priority, "normal");
});

test("legacy pricing helpers remain compatible but are no longer used by qualification price", () => {
  const legacyScore = calculatePriceScore({
    readiness: "comparing",
    timeline: "later_or_unsure",
    clarity: "partially_clear",
    responsiveness: "difficult",
    expected_spend: "up_to_800",
    genuine_confidence: "medium",
  });
  assert.equal(legacyScore, 43);
  assert.equal(calculateLeadPricePaise(15000, 60), 9000);
});

test("employee price override is ignored and Category price wins", () => {
  const system = calculateQualification(strongestAnswers, 15000).system;
  const final = normalizeFinalSelection({
    leadPricePaise: 1000,
    leadIntent: "medium",
    priority: "high",
  }, system);
  assert.deepEqual(final, {
    leadPricePaise: 15000,
    leadIntent: "medium",
    priority: "high",
  });
});

test("final intent and priority remain validated", () => {
  const system = calculateQualification(strongestAnswers, 15000).system;
  assert.throws(
    () => normalizeFinalSelection({ leadIntent: "invalid", priority: "high" }, system),
    /Final lead intent/,
  );
  assert.throws(
    () => normalizeFinalSelection({ leadIntent: "high", priority: "invalid" }, system),
    /Final lead priority/,
  );
});

test("Category lead price validation still uses ₹10 increments", () => {
  assert.equal(normalizeCategoryMaxLeadPricePaise(15000), 15000);
  assert.throws(() => normalizeCategoryMaxLeadPricePaise(15550), /₹10 increments/);
});
