const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("category model exposes a maximum lead price cap", () => {
  const model = source("models/Category.js");
  assert.match(model, /maxLeadPricePaise:\s*\{\s*type:\s*Number,\s*default:\s*10000/);
});

test("enquiry routes expose qualification read, preview and save actions", () => {
  const routes = source("routes/enquiry.js");
  assert.match(routes, /\/:enquiryId\/qualification".*,\s*c\.qualification\)/);
  assert.match(routes, /\/:enquiryId\/qualification\/preview".*,\s*c\.qualificationPreview\)/);
  assert.match(routes, /\/:enquiryId\/qualification".*,\s*c\.saveQualification\)/);
});

test("enquiry controller gates forward journey and protected direct edits", () => {
  const controller = source("controllers/enquiryController.js");
  assert.match(controller, /assertJourneyTransitionAllowed\(req\.params\.enquiryId,\s*req\.body\)/);
  assert.match(controller, /assertDirectLeadValueEditAllowed\(\s*req\.params\.enquiryId,\s*req\.body/);
});

test("lead action centre inserts qualification between validation and journey", () => {
  const view = source("views/enquiry/show.ejs");
  const validation = view.indexOf("<h3>Lead validation</h3>");
  const qualification = view.indexOf("<h3>Lead qualification</h3>");
  const journey = view.indexOf("<h3>Journey status</h3>");
  const conversion = view.indexOf("<h3>Sale conversion</h3>");
  assert.ok(validation >= 0);
  assert.ok(qualification > validation);
  assert.ok(journey > qualification);
  assert.ok(conversion > journey);
  assert.match(view, /qualificationAnswersComplete/);
  assert.match(view, /Complete lead qualification before moving the journey forward/);
  assert.match(view, /System values are suggestions/);
});

test("qualification UI rehydrates saved answers after dynamic options render", () => {
  const view = source("views/enquiry/show.ejs");
  assert.match(view, /const savedAnswers = \{ \.\.\.\(data\.answers \|\| \{\}\) \};/);
  assert.match(view, /this\.qualificationAnswers = \{ \.\.\.savedAnswers \};/);
  assert.match(view, /this\.\$nextTick\(\(\) => \{\s*this\.qualificationAnswers = \{ \.\.\.savedAnswers \};\s*\}\);/);
});

test("qualification service preserves system and final values with audit history", () => {
  const service = source("services/lead-qualification/lead-qualification-service.js");
  assert.match(service, /leadQualification:\s*snapshot/);
  assert.match(service, /leadQualificationHistory/);
  assert.match(service, /system:\s*calculated\.system/);
  assert.match(service, /final,/);
  assert.match(service, /completedBy/);
  assert.match(service, /leadPricePaise:\s*final\.leadPricePaise/);
  assert.match(service, /leadIntent:\s*final\.leadIntent/);
  assert.match(service, /priority:\s*final\.priority/);
  assert.match(service, /LEAD_QUALIFICATION_LOCKED/);
});

test("category UI configures the maximum lead price in ₹10 increments", () => {
  const view = source("views/category/index.ejs");
  assert.match(view, /Maximum lead price \(₹\)/);
  assert.match(view, /step="10"[^>]*x-model\.number="form\.maxLeadPriceRupees"/);
  assert.match(view, /maxLeadPricePaise:\s*maxLeadPriceRupees \* 100/);
});
