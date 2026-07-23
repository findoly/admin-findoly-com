const Provider = require("../../models/Provider");
const WalletTransaction = require("../../models/WalletTransaction");
const CreditAllocation = require("../../models/CreditAllocation");
const uuid = require("../../utils/uuid");
const { paiseFromCredits, creditsFromPaise } = require("../../utils/credits");
const { withTransaction } = require("../../utils/transaction");
const {
  enumValue,
  identifierValue,
  numberValue,
  textValue,
} = require("../../utils/validation");

const MANUAL_CREDIT_REASONS = Object.freeze([
  "invalid_lead_refund",
  "technical_issue",
  "payment_correction",
  "goodwill_gesture",
  "promotional_credits",
  "retention_support",
  "other",
]);

const REASON_LABELS = Object.freeze({
  invalid_lead_refund: "Invalid lead refund",
  technical_issue: "Technical issue",
  payment_correction: "Payment correction",
  goodwill_gesture: "Goodwill gesture",
  promotional_credits: "Promotional credits",
  retention_support: "Retention support",
  other: "Other",
});

function providerQuery(providerId) {
  const value = identifierValue(providerId, { label: "Provider ID" });
  return { $or: [{ providerId: value }, { id: value }] };
}

function actorDetails(actor = {}) {
  return {
    employeeId: String(actor.employeeId || "").trim(),
    name: String(actor.name || "CRM employee").trim(),
    email: String(actor.email || "").trim().toLowerCase(),
    roleName: String(actor.roleName || "").trim(),
  };
}

function normalizeInput(input = {}) {
  const amountCredits = numberValue(input.amountCredits, {
    label: "Credit amount",
    min: 0.01,
    max: 100000,
  });

  return {
    amountCredits,
    amountMinorCredits: paiseFromCredits(amountCredits),
    reason: enumValue(input.reason, MANUAL_CREDIT_REASONS, {
      label: "Credit reason",
    }),
    note: textValue(input.note, {
      label: "Internal note",
      required: true,
      minLength: 5,
      maxLength: 2000,
    }),
    reference: textValue(input.reference, {
      label: "Reference",
      maxLength: 160,
    }),
    requestId: identifierValue(input.requestId, {
      label: "Request ID",
    }),
  };
}

async function ensureLegacyAllocation(provider, session) {
  const providerId = String(provider.providerId || provider.id || "");
  const balance = Number(provider.walletBalancePaise || 0);
  if (!providerId || balance <= 0) return;

  const allocationCount = await CreditAllocation.countDocuments({ providerId }).session(
    session,
  );
  if (allocationCount > 0) return;

  await CreditAllocation.create(
    [
      {
        creditAllocationId: uuid(),
        providerId,
        source: "legacy_credit_balance",
        referenceId: `legacy:${providerId}`,
        amountMinorCredits: balance,
        remainingMinorCredits: balance,
        status: "active",
        allocatedAt: provider.walletUpdatedAt || provider.updatedAt || new Date(),
        expiresAt: null,
        metadata: {
          migratedFrom: "walletBalancePaise",
          note: "Legacy balance preserved as non-expiring credits",
        },
      },
    ],
    { session },
  );
}

function presentResult(provider, transaction, duplicate = false) {
  return {
    duplicate,
    providerId: String(provider.providerId || provider.id || ""),
    walletBalancePaise: Number(provider.walletBalancePaise || 0),
    walletBalanceCredits: creditsFromPaise(provider.walletBalancePaise),
    transaction: {
      walletTransactionId: transaction.walletTransactionId,
      type: transaction.type,
      amountPaise: Number(transaction.amountPaise || 0),
      amountCredits: creditsFromPaise(transaction.amountPaise),
      balanceBeforePaise: Number(transaction.balanceBeforePaise || 0),
      balanceBeforeCredits: creditsFromPaise(transaction.balanceBeforePaise),
      balanceAfterPaise: Number(transaction.balanceAfterPaise || 0),
      balanceAfterCredits: creditsFromPaise(transaction.balanceAfterPaise),
      source: transaction.source,
      referenceId: transaction.referenceId || "",
      description: transaction.description || "",
      metadata: transaction.metadata || {},
      createdAt: transaction.createdAt || null,
    },
  };
}

