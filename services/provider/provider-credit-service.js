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
    max: 1000,
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

function allocationSort(left, right) {
  const leftExpiry = left.expiresAt ? new Date(left.expiresAt).getTime() : Infinity;
  const rightExpiry = right.expiresAt ? new Date(right.expiresAt).getTime() : Infinity;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  return new Date(left.allocatedAt || left.createdAt || 0)
    - new Date(right.allocatedAt || right.createdAt || 0);
}

async function makePurchasedCreditsNonExpiring(providerId, session) {
  const now = new Date();
  await CreditAllocation.updateMany(
    {
      providerId,
      source: "plan_purchase",
      status: "active",
      remainingMinorCredits: { $gt: 0 },
      expiresAt: { $ne: null },
    },
    { $set: { expiresAt: null, updatedAt: now } },
    { session },
  );
}

async function expireAllocations(provider, session, now = new Date()) {
  const providerId = String(provider.providerId || provider.id || "");
  const expiring = await CreditAllocation.find({
    providerId,
    status: "active",
    remainingMinorCredits: { $gt: 0 },
    expiresAt: { $ne: null, $lte: now },
  })
    .sort({ expiresAt: 1, allocatedAt: 1 })
    .session(session);

  if (!expiring.length) return provider;

  let runningBalance = Number(provider.walletBalancePaise || 0);
  for (const allocation of expiring) {
    const allocationBalance = Math.max(0, Number(allocation.remainingMinorCredits || 0));
    const amount = Math.min(runningBalance, allocationBalance);

    await CreditAllocation.updateOne(
      { creditAllocationId: allocation.creditAllocationId, status: "active" },
      {
        $set: {
          remainingMinorCredits: 0,
          expiredMinorCredits: allocationBalance,
          status: "expired",
          expiredAt: now,
          updatedAt: now,
        },
      },
      { session },
    );

    if (amount > 0) {
      const balanceBefore = runningBalance;
      runningBalance = Math.max(0, runningBalance - amount);
      const idempotencyKey = `credit-expiry:${allocation.creditAllocationId}`;
      const existing = await WalletTransaction.findOne({ idempotencyKey })
        .session(session)
        .lean();
      if (!existing) {
        await WalletTransaction.create(
          [
            {
              walletTransactionId: uuid(),
              providerId,
              type: "expiry",
              amountPaise: amount,
              currency: "INR",
              balanceBeforePaise: balanceBefore,
              balanceAfterPaise: runningBalance,
              status: "expired",
              source: "plan_expiry",
              referenceId: allocation.creditAllocationId,
              idempotencyKey,
              description: `${creditsFromPaise(amount)} expired at the end of the plan validity period`,
              expiresAt: allocation.expiresAt,
              metadata: {
                planCode: allocation.planCode || "",
                billingCycle: allocation.billingCycle || "",
                providerSubscriptionId: allocation.providerSubscriptionId || "",
              },
            },
          ],
          { session },
        );
      }
    }
  }

  const update = {
    walletBalancePaise: runningBalance,
    walletUpdatedAt: now,
    updatedAt: now,
  };
  if (provider.currentPlanExpiresAt && new Date(provider.currentPlanExpiresAt) <= now) {
    Object.assign(update, {
      currentPlanCode: "",
      currentPlanName: "",
      currentBillingCycle: "",
      currentPlanStartedAt: null,
      currentPlanExpiresAt: null,
      currentSubscriptionId: "",
    });
  }

  const updatedProvider = await Provider.findOneAndUpdate(
    providerQuery(providerId),
    { $set: update },
    { new: true, session },
  );
  return updatedProvider || provider;
}

