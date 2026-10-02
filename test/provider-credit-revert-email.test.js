"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadSystemEventService(options = {}) {
  const filename = path.join(root, "services/communication/system-event-service.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const sent = [];
  const templateUpdates = [];
  const internalRule = {
    ruleId: "internal-credit-revert-rule",
    enabled: true,
    emailEnabled: true,
    emailTemplateId: "internal-credit-revert-template",
  };
  const providerTemplate = {
    templateId: "provider-credit-revert-template",
    bodyHtml: options.providerBodyHtml === undefined ? "<p>Existing HTML</p>" : options.providerBodyHtml,
  };
  const query = (value) => ({ async lean() { return value; } });

  loaded.require = (request) => {
    if (request === "../../models/CommunicationRule") {
      return {
        findOne(criteria) {
          if (criteria?.event === "provider_credit_reverted" && criteria?.recipientSource === "internal") {
            return query(internalRule);
          }
          return query(null);
        },
      };
    }
    if (request === "../../models/CommunicationTemplate") {
      return {
        async updateOne(criteria, update) {
          templateUpdates.push({ criteria, update });
          return { acknowledged: true };
        },
        findOne(criteria) {
          if (criteria?.name === "findoly_provider_credit_reverted") return query(providerTemplate);
          return query(null);
        },
      };
    }
    if (request === "../../models/Enquiry") return {};
    if (request === "../../models/ProviderLeadUnlock") return {};
    if (request === "../../models/Provider") return {};
    if (request === "../../models/Agent") return {};
    if (request === "../../models/ProviderJoinRequest") return {};
    if (request === "./communication-service") {
      return {
        async send(input) {
          sent.push(input);
          return { communicationId: "comm-" + sent.length, status: "sent" };
        },
      };
    }
    if (request === "./default-template-service") {
      return { async ensureInternalAlertTemplatesAndRules() { return []; } };
    }
    if (request === "./provider-credit-reverted-template") {
      return Module.createRequire(filename)(request);
    }
    return Module.createRequire(filename)(request);
  };

  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return { service: loaded.exports, sent, templateUpdates };
}

function refundContext() {
  return {
    event: "provider_credit_reverted",
    providerLeadUnlockId: "unlock-1",
    enquiryId: "lead-1",
    providerId: "provider-1",
    eventAt: "2026-10-03T12:00:00.000Z",
    idempotencySuffix: "refund-tx-1",
    creditsReverted: 10,
    balanceBeforeCredits: 50,
    balanceAfterCredits: 60,
    refundTransactionId: "refund-tx-1",
    refundReason: "Customer did not proceed",
    reviewedBy: "ops@findoly.com",
    unlock: {
      providerLeadUnlockId: "unlock-1",
      enquiryId: "lead-1",
      providerId: "provider-1",
      creditRefundedCredits: 10,
      creditRefundTransactionId: "refund-tx-1",
      creditRefundNote: "Customer did not proceed",
    },
    lead: {
      enquiryId: "lead-1",
      requirementTitle: "AC repair",
      category: "AC Repair",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    },
    provider: {
      providerId: "provider-1",
      name: "Provider",
      businessName: "Provider Business",
      email: "provider@example.com",
    },
  };
}

