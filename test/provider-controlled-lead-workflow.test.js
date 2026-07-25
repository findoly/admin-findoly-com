const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { providerStatusFromEvent, providerOutcomeFromEvent } = require("../utils/provider-lead-status");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("provider events separate mandatory sale outcome from optional activity status", () => {
  assert.equal(providerOutcomeFromEvent("provider_confirmed"), "confirmed");
  assert.equal(providerOutcomeFromEvent("provider_not_confirmed"), "not_confirmed");
  assert.equal(providerStatusFromEvent("provider_confirmed"), "");
  assert.equal(providerStatusFromEvent("provider_rejected"), "rejected");
  assert.equal(providerStatusFromEvent("provider_invalid"), "invalid");
  assert.equal(providerStatusFromEvent("provider-status", "on_hold"), "on_hold");
});

test("provider outcomes are stored on compact unlock records and denormalized lead counters", () => {
  const unlockModel = source("models/ProviderLeadUnlock.js");
  const providerService = source("services/provider-unlock/provider-status-service.js");
  const enquiry = source("models/Enquiry.js");
  assert.match(unlockModel, /providerSaleOutcome/);
  assert.match(unlockModel, /providerLeadStatus/);
  assert.match(enquiry, /providerConfirmedCount/);
  assert.match(enquiry, /providerSaleConversionStatus/);
  assert.match(providerService, /ProviderLeadUnlock/);
  assert.doesNotMatch(providerService, /LeadDistribution|\.aggregate\s*\(/);
});

test("CRM journey remains approved while provider conversion is tracked separately", () => {
  const journey = source("utils/lead-journey.js");
  const service = source("services/enquiry/enquiry-service.js");
  assert.match(journey, /"new",[\s\S]*"verification",[\s\S]*"approved"/);
  assert.doesNotMatch(journey, /"distributed"|"sale_converted"/);
  assert.match(service, /providerSaleConversionStatus/);
  assert.match(service, /Lead automatically published to the Provider Marketplace/);
});

test("invalid leads are rejected and marketplace visibility is closed without relationship updates", () => {
  const payout = source("services/partner-payout/partner-payout-service.js");
  const enquiryService = source("services/enquiry/enquiry-service.js");
  assert.match(payout, /agentReferralValidation/);
  assert.match(enquiryService, /marketplaceAvailable:\s*false/);
  assert.doesNotMatch(payout, /LeadDistribution|updateMany\([^)]*distribution/i);
});

test("lead page exposes provider unlock journeys without employee sale conversion controls", () => {
  const view = source("views/enquiry/show.ejs");
  assert.match(view, /providerJourney/);
  assert.match(view, /Provider status|unlocked providers/i);
  assert.doesNotMatch(view, /updateAgentSaleConversion|Mark sale converted/);
});
