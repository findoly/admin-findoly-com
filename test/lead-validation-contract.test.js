const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("validation routes expose read and server-side preview actions", () => {
  const routes = source("routes/enquiry.js");
  assert.match(routes, /\/:enquiryId\/validation".*,\s*c\.validation\)/);
  assert.match(routes, /\/:enquiryId\/validation\/preview".*,\s*c\.validationPreview\)/);
  assert.match(routes, /\/:enquiryId\/referral-validation".*,\s*c\.referralValidation\)/);
});

test("validation controller saves through the questionnaire decision service", () => {
  const controller = source("controllers/enquiryController.js");
  assert.match(controller, /leadValidationService\.saveValidation/);
  assert.match(controller, /leadValidationService\.previewValidation/);
  assert.match(controller, /leadValidationService\.getValidation/);
});

test("system validation is recalculated on the server and final decisions are audited", () => {
  const service = source("services/lead-validation/lead-validation-service.js");
  assert.match(service, /evaluateValidation\(input\.answers \|\| \{\}\)/);
  assert.match(service, /finalDecision !== calculated\.system\.decision/);
  assert.match(service, /overrideReason/);
  assert.match(service, /leadValidationDecision:\s*snapshot/);
  assert.match(service, /leadValidationDecisionHistory/);
  assert.match(service, /partnerPayoutService\.updateReferralValidation/);
  assert.match(service, /LEAD_VALIDATION_LOCKED/);
});

test("qualification cannot bypass the completed validation questionnaire", () => {
  const qualification = source("services/lead-qualification/lead-qualification-service.js");
  assert.match(qualification, /leadValidationDecision/);
  assert.match(qualification, /leadValidationDecision\.final\?\.decision === "valid"/);
  assert.match(qualification, /LEAD_VALIDATION_QUESTIONNAIRE_REQUIRED/);
  assert.match(qualification, /isValidationQuestionnaireComplete\(lead\)/);
});

test("lead detail runtime mounts the questionnaire and visibly gates qualification", () => {
  const runtime = source("public/js/crm-ui-runtime.js");
  const ui = source("public/js/lead-validation-ui.js");
  assert.match(runtime, /lead-validation-ui\.js/);
  assert.match(ui, /Complete the validation questionnaire first/);
  assert.match(ui, /syncQualificationGate\(validation\)/);
  assert.match(ui, /Final employee decision/);
  assert.match(ui, /Override reason/);
});

test("validation questionnaire supports both enquiry and requirement detail aliases", () => {
  const runtime = source("public/js/crm-ui-runtime.js");
  const ui = source("public/js/lead-validation-ui.js");
  const head = source("views/partials/head.ejs");
  assert.match(runtime, /\(\?:enquiries\|requirements\)/);
  assert.match(ui, /\(\?:enquiries\|requirements\)/);
  assert.match(head, /crm-ui-runtime\.js\?v=20260825-1/);
});

test("approved validation wording and selectable customer-interest answers remain fixed", () => {
  const validation = source("utils/lead-validation.js");
  assert.match(validation, /After speaking with the customer, what is their current interest in getting this service\?/);
  assert.match(validation, /Wants the service/);
  assert.match(validation, /Not decided yet/);
  assert.match(validation, /Does not want the service/);
});