test("credit revert event emails alert@findoly.com and the affected provider", async () => {
  const previousInternalEmail = process.env.INTERNAL_ALERT_EMAIL;
  process.env.INTERNAL_ALERT_EMAIL = "other-internal@example.com";
  try {
    const runtime = loadSystemEventService();
    const result = await runtime.service.dispatch(
      "provider_credit_reverted",
      refundContext(),
      "ops@findoly.com",
    );

    assert.equal(result.length, 2);
    assert.equal(runtime.sent.length, 2);

    const internal = runtime.sent.find((item) => item.recipientContact === "alert@findoly.com");
    const provider = runtime.sent.find((item) => item.recipientContact === "provider@example.com");

    assert.ok(internal);
    assert.ok(provider);
    assert.equal(runtime.sent.some((item) => item.recipientContact === "other-internal@example.com"), false);
    assert.equal(internal.trigger, "provider_credit_reverted");
    assert.equal(provider.trigger, "provider_credit_reverted");
    assert.equal(provider.purpose, "provider_credit_reverted");
    assert.equal(internal.variables.credits_reverted, "10");
    assert.equal(internal.variables.balance_before, "50");
    assert.equal(internal.variables.balance_after, "60");
    assert.equal(internal.variables.refund_transaction_id, "refund-tx-1");
    assert.equal(provider.variables.credits_reverted, "10");
    assert.match(provider.idempotencyKey, /refund-tx-1$/);
    assert.match(internal.idempotencyKey, /provider_credit_reverted/);
  } finally {
    if (previousInternalEmail === undefined) delete process.env.INTERNAL_ALERT_EMAIL;
    else process.env.INTERNAL_ALERT_EMAIL = previousInternalEmail;
  }
});

test("credit revert provider template preserves non-empty custom HTML", async () => {
  const runtime = loadSystemEventService({ providerBodyHtml: "<p>Custom provider HTML</p>" });
  await runtime.service.dispatch("provider_credit_reverted", refundContext(), "ops@findoly.com");

  const htmlRepair = runtime.templateUpdates.find((entry) =>
    entry.criteria?.templateId === "provider-credit-revert-template"
    && Object.prototype.hasOwnProperty.call(entry.update?.$set || {}, "bodyHtml"),
  );
  assert.equal(htmlRepair, undefined);
});

test("credit revert provider template self-heals blank HTML only", async () => {
  const runtime = loadSystemEventService({ providerBodyHtml: "" });
  await runtime.service.dispatch("provider_credit_reverted", refundContext(), "ops@findoly.com");

  const htmlRepair = runtime.templateUpdates.find((entry) =>
    entry.criteria?.templateId === "provider-credit-revert-template"
    && Object.prototype.hasOwnProperty.call(entry.update?.$set || {}, "bodyHtml"),
  );
  assert.ok(htmlRepair);
  assert.match(htmlRepair.update.$set.bodyHtml, /Credits reverted/);
  assert.match(htmlRepair.update.$set.bodyHtml, /{{balance_after}}/);
});

test("credit revert HTML templates include balances without exposing the CRM review note to provider", () => {
  const templates = require("../services/communication/provider-credit-reverted-template");

  assert.match(templates.providerCreditRevertedTemplate.bodyHtml, /Credits reverted/);
  assert.match(templates.providerCreditRevertedTemplate.bodyHtml, /{{credits_reverted}}/);
  assert.match(templates.providerCreditRevertedTemplate.bodyHtml, /{{balance_before}}/);
  assert.match(templates.providerCreditRevertedTemplate.bodyHtml, /{{balance_after}}/);
  assert.doesNotMatch(templates.providerCreditRevertedTemplate.bodyHtml, /{{refund_reason}}/);

  assert.match(templates.internalCreditRevertedDefinition.bodyHtml, /{{refund_reason}}/);
  assert.match(templates.internalCreditRevertedDefinition.bodyHtml, /{{reviewed_by}}/);
  assert.match(templates.internalCreditRevertedDefinition.bodyHtml, /{{refund_transaction_id}}/);
});

test("refund notification is dispatched after the transactional review block and remains idempotent", () => {
  const providerService = source("services/provider/provider-service.js");
  const transactionIndex = providerService.indexOf('operationLabel: "Provider outcome and credit review"');
  const dispatchIndex = providerService.indexOf('"provider_credit_reverted"');
  assert.ok(transactionIndex >= 0);
  assert.ok(dispatchIndex > transactionIndex);
  assert.match(providerService, /result\.creditAction === "refund"/);
  assert.match(providerService, /idempotencySuffix: refundTransactionId/);
  assert.match(providerService, /creditRefundEmailDeliveries/);
  assert.match(providerService, /refundTransactionId/);
});