module.exports.addCredits = async function addCredits(
  providerId,
  input = {},
  actor = {},
) {
  const requestedProviderId = identifierValue(providerId, {
    label: "Provider ID",
  });
  const data = normalizeInput(input);
  let canonicalProviderId = requestedProviderId;
  let idempotencyKey = "";

  try {
    return await withTransaction(async (session) => {
      const provider = await Provider.findOne(providerQuery(requestedProviderId)).session(
        session,
      );
      if (!provider) {
        throw Object.assign(new Error("Provider not found"), { status: 404 });
      }

      canonicalProviderId = String(
        provider.providerId || provider.id || requestedProviderId,
      );
      idempotencyKey = `crm-manual-credit:${canonicalProviderId}:${data.requestId}`;

      const existingTransaction = await WalletTransaction.findOne({
        idempotencyKey,
      })
        .session(session)
        .lean();

      if (existingTransaction) {
        return presentResult(provider, existingTransaction, true);
      }

      await ensureLegacyAllocation(provider, session);

      const now = new Date();
      const manualCreditId = uuid();
      const creditAllocationId = uuid();
      const balanceBeforePaise = Number(provider.walletBalancePaise || 0);
      const balanceAfterPaise = balanceBeforePaise + data.amountMinorCredits;
      const employee = actorDetails(actor);
      const reasonLabel = REASON_LABELS[data.reason] || "Credit adjustment";

      await CreditAllocation.create(
        [
          {
            creditAllocationId,
            providerId: canonicalProviderId,
            source: "crm_manual_credit",
            referenceId: manualCreditId,
            amountMinorCredits: data.amountMinorCredits,
            remainingMinorCredits: data.amountMinorCredits,
            status: "active",
            allocatedAt: now,
            expiresAt: null,
            metadata: {
              reason: data.reason,
              reasonLabel,
              internalNote: data.note,
              externalReference: data.reference,
              addedBy: employee,
            },
          },
        ],
        { session },
      );

      const balanceQuery = { _id: provider._id };
      if (balanceBeforePaise === 0) {
        balanceQuery.$or = [
          { walletBalancePaise: 0 },
          { walletBalancePaise: null },
          { walletBalancePaise: { $exists: false } },
        ];
      } else {
        balanceQuery.walletBalancePaise = balanceBeforePaise;
      }

      const updatedProvider = await Provider.findOneAndUpdate(
        balanceQuery,
        {
          $inc: { walletBalancePaise: data.amountMinorCredits },
          $set: { walletUpdatedAt: now, updatedAt: now },
        },
        { new: true, session, runValidators: true },
      );

      if (!updatedProvider) {
        throw Object.assign(
          new Error("Provider credit balance changed. Please try again."),
          { status: 409, code: "CREDIT_BALANCE_CHANGED" },
        );
      }

      const [transaction] = await WalletTransaction.create(
        [
          {
            walletTransactionId: manualCreditId,
            providerId: canonicalProviderId,
            type: "credit",
            amountPaise: data.amountMinorCredits,
            currency: "INR",
            balanceBeforePaise,
            balanceAfterPaise,
            status: "posted",
            source: "crm_manual_credit",
            referenceId: manualCreditId,
            idempotencyKey,
            description: `${creditsFromPaise(data.amountMinorCredits)} credits added by Findoly · ${reasonLabel}`,
            expiresAt: null,
            metadata: {
              reason: data.reason,
              reasonLabel,
              internalNote: data.note,
              externalReference: data.reference,
              addedBy: employee,
              creditAllocationId,
              requestId: data.requestId,
            },
          },
        ],
        { session },
      );

      return presentResult(updatedProvider, transaction.toObject(), false);
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existingTransaction = await WalletTransaction.findOne({
        idempotencyKey,
      }).lean();
      const provider = await Provider.findOne(
        providerQuery(canonicalProviderId),
      ).lean();
      if (existingTransaction && provider) {
        return presentResult(provider, existingTransaction, true);
      }
    }
    throw error;
  }
};

module.exports.MANUAL_CREDIT_REASONS = MANUAL_CREDIT_REASONS;
module.exports.REASON_LABELS = REASON_LABELS;
