"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function compileCreditRefund() {
  const filename = path.join(root, "services/provider/provider-credit-service.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));

  let balance = 5000;
  const allocations = [];
  const transactions = [];
  const provider = {
    _id: "provider-db-1",
    providerId: "provider-1",
    id: "provider-1",
    walletBalancePaise: balance,
    walletUpdatedAt: new Date(),
    updatedAt: new Date(),
  };
  const queryWithSession = (value) => ({
    session() { return Promise.resolve(value); },
  });
  const leanQuery = (value) => ({
    session() { return this; },
    async lean() { return value; },
  });
  let sequence = 0;

  loaded.require = (request) => {
    if (request === "../../models/Provider") {
      return {
        findOne() { return queryWithSession({ ...provider, walletBalancePaise: balance }); },
        async findOneAndUpdate(_query, update) {
          balance += Number(update?.$inc?.walletBalancePaise || 0);
          return { ...provider, walletBalancePaise: balance };
        },
      };
    }
    if (request === "../../models/WalletTransaction") {
      return {
        findOne() { return leanQuery(null); },
        async create(rows) {
          const row = {
            ...rows[0],
            createdAt: new Date(),
            toObject() { return { ...this, toObject: undefined }; },
          };
          transactions.push(row);
          return [row];
        },
      };
    }
    if (request === "../../models/CreditAllocation") {
      return {
        countDocuments() { return queryWithSession(1); },
        async create(rows) { allocations.push(rows[0]); return rows; },
      };
    }
    if (request === "../../utils/uuid") {
      return () => `id-${++sequence}`;
    }
    if (request === "../../utils/credits") {
      return {
        paiseFromCredits: (value) => Math.round(Number(value || 0) * 100),
        creditsFromPaise: (value) => Number(value || 0) / 100,
      };
    }
    if (request === "../../utils/transaction") {
      return { withTransaction: async (callback) => callback({}) };
    }
    if (request === "../../utils/validation") {
      return {
        enumValue: (value, allowed, options = {}) => {
          const resolved = String(value || options.fallback || "");
          if (!allowed.includes(resolved)) throw new Error("invalid enum");
          return resolved;
        },
        identifierValue: (value) => String(value || "").trim(),
        numberValue: (value) => Number(value),
        textValue: (value) => String(value || "").trim(),
      };
    }
    return Module.createRequire(filename)(request);
  };

  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return {
    service: loaded.exports,
    allocations,
    transactions,
    getBalance: () => balance,
  };
}

test("Not Confirmed reviews have a dedicated CRM section and refund states", () => {
  const view = source("views/provider-unlock/not-confirmed.ejs");
  const sidebar = source("views/partials/sidebar.ejs");
  const frontend = source("routes/frontend.js");
  const unlockModel = source("models/ProviderLeadUnlock.js");

  assert.match(view, /Not Confirmed provider reviews/);
  assert.match(view, /Revert credits/);
  assert.match(view, /Reassign \/ Copy link/);
  assert.match(view, /Waiting for all providers/);
  assert.match(sidebar, /Not Confirmed Reviews/);
  assert.match(frontend, /\/provider-unlocks\/not-confirmed/);
  assert.match(unlockModel, /creditRefundStatus/);
  assert.match(unlockModel, /creditRefundTransactionId/);
});

test("credit reversal creates a new idempotent refund allocation and wallet credit", async () => {
  const runtime = compileCreditRefund();
  const result = await runtime.service.refundLeadUnlockCredits(
    {
      providerLeadUnlockId: "unlock-1",
      providerId: "provider-1",
      enquiryId: "lead-1",
      unlockMethod: "credits",
      chargedCredits: 10,
      walletTransactionId: "debit-1",
    },
    { note: "Customer did not proceed" },
    { email: "ops@findoly.com", name: "Ops" },
    { id: "session-1" },
  );

  assert.equal(runtime.getBalance(), 6000);
  assert.equal(result.refundedCredits, 10);
  assert.equal(runtime.allocations.length, 1);
  assert.equal(runtime.allocations[0].source, "lead_unlock_refund");
  assert.equal(runtime.allocations[0].referenceId, "unlock-1");
  assert.equal(runtime.allocations[0].remainingMinorCredits, 1000);
  assert.equal(runtime.transactions.length, 1);
  assert.equal(runtime.transactions[0].type, "credit");
  assert.equal(runtime.transactions[0].source, "lead_unlock_refund");
  assert.equal(runtime.transactions[0].idempotencyKey, "lead-unlock-refund:provider-1:unlock-1");
  assert.equal(runtime.transactions[0].balanceBeforePaise, 5000);
  assert.equal(runtime.transactions[0].balanceAfterPaise, 6000);
});

test("CRM outcome review can manually mark Not Confirmed and decide refund or keep charge", () => {
  const providerService = source("services/provider/provider-service.js");
  const reviewView = source("views/enquiry/provider-status-show.ejs");

  assert.match(providerService, /CREDIT_REVIEW_ACTIONS/);
  assert.match(providerService, /effectiveOutcome/);
  assert.match(providerService, /creditAction === "refund"/);
  assert.match(providerService, /refundLeadUnlockCredits/);
  assert.match(providerService, /creditRefundStatus = "kept_charged"/);
  assert.match(providerService, /reopenIfAllNotConfirmed/);
  assert.match(providerService, /LEAD_ALREADY_REASSIGNED/);
  assert.match(reviewView, /Effective outcome/);
  assert.match(reviewView, /Credit decision/);
  assert.match(reviewView, /Nearby Providers \/ Copy link/);
});

test("reassignment links are blocked until every prior provider is Not Confirmed", () => {
  const linkService = source("services/enquiry/provider-direct-link-service.js");
  const unlockService = source("services/provider-unlock/provider-unlock-service.js");
  const enquiryModel = source("models/Enquiry.js");

  assert.match(linkService, /findBlockingUnlock/);
  assert.match(linkService, /PREVIOUS_PROVIDER_NOT_CLOSED/);
  assert.match(unlockService, /providerSaleOutcome: \{ \$ne: "not_confirmed" \}/);
  assert.match(unlockService, /\$in: \["", "pending_review"\]/);
  assert.match(unlockService, /chargedCredits = \{ \$gt: 0 \}/);
  assert.match(unlockService, /reassignmentEligible/);
  assert.match(enquiryModel, /provider_pending/);
});

test("original unlock debit is preserved and refund is represented as a separate credit transaction", () => {
  const creditService = source("services/provider/provider-credit-service.js");
  assert.match(creditService, /source: "lead_unlock_refund"/);
  assert.match(creditService, /type: "credit"/);
  assert.match(creditService, /originalWalletTransactionId/);
  assert.doesNotMatch(creditService, /deleteOne\([\s\S]*lead_unlock/);
});
