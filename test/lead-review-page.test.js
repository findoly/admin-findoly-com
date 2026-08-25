const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("frontend exposes read-only review routes for both requirement aliases", () => {
  const routes = source("routes/frontend.js");
  assert.match(routes, /\/enquiries\/:enquiryId\/review".*page\.enquiryReview/);
  assert.match(routes, /\/requirements\/:enquiryId\/review".*page\.enquiryReview/);

  const controller = source("controllers/frontendController.js");
  assert.match(controller, /enquiryReview:\s*render\("enquiry\/review",\s*"Validation & qualification review"\)/);
});

test("requirement detail links saved review data to the separate page", () => {
  const view = source("views/enquiry/show.ejs");
  assert.match(view, /View validation & qualification/);
  assert.match(view, /recordId\+'\/review'/);
  assert.match(view, /agentReferralValidation/);
  assert.match(view, /qualificationComplete/);
});

test("review page reads existing validation and qualification data without write actions", () => {
  const view = source("views/enquiry/review.ejs");
  assert.match(view, /\/validation'/);
  assert.match(view, /\/qualification'/);
  assert.match(view, /System decision/);
  assert.match(view, /Final decision/);
  assert.match(view, /System calculation/);
  assert.match(view, /Final qualification/);
  assert.match(view, /answerLabel\(question, validation\.answers\)/);
  assert.match(view, /answerLabel\(question, qualification\.answers\)/);
  assert.doesNotMatch(view, /method:\s*['"]POST['"]/);
});
