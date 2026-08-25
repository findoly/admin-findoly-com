"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function loadWithStubs(relativePath, stubs) {
  const absolute = require.resolve(path.join(root, relativePath));
  delete require.cache[absolute];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(absolute);
  } finally {
    Module._load = originalLoad;
    delete require.cache[absolute];
  }
}

function actionService() {
  return loadWithStubs("services/communication/provider-whatsapp-action-service.js", {
    "../../models/Communication": {},
    "../../models/Enquiry": {},
    "./communication-service": {},
    "../integration/provider-action-service": {},
  });
}

test("rejected leads lock qualification until Restore previous is used", () => {
  const page = source("views/enquiry/show.ejs");
  const qualificationService = source("services/lead-qualification/lead-qualification-service.js");

  assert.match(page, /'is-required': validationReady && !qualificationComplete && !providerControlled && !isRejected/);
  assert.match(page, /'is-locked': !validationReady \|\| providerControlled \|\| isRejected/);
  assert.match(page, /Restore the rejected lead first/);
  assert.match(page, /x-show="validationReady && !providerControlled && !isRejected"/);
  assert.match(page, /qualificationPreviewing \|\| this\.providerControlled \|\| this\.isRejected/);
  assert.match(page, /Restore the rejected lead before completing qualification\./);
  assert.match(qualificationService, /Restore the rejected lead before completing qualification/);
});

test("manual Reject lead action requires a confirmation after the rejection note", () => {
  const page = source("views/enquiry/show.ejs");
  const noteGuard = page.indexOf("Enter a rejection reason before rejecting the lead.");
  const confirmation = page.indexOf("Reject this lead?\\n\\nThis will move the requirement to Rejected and make it unavailable to providers.");
  const request = page.indexOf("'/api/enquiry/' + this.recordId + '/status'");

  assert.ok(noteGuard >= 0, "rejection note guard must remain present");
  assert.ok(confirmation > noteGuard, "confirmation must run after validating the rejection note");
  assert.ok(request > confirmation, "status API request must only run after confirmation");
});

test("provider WhatsApp success message gives useful qualification context without budget, requirement or enquiry reference", () => {
  const service = actionService();
  const context = service.messageContextFromLead({
    leadIntent: "high",
    priority: "urgent",
    leadQualification: {
      completed: true,
      answers: [
        { questionId: "readiness", answerId: "ready_now", answer: "Ready to proceed now" },
        { questionId: "timeline", answerId: "within_7_days", answer: "Within 7 days" },
        { questionId: "clarity", answerId: "mostly_clear", answer: "Mostly clear" },
        { questionId: "budget", answerId: "confirmed", answer: "Budget confirmed" },
        { questionId: "responsiveness", answerId: "normally_responsive", answer: "Normally responsive" },
        { questionId: "requirement_size", answerId: "medium", answer: "Medium" },
      ],
      final: { leadIntent: "high", priority: "urgent", leadPricePaise: 10000 },
    },
  });

  assert.deepEqual(context.qualification.map((item) => item.id), [
    "readiness",
    "timeline",
    "clarity",
    "responsiveness",
    "requirement_size",
  ]);

  const message = service.successMessage({
    status: "unlocked",
    lead: {
      enquiryId: "internal-enquiry-reference",
      serviceType: "AC Repair",
      customerName: "Test Customer",
      customerMobile: "9876543210",
      customerEmail: "customer@example.com",
      customerAddress: "Bhandup West",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400078",
      leadTitle: "This customer requirement must not be sent",
      chargedCredits: 100,
    },
    provider: { availableCredits: 1199 },
    messageContext: context,
  });

  assert.match(message, /Enquiry unlocked successfully\./);
  assert.match(message, /Readiness: Ready to proceed now/);
  assert.match(message, /Service timeline: Within 7 days/);
  assert.match(message, /Requirement clarity: Mostly clear/);
  assert.match(message, /Responsiveness: Normally responsive/);
  assert.match(message, /Requirement size: Medium/);
  assert.match(message, /Lead quality: High intent · Urgent priority/);
  assert.match(message, /Credits used: 100/);
  assert.match(message, /Remaining balance: 1199 credits/);
  assert.doesNotMatch(message, /Budget/i);
  assert.doesNotMatch(message, /^Requirement:/m);
  assert.doesNotMatch(message, /Enquiry reference/i);
  assert.doesNotMatch(message, /internal-enquiry-reference/);
  assert.doesNotMatch(message, /This customer requirement must not be sent/);
});

test("legacy unlocked leads without qualification still receive a clean basic WhatsApp response", () => {
  const service = actionService();
  const message = service.successMessage({
    status: "already_unlocked",
    lead: {
      serviceType: "Plumbing",
      customerName: "Test Customer",
      customerMobile: "9876543210",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      chargedCredits: 0,
    },
    provider: { walletCredits: 250 },
  });

  assert.match(message, /This enquiry is already available in your account\./);
  assert.match(message, /Service: Plumbing/);
  assert.match(message, /Customer: Test Customer/);
  assert.doesNotMatch(message, /Lead details/);
  assert.doesNotMatch(message, /Lead quality:/);
  assert.doesNotMatch(message, /Enquiry reference/i);
});

test("max-provider closure uses positive lead-quality wording instead of an expiry message", () => {
  const service = actionService();
  const message = service.failureMessage({
    status: "lead_unavailable",
    messageContext: {
      marketplaceClosureReason: "unlock_limit",
      remainingUnlocks: 0,
      providerConfirmedCount: 0,
      providerSaleConversionStatus: "pending",
    },
  });

  assert.match(message, /received enough provider interest/i);
  assert.match(message, /lead quality and customer experience/i);
  assert.match(message, /may already be progressing/i);
  assert.doesNotMatch(message, /expired/i);
});

test("confirmed unavailable enquiry uses the stronger confirmed message", () => {
  const service = actionService();
  const message = service.failureMessage({
    status: "lead_unavailable",
    messageContext: {
      marketplaceClosureReason: "unlock_limit",
      remainingUnlocks: 0,
      providerConfirmedCount: 1,
      providerSaleConversionStatus: "converted",
    },
  });

  assert.equal(message, "This enquiry has already been confirmed with a provider and is no longer available.");
});
