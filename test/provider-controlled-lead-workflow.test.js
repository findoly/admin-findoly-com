const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.SKIP_DB = "true";

const Enquiry = require("../models/Enquiry");
const LeadDistribution = require("../models/LeadDistribution");
const notificationService = require("../services/communication/notification-service");
const providerStatusService = require("../services/distribution/provider-status-service");
const payoutService = require("../services/partner-payout/partner-payout-service");
const { providerStatusFromEvent, providerOutcomeFromEvent } = require("../utils/provider-lead-status");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function queryResult(value) {
  return { lean: async () => value };
}

function confirmedQuery(rows) {
  return {
    sort() { return this; },
    select() { return this; },
    lean: async () => rows,
  };
}

async function withPatches(patches, run) {
  const originals = [];
  for (const [target, key, replacement] of patches) {
    originals.push([target, key, target[key]]);
    target[key] = replacement;
  }
  try {
    return await run();
  } finally {
    for (const [target, key, original] of originals.reverse()) target[key] = original;
  }
}

test("provider events separate mandatory sale outcome from optional activity status", () => {
  assert.equal(providerOutcomeFromEvent("provider_confirmed"), "confirmed");
  assert.equal(providerOutcomeFromEvent("provider_not_confirmed"), "not_confirmed");
  assert.equal(providerStatusFromEvent("provider_confirmed"), "");
  assert.equal(providerStatusFromEvent("provider_rejected"), "rejected");
  assert.equal(providerStatusFromEvent("provider_invalid"), "invalid");
  assert.equal(providerStatusFromEvent("provider-status", "on_hold"), "on_hold");
  assert.equal(providerStatusFromEvent("unknown", "unknown"), "");
});

test("one current provider confirmation converts a distributed lead", async () => {
  const lead = {
    enquiryId: "lead-1",
    status: "distributed",
    agentId: "agent-1",
    agentSaleConversion: "pending",
    providerConfirmedCount: 0,
    providerSaleConversionStatus: "pending",
  };
  const confirmed = {
    leadDistributionId: "distribution-1",
    providerId: "provider-1",
    providerName: "Provider One",
    providerBusinessName: "Provider One Services",
    providerLeadStatusUpdatedAt: new Date(),
  };
  let enquiryReads = 0;
  let capturedUpdate;

  await withPatches([
    [Enquiry, "findOne", () => queryResult(enquiryReads++ === 0 ? lead : { ...lead, status: "sale_converted", providerConfirmedCount: 1 })],
    [Enquiry, "updateOne", async (_query, update) => { capturedUpdate = update; return { matchedCount: 1, modifiedCount: 1 }; }],
    [LeadDistribution, "find", () => confirmedQuery([confirmed])],
    [notificationService, "trigger", async () => []],
  ], async () => {
    const result = await providerStatusService.syncSaleConversion("lead-1", {
      actor: "provider:provider-1",
      triggerDistribution: confirmed,
    });
    assert.equal(result.changed, true);
    assert.equal(result.confirmedCount, 1);
  });

  assert.equal(capturedUpdate.$set.status, "sale_converted");
  assert.equal(capturedUpdate.$set.providerConfirmedCount, 1);
  assert.equal(capturedUpdate.$set.agentSaleConversion, "converted");
  assert.equal(capturedUpdate.$push.timeline.type, "provider_sale_conversion");
});

test("sale conversion stays converted while any other provider remains confirmed", async () => {
  const lead = {
    enquiryId: "lead-2",
    status: "sale_converted",
    providerConfirmedCount: 1,
    providerSaleConversionStatus: "converted",
    providerSaleConversionProviderId: "provider-2",
    providerSaleConversionProviderName: "Provider Two",
  };
  const confirmed = {
    providerId: "provider-2",
    providerName: "Provider Two",
  };
  let updateCalled = false;

  await withPatches([
    [Enquiry, "findOne", () => queryResult(lead)],
    [Enquiry, "updateOne", async () => { updateCalled = true; }],
    [LeadDistribution, "find", () => confirmedQuery([confirmed])],
  ], async () => {
    const result = await providerStatusService.syncSaleConversion("lead-2", { notify: false });
    assert.equal(result.changed, false);
    assert.equal(result.status, "sale_converted");
  });

  assert.equal(updateCalled, false);
});