async function syncForConsumption(providerId, session) {
  let provider = await Provider.findOne(providerQuery(providerId)).session(session);
  if (!provider) {
    throw Object.assign(new Error("Provider account not found"), {
      status: 404,
      code: "PROVIDER_NOT_FOUND",
    });
  }
  if (provider.status !== "active" || provider.portalAccessEnabled === false) {
    throw Object.assign(new Error("Provider account is not eligible"), {
      status: 403,
      code: "PROVIDER_INELIGIBLE",
    });
  }

  await ensureLegacyAllocation(provider, session);
  await makePurchasedCreditsNonExpiring(String(provider.providerId || provider.id || providerId), session);
  provider = await expireAllocations(provider, session);
  return provider;
}

async function activeAllocations(providerId, session) {
  const rows = await CreditAllocation.find({
    providerId,
    status: "active",
    remainingMinorCredits: { $gt: 0 },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
    .lean()
    .session(session);
  return rows.sort(allocationSort);
}

async function consumeLeadUnlockCredits(providerId, amountMinorCredits, session) {
  if (!session) {
    throw Object.assign(new Error("Lead credit consumption must run inside a transaction"), {
      status: 500,
      code: "CREDIT_CONSUMPTION_TRANSACTION_REQUIRED",
    });
  }

  const amount = Math.max(0, Math.round(Number(amountMinorCredits || 0)));
  const provider = await syncForConsumption(providerId, session);
  const canonicalProviderId = String(provider.providerId || provider.id || providerId);
  const balanceBefore = Number(provider.walletBalancePaise || 0);

  if (balanceBefore < amount) {
    throw Object.assign(new Error("Provider does not have enough credits for this requirement"), {
      status: 402,
      code: "INSUFFICIENT_BALANCE",
      availableCredits: creditsFromPaise(balanceBefore),
      requiredCredits: creditsFromPaise(amount),
    });
  }

  if (amount === 0) {
    return {
      provider,
      balanceBeforePaise: balanceBefore,
      balanceAfterPaise: balanceBefore,
      consumption: [],
    };
  }

  const allocations = await activeAllocations(canonicalProviderId, session);
  let remaining = amount;
  const consumption = [];
  const now = new Date();

  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const available = Number(allocation.remainingMinorCredits || 0);
    if (available <= 0) continue;
    const used = Math.min(available, remaining);
    const left = available - used;
    remaining -= used;
    consumption.push({
      creditAllocationId: allocation.creditAllocationId,
      amountMinorCredits: used,
      expiresAt: allocation.expiresAt || null,
    });

    const result = await CreditAllocation.updateOne(
      {
        creditAllocationId: allocation.creditAllocationId,
        status: "active",
        remainingMinorCredits: available,
      },
      {
        $set: {
          remainingMinorCredits: left,
          status: left > 0 ? "active" : "depleted",
          depletedAt: left > 0 ? null : now,
          updatedAt: now,
        },
      },
      { session },
    );
    if (!result.matchedCount) {
      throw Object.assign(new Error("Provider credit allocation changed. Please try again."), {
        status: 409,
        code: "CREDIT_BALANCE_CHANGED",
      });
    }
  }

  if (remaining > 0) {
    throw Object.assign(
      new Error("Credit allocations are not consistent with the provider balance"),
      { status: 409, code: "CREDIT_BALANCE_INCONSISTENT" },
    );
  }

  const updatedProvider = await Provider.findOneAndUpdate(
    {
      ...providerQuery(canonicalProviderId),
      status: "active",
      portalAccessEnabled: { $ne: false },
      walletBalancePaise: { $gte: amount },
    },
    {
      $inc: { walletBalancePaise: -amount },
      $set: { walletUpdatedAt: now, updatedAt: now },
    },
    { new: true, session },
  );
  if (!updatedProvider) {
    throw Object.assign(new Error("Provider credit balance changed. Please try again."), {
      status: 409,
      code: "CREDIT_BALANCE_CHANGED",
    });
  }

  return {
    provider: updatedProvider,
    balanceBeforePaise: balanceBefore,
    balanceAfterPaise: Number(updatedProvider.walletBalancePaise || 0),
    consumption,
  };
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


async function refundLeadUnlockCredits(unlock = {}, input = {}, actor = {}, session) {
  if (!session) {
    throw Object.assign(new Error("Credit refund must run inside a transaction"), {
      status: 500,
      code: "CREDIT_REFUND_TRANSACTION_REQUIRED",
    });
  }

  const providerId = identifierValue(unlock.providerId, { label: "Provider ID" });
  const providerLeadUnlockId = identifierValue(unlock.providerLeadUnlockId, {
    label: "Provider lead unlock ID",
  });
  const amountCredits = Number(unlock.chargedCredits || 0);
  const amountMinorCredits = paiseFromCredits(amountCredits);
  if (unlock.unlockMethod !== "credits" || amountMinorCredits <= 0) {
    throw Object.assign(new Error("This unlock does not have a refundable credit charge"), {
      status: 409,
      code: "CREDIT_REFUND_NOT_APPLICABLE",
    });
  }

  const note = textValue(input.note, {
    label: "Refund review note",
    required: true,
    minLength: 3,
    maxLength: 2000,
    preserveWhitespace: true,
  });
  const idempotencyKey = `lead-unlock-refund:${providerId}:${providerLeadUnlockId}`;
  const existingTransaction = await WalletTransaction.findOne({ idempotencyKey })
    .session(session)
    .lean();
  const provider = await Provider.findOne(providerQuery(providerId)).session(session);
  if (!provider) {
    throw Object.assign(new Error("Provider not found"), { status: 404 });
  }
  if (existingTransaction) {
    return presentResult(provider, existingTransaction, true);
  }

  await ensureLegacyAllocation(provider, session);

  const now = new Date();
  const employee = actorDetails(actor);
  const creditAllocationId = uuid();
  const walletTransactionId = uuid();
  const balanceBeforePaise = Number(provider.walletBalancePaise || 0);
  const balanceAfterPaise = balanceBeforePaise + amountMinorCredits;

  await CreditAllocation.create(
    [
      {
        creditAllocationId,
        providerId,
        source: "lead_unlock_refund",
        referenceId: providerLeadUnlockId,
        amountMinorCredits,
        remainingMinorCredits: amountMinorCredits,
        status: "active",
        allocatedAt: now,
        expiresAt: null,
        metadata: {
          providerLeadUnlockId,
          enquiryId: unlock.enquiryId || "",
          originalWalletTransactionId: unlock.walletTransactionId || "",
          reviewNote: note,
          refundedBy: employee,
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
      $inc: { walletBalancePaise: amountMinorCredits },
      $set: { walletUpdatedAt: now, updatedAt: now },
    },
    { new: true, session, runValidators: true },
  );
  if (!updatedProvider) {
    throw Object.assign(new Error("Provider credit balance changed. Please try again."), {
      status: 409,
      code: "CREDIT_BALANCE_CHANGED",
    });
  }

  const [transaction] = await WalletTransaction.create(
    [
      {
        walletTransactionId,
        providerId,
        type: "credit",
        amountPaise: amountMinorCredits,
        currency: "INR",
        balanceBeforePaise,
        balanceAfterPaise,
        status: "posted",
        source: "lead_unlock_refund",
        referenceId: providerLeadUnlockId,
        idempotencyKey,
        description: `${amountCredits} credits returned after Not Confirmed review`,
        expiresAt: null,
        metadata: {
          providerLeadUnlockId,
          enquiryId: unlock.enquiryId || "",
          originalWalletTransactionId: unlock.walletTransactionId || "",
          creditAllocationId,
          reviewNote: note,
          refundedBy: employee,
        },
      },
    ],
    { session },
  );

  return {
    ...presentResult(updatedProvider, transaction.toObject(), false),
    creditAllocationId,
    refundedCredits: amountCredits,
  };
}

module.exports.refundLeadUnlockCredits = refundLeadUnlockCredits;

module.exports.MANUAL_CREDIT_REASONS = MANUAL_CREDIT_REASONS;
module.exports.REASON_LABELS = REASON_LABELS;

module.exports.consumeLeadUnlockCredits = consumeLeadUnlockCredits;
