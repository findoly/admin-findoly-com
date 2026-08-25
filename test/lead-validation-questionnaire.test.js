const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VALIDATION_QUESTIONS,
  evaluateValidation,
} = require("../utils/lead-validation");

const validAnswers = {
  requirement_confirmed: "yes",
  contact_verification: "verified",
  category_match: "yes",
  duplicate_requirement: "no",
  current_interest: "wants_service",
};

test("lead validation uses exactly five selectable questions", () => {
  assert.equal(VALIDATION_QUESTIONS.length, 5);
  for (const question of VALIDATION_QUESTIONS) {
    assert.ok(question.id);
    assert.ok(question.prompt);
    assert.ok(question.options.length >= 2);
    for (const option of question.options) {
      assert.ok(option.id);
      assert.ok(option.label);
    }
  }
});

test("clear genuine requirement is automatically valid", () => {
  const result = evaluateValidation(validAnswers);
  assert.equal(result.system.decision, "valid");
  assert.equal(result.system.invalidReason, "");
});

test("customer not decided yet remains valid", () => {
  const result = evaluateValidation({ ...validAnswers, current_interest: "not_decided" });
  assert.equal(result.system.decision, "valid");
});

test("customer who does not want the service is invalid", () => {
  const result = evaluateValidation({ ...validAnswers, current_interest: "does_not_want" });
  assert.equal(result.system.decision, "invalid");
  assert.equal(result.system.invalidReason, "customer_not_interested");
});

test("incorrect contact details are invalid", () => {
  const result = evaluateValidation({ ...validAnswers, contact_verification: "incorrect" });
  assert.equal(result.system.decision, "invalid");
  assert.equal(result.system.invalidReason, "incorrect_details");
});

test("unable to verify requires employee review instead of automatic rejection", () => {
  const result = evaluateValidation({ ...validAnswers, contact_verification: "unable_to_verify" });
  assert.equal(result.system.decision, "needs_review");
  assert.match(result.system.reasons.join(" "), /could not be verified/i);
});

test("duplicate active requirement is invalid", () => {
  const result = evaluateValidation({ ...validAnswers, duplicate_requirement: "yes" });
  assert.equal(result.system.decision, "invalid");
  assert.equal(result.system.invalidReason, "duplicate");
});

test("wrong category is invalid", () => {
  const result = evaluateValidation({ ...validAnswers, category_match: "no" });
  assert.equal(result.system.decision, "invalid");
  assert.equal(result.system.invalidReason, "outside_assigned_category");
});

test("unconfirmed ownership is invalid", () => {
  const result = evaluateValidation({ ...validAnswers, requirement_confirmed: "no" });
  assert.equal(result.system.decision, "invalid");
  assert.equal(result.system.invalidReason, "other");
});

test("all answers are mandatory", () => {
  assert.throws(
    () => evaluateValidation({ ...validAnswers, current_interest: "" }),
    /Select an answer for/,
  );
});