test("removing the last current confirmation reverts sale converted to distributed", async () => {
  const lead = {
    enquiryId: "lead-3",
    status: "sale_converted",
    agentId: "agent-3",
    agentSaleConversion: "converted",
    providerConfirmedCount: 1,
    providerSaleConversionStatus: "converted",
    providerSaleConversionProviderId: "provider-3",
    providerSaleConversionProviderName: "Provider Three",
  };
  let enquiryReads = 0;
  let capturedUpdate;

  await withPatches([
    [Enquiry, "findOne", () => queryResult(enquiryReads++ === 0 ? lead : { ...lead, status: "distributed", providerConfirmedCount: 0 })],
    [Enquiry, "updateOne", async (_query, update) => { capturedUpdate = update; return { matchedCount: 1, modifiedCount: 1 }; }],
    [LeadDistribution, "find", () => confirmedQuery([])],
    [notificationService, "trigger", async () => []],
  ], async () => {
    const result = await providerStatusService.syncSaleConversion("lead-3", {
      actor: "provider:provider-3",
      triggerDistribution: { providerId: "provider-3", providerName: "Provider Three" },
    });
    assert.equal(result.changed, true);
    assert.equal(result.confirmedCount, 0);
  });

  assert.equal(capturedUpdate.$set.status, "distributed");
  assert.equal(capturedUpdate.$set.agentSaleConversion, "not_converted");
  assert.equal(capturedUpdate.$push.timeline.type, "provider_sale_conversion_reverted");
});

test("marking any lead invalid automatically rejects it before distribution", async () => {
  const row = {
    enquiryId: "lead-4",
    status: "verification",
    agentId: "agent-4",
    sourceChannel: "agent",
    createdAt: new Date(),
    metadata: {},
    partnerPayoutStatus: "waiting_period",
  };
  let capturedUpdate;
  let reads = 0;

  await withPatches([
    [Enquiry, "findOne", () => queryResult(reads++ === 0 ? row : { ...row, status: "rejected", agentReferralValidation: "invalid" })],
    [Enquiry, "updateOne", async (_query, update) => { capturedUpdate = update; return { matchedCount: 1, modifiedCount: 1 }; }],
    [LeadDistribution, "updateMany", async () => ({ modifiedCount: 0 })],
  ], async () => {
    await payoutService.updateReferralValidation("lead-4", {
      status: "invalid",
      method: "phone_call",
      reason: "incorrect_details",
      note: "Customer details do not match",
    }, "employee:test");
  });

  assert.equal(capturedUpdate.$set.status, "rejected");
  assert.equal(capturedUpdate.$set.agentReferralValidation, "invalid");
  assert.equal(capturedUpdate.$set.leadValidationMethod, "phone_call");
  assert.equal(capturedUpdate.$set.metadata.rejectedFromStatus, "verification");
  assert.equal(capturedUpdate.$push.timeline.$each.length, 2);
});

test("internal leads can be marked valid without agent payout fields", async () => {
  const row = {
    enquiryId: "lead-internal-1",
    status: "new",
    sourceChannel: "admin",
    createdAt: new Date(),
    metadata: {},
  };
  let capturedUpdate;

  await withPatches([
    [Enquiry, "findOne", () => queryResult(row)],
    [Enquiry, "updateOne", async (_query, update) => { capturedUpdate = update; return { matchedCount: 1, modifiedCount: 1 }; }],
  ], async () => {
    await payoutService.updateReferralValidation("lead-internal-1", {
      status: "valid",
      method: "whatsapp",
      note: "",
    }, "employee:test");
  });

  assert.equal(capturedUpdate.$set.agentReferralValidation, "valid");
  assert.equal(capturedUpdate.$set.leadValidationMethod, "whatsapp");
  assert.equal(capturedUpdate.$set.partnerPayoutStatus, undefined);
  assert.equal(capturedUpdate.$push.timeline.$each[0].type, "lead_validation");
});

test("Other validation method requires an explanation", async () => {
  await assert.rejects(
    payoutService.updateReferralValidation("lead-any", {
      status: "valid",
      method: "other",
      note: "",
    }, "employee:test"),
    /Other validation details is required/,
  );
});

test("lead page uses viewport toasts and removes employee sale-conversion controls", () => {
  const view = source("views/enquiry/show.ejs");
  const sharedScripts = source("views/partials/scripts.ejs");
  assert.match(sharedScripts, /function showCrmToast/);
  assert.match(view, /Lead action centre/);
  assert.match(view, /Lead validation/);
  assert.match(view, /Select how the lead was validated/);
  assert.match(view, /Phone call/);
  assert.match(view, /WhatsApp/);
  assert.doesNotMatch(view, />Deactivate<\/button>/);
  assert.match(view, /Provider confirmation controls Sale Converted/);
  assert.match(view, /showCrmToast/);
  assert.doesNotMatch(view, /saveSaleConversion/);
  assert.doesNotMatch(view, /Save conversion/);
  assert.ok(view.indexOf("Lead action centre") < view.indexOf("CRM lead journey"));
});

test("manual employee sale conversion endpoint remains explicitly blocked", () => {
  const service = source("services/enquiry/enquiry-service.js");
  assert.match(service, /Sale conversion is provider-controlled/);
  assert.match(service, /status: 405/);
});
