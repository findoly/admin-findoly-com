const Agent = require("../../models/Agent");
const Enquiry = require("../../models/Enquiry");
const AgentWithdrawal = require("../../models/AgentWithdrawal");
const uuid = require("../../utils/uuid");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const { textValue, enumValue, identifierValue, queryTextValue, validationError } = require("../../utils/validation");
const { canonicalLeadStatus } = require("../../utils/lead-journey");
const { buildSearchAlternatives } = require("../../utils/search-query");
const { withTransaction } = require("../../utils/transaction");
const { boundedJsonValue } = require("../../utils/bounded-json");
const razorpay = require("./razorpay-service");

const WAITING_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVE_WITHDRAWAL_STATUSES = ["submitted", "under_review", "eligibility_approved", "finance_approved", "payout_processing", "payout_failed"];
const WITHDRAWAL_STATUSES = ["submitted", "under_review", "eligibility_approved", "finance_approved", "payout_processing", "paid", "rejected", "cancelled", "payout_failed", "eligibility_changed", "payout_reversed"];
const INVALID_REQUIREMENT_STATUSES = ["rejected", "invalid", "not_interested"];
const VALIDATION_STATUSES = ["pending", "valid", "invalid"];
const VALIDATION_METHODS = ["phone_call", "whatsapp", "email", "in_person", "other"];
const CONVERSION_STATUSES = ["pending", "converted", "not_converted"];
const INVALID_REASONS = ["duplicate", "incorrect_details", "customer_not_interested", "fake_referral", "unreachable", "outside_assigned_category", "other"];
const APPROVAL_HISTORY_LIMIT = 200;
const ENQUIRY_TIMELINE_LIMIT = 500;

function historyPush(entry) {
  return { $each: [entry], $slice: -APPROVAL_HISTORY_LIMIT };
}

function timelinePush(entries) {
  const values = Array.isArray(entries) ? entries : [entries];
  return { $each: values, $slice: -ENQUIRY_TIMELINE_LIMIT };
}

function payoutStatusDetails(value) {
  return boundedJsonValue(value || {}, {
    maxBytes: 16_000,
    maxDepth: 5,
    maxArrayLength: 50,
    maxKeys: 100,
    maxStringLength: 2000,
  });
}

function isAgentLead(row = {}) {
  return Boolean(row.agentId && (row.sourceChannel === "agent" || row.sourceWebsite === "agent-portal" || row.metadata?.agentSubmission));
}

function eligibilityDate(row = {}) {
  const submitted = new Date(row.createdAt || Date.now());
  return new Date(submitted.getTime() + WAITING_PERIOD_MS);
}

function basicAgentQuery(agentId) {
  const value = identifierValue(agentId, { label: "Agent ID" });
  return { $or: [{ agentId: value }, { referralId: String(value).toUpperCase() }] };
}

function generateWithdrawalNumber(referralId) {
  return `WD-${String(referralId || "AGENT").slice(0, 6)}-${Date.now().toString(36).toUpperCase()}-${uuid().slice(0, 4).toUpperCase()}`.slice(0, 40);
}

function auditEntry(action, fromStatus, toStatus, note, actor) {
  return {
    historyId: uuid(),
    action,
    fromStatus: fromStatus || "",
    toStatus: toStatus || "",
    note: String(note || "").trim(),
    actor: actor || "crm-admin",
    createdAt: new Date(),
  };
}

function presentWithdrawal(row = {}) {
  return {
    ...row,
    amountRupees: Number(row.netAmountPaise || 0) / 100,
    payoutPerReferralRupees: Number(row.payoutPerReferralPaise || 0) / 100,
  };
}

async function getAgent(agentId) {
  const agent = await Agent.findOne(basicAgentQuery(agentId)).lean();
  if (!agent) throw Object.assign(new Error("Agent not found"), { status: 404 });
  return agent;
}

function maturedEligibleQuery(agentId, now = new Date()) {
  return {
    agentId,
    agentReferralValidation: "valid",
    partnerEligibilityDate: { $lte: now },
    status: { $nin: INVALID_REQUIREMENT_STATUSES },
    isActive: { $ne: false },
    $or: [
      { partnerPayoutStatus: { $exists: false } },
      { partnerPayoutStatus: "" },
      { partnerPayoutStatus: "waiting_period" },
      { partnerPayoutStatus: "unpaid" },
    ],
  };
}

function maximumReferralsPerWithdrawal() {
  const configured = Number(process.env.AGENT_WITHDRAWAL_MAX_REFERRALS || 1000) || 1000;
  const bounded = Math.min(Math.max(Math.floor(configured), 10), 1000);
  return Math.max(10, Math.floor(bounded / 10) * 10);
}

const ELIGIBILITY_SELECTION = Object.freeze({
  _id: 0,
  enquiryId: 1,
  requirementTitle: 1,
  name: 1,
  mobile: 1,
  category: 1,
  status: 1,
  agentReferralValidation: 1,
  agentSaleConversion: 1,
  partnerEligibilityDate: 1,
  createdAt: 1,
});

async function selectRequirements(query, payableCount, conversionNeeded) {
  if (payableCount <= 0) return [];
  const converted = await Enquiry.find({ ...query, agentSaleConversion: "converted" })
    .sort({ createdAt: 1, _id: 1 })
    .select(ELIGIBILITY_SELECTION)
    .limit(conversionNeeded)
    .lean();
  const chosenIds = converted.map((row) => row.enquiryId);
  const remaining = Math.max(0, payableCount - converted.length);
  if (!remaining) return converted.slice(0, payableCount);
  const others = await Enquiry.find({
    ...query,
    ...(chosenIds.length ? { enquiryId: { $nin: chosenIds } } : {}),
  })
    .sort({ createdAt: 1, _id: 1 })
    .select(ELIGIBILITY_SELECTION)
    .limit(remaining)
    .lean();
  return [...converted, ...others].slice(0, payableCount);
}

async function calculateEligibility(agentId, now = new Date()) {
  const agent = await getAgent(agentId);
  await Enquiry.updateMany(
    { agentId: agent.agentId, agentReferralValidation: "valid", partnerEligibilityDate: { $lte: now }, partnerPayoutStatus: "waiting_period", status: { $nin: INVALID_REQUIREMENT_STATUSES } },
    { $set: { partnerPayoutStatus: "unpaid", updatedAt: now } },
  );
  const query = maturedEligibleQuery(agent.agentId, now);
  const [validReferralCount, convertedSaleCount] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.countDocuments({ ...query, agentSaleConversion: "converted" }),
  ]);
  const availableEligibleBlockCount = Math.min(
    Math.floor(validReferralCount / 10),
    Math.floor(convertedSaleCount / 2),
  );
  const maximumBlocks = maximumReferralsPerWithdrawal() / 10;
  const eligibleBlockCount = Math.min(availableEligibleBlockCount, maximumBlocks);
  const payableReferralCount = eligibleBlockCount * 10;
  const payoutPerReferralPaise = Number(agent.payoutPerReferralPaise || 5000);
  const chosen = await selectRequirements(query, payableReferralCount, eligibleBlockCount * 2);
  return {
    agent,
    validReferralCount,
    convertedSaleCount,
    availableEligibleBlockCount,
    eligibleBlockCount,
    payableReferralCount,
    payoutPerReferralPaise,
    grossAmountPaise: payableReferralCount * payoutPerReferralPaise,
    selectedRequirements: chosen,
  };
}

async function summaryForAgent(agentId) {
  const agent = await getAgent(agentId);
  const now = new Date();
  const [total, pendingValidation, invalid, waitingPeriod, paid, reserved, calculation, withdrawals] = await Promise.all([
    Enquiry.countDocuments({ agentId: agent.agentId }),
    Enquiry.countDocuments({ agentId: agent.agentId, agentReferralValidation: { $in: ["", "pending"] } }),
    Enquiry.countDocuments({ agentId: agent.agentId, agentReferralValidation: "invalid" }),
    Enquiry.countDocuments({ agentId: agent.agentId, agentReferralValidation: "valid", partnerEligibilityDate: { $gt: now }, status: { $nin: INVALID_REQUIREMENT_STATUSES } }),
    Enquiry.countDocuments({ agentId: agent.agentId, partnerPayoutStatus: "paid" }),
    Enquiry.countDocuments({ agentId: agent.agentId, partnerPayoutStatus: "reserved" }),
    calculateEligibility(agent.agentId, now),
    AgentWithdrawal.find({ agentId: agent.agentId }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  return {
    agent: {
      agentId: agent.agentId,
      referralId: agent.referralId,
      payoutPerReferralPaise: agent.payoutPerReferralPaise || 5000,
      payoutEnabled: agent.payoutEnabled === true,
      payoutAccountLabel: agent.payoutAccountLabel || "",
    },
    counts: { total, pendingValidation, invalid, waitingPeriod, paid, reserved },
    eligibility: {
      validReferralCount: calculation.validReferralCount,
      convertedSaleCount: calculation.convertedSaleCount,
      availableEligibleBlockCount: calculation.availableEligibleBlockCount,
      eligibleBlockCount: calculation.eligibleBlockCount,
      payableReferralCount: calculation.payableReferralCount,
      payoutPerReferralPaise: calculation.payoutPerReferralPaise,
      grossAmountPaise: calculation.grossAmountPaise,
    },
    recentWithdrawals: withdrawals.map(presentWithdrawal),
  };
}

async function submitWithdrawal(agentId, actor = "agent") {
  const calculation = await calculateEligibility(agentId);
  if (calculation.eligibleBlockCount < 1 || calculation.selectedRequirements.length < 10) {
    throw validationError("At least 10 matured valid referrals and 20% sales conversion are required");
  }

  const withdrawalId = uuid();
  const ids = calculation.selectedRequirements.map((row) => row.enquiryId);
  try {
    return await withTransaction(async (session) => {
      const active = await AgentWithdrawal.findOne({
        agentId: calculation.agent.agentId,
        status: { $in: ACTIVE_WITHDRAWAL_STATUSES },
      }).session(session).lean();
      if (active) {
        throw Object.assign(new Error("An active withdrawal request already exists"), {
          status: 409,
          code: "ACTIVE_WITHDRAWAL_EXISTS",
        });
      }

      const reserveResult = await Enquiry.updateMany(
        { ...maturedEligibleQuery(calculation.agent.agentId), enquiryId: { $in: ids } },
        { $set: { partnerPayoutStatus: "reserved", partnerWithdrawalId: withdrawalId, partnerPayoutLockedAt: null, partnerPayoutLockWithdrawalId: "", updatedAt: new Date() } },
        { session },
      );
      if (reserveResult.modifiedCount !== ids.length) {
        throw Object.assign(new Error("Referral eligibility changed. Refresh and try again"), {
          status: 409,
          code: "WITHDRAWAL_ELIGIBILITY_CHANGED",
        });
      }

      const [row] = await AgentWithdrawal.create([{
        withdrawalId,
        withdrawalNumber: generateWithdrawalNumber(calculation.agent.referralId),
        agentId: calculation.agent.agentId,
        referralId: calculation.agent.referralId,
        agentName: calculation.agent.name,
        agentBusinessName: calculation.agent.businessName || "",
        agentMobile: calculation.agent.mobile,
        categoryId: calculation.agent.categoryId || "",
        categorySlug: calculation.agent.categorySlug || "",
        categoryName: calculation.agent.categoryName || "",
        payoutPerReferralPaise: calculation.payoutPerReferralPaise,
        validReferralCount: calculation.validReferralCount,
        convertedSaleCount: calculation.convertedSaleCount,
        eligibleBlockCount: calculation.eligibleBlockCount,
        payableReferralCount: ids.length,
        grossAmountPaise: ids.length * calculation.payoutPerReferralPaise,
        deductionAmountPaise: 0,
        netAmountPaise: ids.length * calculation.payoutPerReferralPaise,
        requirementIds: ids,
        requirementSnapshots: calculation.selectedRequirements.map((item) => ({
          enquiryId: item.enquiryId,
          requirementTitle: item.requirementTitle || "",
          customerName: item.name || "",
          category: item.category || "",
          submittedAt: item.createdAt,
          eligibilityDate: item.partnerEligibilityDate,
          converted: item.agentSaleConversion === "converted",
        })),
        status: "submitted",
        activeSlot: calculation.agent.agentId,
        approvalHistory: [auditEntry("submitted", "", "submitted", "Withdrawal submitted from Agent Portal", actor)],
        payoutMode: calculation.agent.payoutMode || "IMPS",
        payoutAccountLabel: calculation.agent.payoutAccountLabel || "",
        razorpayContactId: calculation.agent.razorpayContactId || "",
        razorpayFundAccountId: calculation.agent.razorpayFundAccountId || "",
        updatedBy: actor,
      }], { session });
      return presentWithdrawal(row.toObject());
    }, { operationLabel: "Partner withdrawal operations" });
  } catch (error) {
    if (error?.code === 11000) {
      throw Object.assign(new Error("An active withdrawal request already exists"), {
        status: 409,
        code: "ACTIVE_WITHDRAWAL_EXISTS",
      });
    }
    throw error;
  }
}

async function listWithdrawals(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = enumValue(filters.status, WITHDRAWAL_STATUSES, { label: "Withdrawal status filter" });
  if (filters.agentId) query.agentId = identifierValue(filters.agentId, { label: "Agent ID filter" });
  const q = queryTextValue(filters.q, { label: "Withdrawal search", maxLength: 100 });
  if (q) {
    query.$or = buildSearchAlternatives(q, {
      identifierFields: ["withdrawalId", "withdrawalNumber", "referralId", "razorpayPayoutId"],
      prefixFields: ["agentName", "agentBusinessName"],
    });
  }
  applyDateRange(query, filters, { fields: { submittedAt: "Submitted date", createdAt: "Created date", updatedAt: "Updated date", paidAt: "Paid date" }, defaultField: "submittedAt" });
  const result = await cursorPaginate(AgentWithdrawal, { query, sort: dateSort(filters, { fields: ["submittedAt", "createdAt", "updatedAt", "paidAt"], defaultField: "submittedAt" }), limit, cursor });
  return { ...result, data: result.data.map(presentWithdrawal) };
}

async function listAgentWithdrawals(agentId, filters = {}) {
  const agent = await getAgent(agentId);
  const { limit, cursor } = getPagination(filters);
  const query = { agentId: agent.agentId };
  if (filters.status) query.status = enumValue(filters.status, WITHDRAWAL_STATUSES, { label: "Withdrawal status filter" });
  const result = await cursorPaginate(AgentWithdrawal, { query, sort: { createdAt: -1, _id: -1 }, limit, cursor });
  return { ...result, data: result.data.map(presentWithdrawal) };
}

async function getWithdrawal(withdrawalId, agentId = "", session = null) {
  const id = identifierValue(withdrawalId, { label: "Withdrawal ID" });
  const query = { withdrawalId: id };
  if (agentId) query.agentId = identifierValue(agentId, { label: "Agent ID" });
  let lookup = AgentWithdrawal.findOne(query);
  if (session) lookup = lookup.session(session);
  const row = await lookup.lean();
  if (!row) throw Object.assign(new Error("Withdrawal request not found"), { status: 404 });
  return presentWithdrawal(row);
}

async function releaseRequirements(withdrawalId, session = null) {
  return Enquiry.updateMany(
    { partnerWithdrawalId: withdrawalId, partnerPayoutStatus: "reserved" },
    { $set: { partnerPayoutStatus: "unpaid", partnerWithdrawalId: "", partnerPayoutLockedAt: null, partnerPayoutLockWithdrawalId: "", updatedAt: new Date() } },
    session ? { session } : undefined,
  );
}

async function revalidateWithdrawal(row, session = null) {
  const now = new Date();
  let eligible = Enquiry.find({
    enquiryId: { $in: row.requirementIds },
    agentId: row.agentId,
    agentReferralValidation: "valid",
    partnerEligibilityDate: { $lte: now },
    status: { $nin: INVALID_REQUIREMENT_STATUSES },
    partnerPayoutStatus: "reserved",
    partnerWithdrawalId: row.withdrawalId,
  }).select({ enquiryId: 1, agentSaleConversion: 1 });
  if (session) eligible = eligible.session(session);
  const eligibleRows = await eligible.lean();
  const converted = eligibleRows.filter((item) => item.agentSaleConversion === "converted").length;
  const blocks = Math.min(Math.floor(eligibleRows.length / 10), Math.floor(converted / 2));
  if (eligibleRows.length !== row.payableReferralCount || blocks * 10 < row.payableReferralCount) {
    throw Object.assign(new Error("Withdrawal eligibility changed and requires review"), { status: 409, code: "ELIGIBILITY_CHANGED" });
  }
  return true;
}

async function transitionWithdrawal(withdrawalId, action, note, actor = "crm-admin") {
  const normalizedAction = enumValue(action, ["start_review", "approve_eligibility", "approve_finance", "reject", "cancel"], { label: "Withdrawal action" });
  const message = textValue(note, { label: "Approval note", required: true, maxLength: 2000, preserveWhitespace: true });

  return withTransaction(async (session) => {
    const row = await getWithdrawal(withdrawalId, "", session);
    let nextStatus = row.status;
    if (normalizedAction === "start_review" && row.status === "submitted") nextStatus = "under_review";
    else if (normalizedAction === "approve_eligibility" && row.status === "under_review") {
      await revalidateWithdrawal(row, session);
      nextStatus = "eligibility_approved";
    } else if (normalizedAction === "approve_finance" && row.status === "eligibility_approved") {
      await revalidateWithdrawal(row, session);
      nextStatus = "finance_approved";
    } else if (normalizedAction === "reject" && !["paid", "payout_processing"].includes(row.status)) nextStatus = "rejected";
    else if (normalizedAction === "cancel" && !["paid", "payout_processing"].includes(row.status)) nextStatus = "cancelled";
    else throw validationError("This withdrawal action is not allowed at the current stage");

    const now = new Date();
    const set = { status: nextStatus, updatedBy: actor, updatedAt: now };
    if (nextStatus === "under_review") set.reviewedAt = now;
    if (nextStatus === "eligibility_approved") set.eligibilityApprovedAt = now;
    if (nextStatus === "finance_approved") set.financeApprovedAt = now;
    if (["rejected", "cancelled"].includes(nextStatus)) {
      set.rejectedAt = now;
      set.rejectionReason = message;
      set.activeSlot = "";
      await releaseRequirements(row.withdrawalId, session);
    }
    const result = await AgentWithdrawal.updateOne(
      { withdrawalId: row.withdrawalId, status: row.status },
      {
        $set: set,
        $push: { approvalHistory: historyPush(auditEntry(normalizedAction, row.status, nextStatus, message, actor)) },
      },
      { session },
    );
    if (result.modifiedCount !== 1) {
      throw Object.assign(new Error("This withdrawal changed while it was being updated. Refresh and try again."), {
        status: 409,
        code: "WITHDRAWAL_CONCURRENT_UPDATE",
      });
    }
    return getWithdrawal(row.withdrawalId, "", session);
  }, { operationLabel: "Partner withdrawal operations" });
}

async function processPayout(withdrawalId, note, actor = "crm-admin") {
  const message = textValue(note, { label: "Payout note", required: true, maxLength: 1000, preserveWhitespace: true });
  const initial = await getWithdrawal(withdrawalId);
  if (!["finance_approved", "payout_failed"].includes(initial.status)) {
    throw validationError("Finance approval is required before payout");
  }
  const agent = await getAgent(initial.agentId);
  if (agent.payoutEnabled !== true || !agent.razorpayFundAccountId) {
    throw validationError("Configure and enable the agent payout account before processing payment");
  }

  const claim = await withTransaction(async (session) => {
    const row = await getWithdrawal(withdrawalId, "", session);
    if (!["finance_approved", "payout_failed"].includes(row.status)) {
      throw Object.assign(new Error("This withdrawal is already being processed or has changed. Refresh and try again."), {
        status: 409,
        code: "PAYOUT_ALREADY_PROCESSING",
      });
    }
    await revalidateWithdrawal(row, session);
    const attempt = Number(row.payoutAttemptCount || 0) + 1;
    const idempotencyKey = `${row.withdrawalId.slice(0, 32)}${String(attempt).padStart(2, "0")}`;
    const now = new Date();
    const lockResult = await Enquiry.updateMany(
      {
        enquiryId: { $in: row.requirementIds },
        partnerWithdrawalId: row.withdrawalId,
        partnerPayoutStatus: "reserved",
        $or: [
          { partnerPayoutLockWithdrawalId: "" },
          { partnerPayoutLockWithdrawalId: null },
          { partnerPayoutLockWithdrawalId: { $exists: false } },
        ],
      },
      {
        $set: {
          partnerPayoutLockedAt: now,
          partnerPayoutLockWithdrawalId: row.withdrawalId,
          updatedAt: now,
        },
      },
      { session },
    );
    if (lockResult.modifiedCount !== row.requirementIds.length) {
      throw Object.assign(new Error("Referral payout state changed while the payout was being started"), {
        status: 409,
        code: "PAYOUT_REQUIREMENT_LOCK_FAILED",
      });
    }
    const updateResult = await AgentWithdrawal.updateOne(
      { withdrawalId: row.withdrawalId, status: row.status },
      {
        $set: {
          status: "payout_processing",
          payoutAttemptCount: attempt,
          payoutIdempotencyKey: idempotencyKey,
          payoutInitiatedAt: now,
          payoutFailureReason: "",
          updatedBy: actor,
          updatedAt: now,
        },
        $push: {
          approvalHistory: historyPush(
            auditEntry("payout_started", row.status, "payout_processing", message, actor),
          ),
        },
      },
      { session },
    );
    if (updateResult.modifiedCount !== 1) {
      throw Object.assign(new Error("This withdrawal is already being processed or has changed. Refresh and try again."), {
        status: 409,
        code: "PAYOUT_ALREADY_PROCESSING",
      });
    }
    return { row, attempt, idempotencyKey };
  }, { operationLabel: "Partner payout operations" });

  let payout = null;
  try {
    payout = await razorpay.createPayout({
      idempotencyKey: claim.idempotencyKey,
      fundAccountId: agent.razorpayFundAccountId,
      amountPaise: claim.row.netAmountPaise,
      mode: agent.payoutMode || "IMPS",
      referenceId: claim.row.withdrawalNumber,
      narration: `Findoly ${claim.row.referralId} payout`,
      notes: { withdrawalId: claim.row.withdrawalId, referralId: claim.row.referralId },
    });
    await AgentWithdrawal.updateOne({ withdrawalId: claim.row.withdrawalId, status: "payout_processing" }, {
      $set: {
        razorpayPayoutId: payout.id || "",
        razorpayPayoutStatus: payout.status || "processing",
        razorpayStatusDetails: payoutStatusDetails(payout.status_details),
        payoutReference: payout.utr || payout.id || "",
        payoutMode: agent.payoutMode || "IMPS",
        payoutAccountLabel: agent.payoutAccountLabel || "",
        razorpayContactId: agent.razorpayContactId || "",
        razorpayFundAccountId: agent.razorpayFundAccountId || "",
        updatedAt: new Date(),
      },
    });
    if (payout.status === "processed") {
      await markPaid(claim.row.withdrawalId, payout, "razorpay-api");
    } else if (["failed", "cancelled", "rejected"].includes(String(payout.status || "").toLowerCase())) {
      await markPayoutFailed(claim.row.withdrawalId, payout, "payout_failed", "razorpay-api");
    }
    return getWithdrawal(claim.row.withdrawalId);
  } catch (error) {
    const reconciliationRequired = Boolean(payout?.id || error?.requestMayHaveSucceeded);
    if (reconciliationRequired) {
      const reason = `Payout result requires reconciliation: ${String(error?.message || "unknown result").slice(0, 1800)}`;
      await AgentWithdrawal.updateOne(
        { withdrawalId: claim.row.withdrawalId, status: "payout_processing" },
        {
          $set: {
            payoutFailureReason: reason,
            razorpayPayoutId: payout?.id || claim.row.razorpayPayoutId || "",
            razorpayPayoutStatus: payout?.status || claim.row.razorpayPayoutStatus || "unknown",
            updatedBy: actor,
            updatedAt: new Date(),
          },
          $push: {
            approvalHistory: historyPush(
              auditEntry("payout_reconciliation_required", "payout_processing", "payout_processing", reason, actor),
            ),
          },
        },
      );
      throw Object.assign(
        new Error("The payout result is uncertain and must be reconciled from Razorpay or its webhook before retrying"),
        {
          status: 503,
          code: "PAYOUT_RECONCILIATION_REQUIRED",
          cause: error,
        },
      );
    }
    await withTransaction(async (session) => {
      const reason = String(error?.message || "Payout request failed").slice(0, 2000);
      await Enquiry.updateMany(
        { partnerPayoutLockWithdrawalId: claim.row.withdrawalId, partnerPayoutStatus: "reserved" },
        { $set: { partnerPayoutLockedAt: null, partnerPayoutLockWithdrawalId: "", updatedAt: new Date() } },
        { session },
      );
      await AgentWithdrawal.updateOne(
        { withdrawalId: claim.row.withdrawalId, status: "payout_processing" },
        {
          $set: { status: "payout_failed", payoutFailureReason: reason, updatedBy: actor, updatedAt: new Date() },
          $push: { approvalHistory: historyPush(auditEntry("payout_failed", "payout_processing", "payout_failed", reason, actor)) },
        },
        { session },
      );
    }, { operationLabel: "Partner payout failure recording" });
    throw error;
  }
}

async function markPaid(withdrawalId, payout = {}, actor = "razorpay-webhook") {
  return withTransaction(async (session) => {
    const row = await getWithdrawal(withdrawalId, "", session);
    if (row.status === "paid" || row.status === "payout_reversed") return row;
    if (!["payout_processing", "payout_failed"].includes(row.status)) {
      throw Object.assign(new Error("This withdrawal is not awaiting payout completion"), {
        status: 409,
        code: "PAYOUT_STATUS_NOT_COMPLETABLE",
      });
    }
    const now = new Date();
    const reference = payout.utr || payout.id || row.razorpayPayoutId || row.withdrawalNumber;
    const enquiryResult = await Enquiry.updateMany(
      { enquiryId: { $in: row.requirementIds }, partnerWithdrawalId: row.withdrawalId, partnerPayoutStatus: "reserved" },
      { $set: { partnerPayoutStatus: "paid", partnerPayoutRatePaise: row.payoutPerReferralPaise, partnerPayoutAmountPaise: row.payoutPerReferralPaise, partnerPaidAt: now, partnerPayoutReference: reference, partnerPayoutLockedAt: null, partnerPayoutLockWithdrawalId: "", updatedAt: now } },
      { session },
    );
    if (enquiryResult.modifiedCount !== row.requirementIds.length) {
      throw Object.assign(new Error("Payout records are inconsistent and require review before completion"), {
        status: 409,
        code: "PAYOUT_REQUIREMENT_MISMATCH",
      });
    }
    const withdrawalResult = await AgentWithdrawal.updateOne(
      { withdrawalId: row.withdrawalId, status: row.status },
      {
        $set: {
          status: "paid",
          activeSlot: "",
          razorpayPayoutId: payout.id || row.razorpayPayoutId || "",
          razorpayPayoutStatus: payout.status || "processed",
          razorpayStatusDetails: payoutStatusDetails(payout.status_details),
          payoutReference: reference,
          paidAt: now,
          payoutFailureReason: "",
          updatedBy: actor,
          updatedAt: now,
        },
        $push: { approvalHistory: historyPush(auditEntry("paid", row.status, "paid", "Razorpay payout processed successfully", actor)) },
      },
      { session },
    );
    if (withdrawalResult.modifiedCount !== 1) {
      throw Object.assign(new Error("Payout status changed while completion was being recorded"), {
        status: 409,
        code: "PAYOUT_CONCURRENT_UPDATE",
      });
    }
    return getWithdrawal(row.withdrawalId, "", session);
  }, { operationLabel: "Partner payout operations" });
}

async function markPayoutFailed(withdrawalId, payout = {}, status = "payout_failed", actor = "razorpay-webhook") {
  return withTransaction(async (session) => {
    const row = await getWithdrawal(withdrawalId, "", session);
    const nextStatus = status === "payout_reversed" ? "payout_reversed" : "payout_failed";
    if (row.status === nextStatus) return row;
    if (row.status === "paid" && nextStatus !== "payout_reversed") return row;
    const reason = payout?.status_details?.description || payout?.failure_reason || payout?.error?.description || `Razorpay payout ${nextStatus.replace("payout_", "")}`;
    const now = new Date();

    if (nextStatus === "payout_reversed") {
      await Enquiry.updateMany(
        {
          partnerWithdrawalId: row.withdrawalId,
          partnerPayoutStatus: { $in: ["paid", "reserved"] },
        },
        {
          $set: {
            partnerPayoutStatus: "unpaid",
            partnerWithdrawalId: "",
            partnerPayoutRatePaise: 0,
            partnerPayoutAmountPaise: 0,
            partnerPaidAt: null,
            partnerPayoutReference: "",
            partnerPayoutLockedAt: null,
            partnerPayoutLockWithdrawalId: "",
            updatedAt: now,
          },
        },
        { session },
      );
    } else {
      await Enquiry.updateMany(
        { partnerPayoutLockWithdrawalId: row.withdrawalId, partnerPayoutStatus: "reserved" },
        { $set: { partnerPayoutLockedAt: null, partnerPayoutLockWithdrawalId: "", updatedAt: now } },
        { session },
      );
    }

    const updateResult = await AgentWithdrawal.updateOne(
      { withdrawalId: row.withdrawalId, status: row.status },
      {
        $set: {
          status: nextStatus,
          activeSlot: nextStatus === "payout_reversed" ? "" : row.agentId,
          razorpayPayoutId: payout.id || row.razorpayPayoutId || "",
          razorpayPayoutStatus: payout.status || nextStatus,
          razorpayStatusDetails: payoutStatusDetails(payout.status_details),
          payoutFailureReason: reason,
          updatedBy: actor,
          updatedAt: now,
        },
        $push: { approvalHistory: historyPush(auditEntry(nextStatus, row.status, nextStatus, reason, actor)) },
      },
      { session },
    );
    if (updateResult.modifiedCount !== 1) {
      throw Object.assign(new Error("Payout status changed while failure or reversal was being recorded"), {
        status: 409,
        code: "PAYOUT_CONCURRENT_UPDATE",
      });
    }
    return getWithdrawal(row.withdrawalId, "", session);
  }, { operationLabel: "Partner payout operations" });
}

async function handleWebhook(event = {}) {
  const payout = event?.payload?.payout?.entity || event?.payload?.payout || {};
  if (!payout.id) return { ignored: true };
  let row = await AgentWithdrawal.findOne({ razorpayPayoutId: payout.id }).lean();
  if (!row && payout.reference_id) row = await AgentWithdrawal.findOne({ withdrawalNumber: payout.reference_id }).lean();
  if (!row) return { ignored: true };
  const eventName = String(event.event || "");
  if (eventName === "payout.processed" || payout.status === "processed") return markPaid(row.withdrawalId, payout);
  if (eventName === "payout.reversed" || payout.status === "reversed") return markPayoutFailed(row.withdrawalId, payout, "payout_reversed");
  if (eventName === "payout.failed" || payout.status === "failed" || payout.status === "cancelled" || payout.status === "rejected") return markPayoutFailed(row.withdrawalId, payout, "payout_failed");
  await AgentWithdrawal.updateOne({ withdrawalId: row.withdrawalId }, { $set: { razorpayPayoutStatus: payout.status || eventName, razorpayStatusDetails: payoutStatusDetails(payout.status_details), updatedAt: new Date() } });
  return getWithdrawal(row.withdrawalId);
}

async function assertRequirementNotPayoutProcessing(enquiry = {}, session = null) {
  if (enquiry.partnerPayoutLockWithdrawalId) {
    throw Object.assign(new Error("This referral is locked while its Razorpay payout is processing"), {
      status: 409,
      code: "REFERRAL_PAYOUT_LOCKED",
    });
  }
  if (!enquiry.partnerWithdrawalId || enquiry.partnerPayoutStatus !== "reserved") return true;
  let lookup = AgentWithdrawal.findOne({
    withdrawalId: enquiry.partnerWithdrawalId,
    status: "payout_processing",
  }).select({ withdrawalId: 1 });
  if (session) lookup = lookup.session(session);
  const processing = await lookup.lean();
  if (processing) {
    throw Object.assign(new Error("This referral is locked while its Razorpay payout is processing"), {
      status: 409,
      code: "REFERRAL_PAYOUT_LOCKED",
    });
  }
  return true;
}

function unlockedReferralQuery(enquiryId) {
  return {
    enquiryId,
    $or: [
      { partnerPayoutLockWithdrawalId: "" },
      { partnerPayoutLockWithdrawalId: null },
      { partnerPayoutLockWithdrawalId: { $exists: false } },
    ],
  };
}

async function markEligibilityChangedInSession(enquiry, reason, actor, session) {
  if (!enquiry?.partnerWithdrawalId || enquiry.partnerPayoutStatus !== "reserved") return null;
  const withdrawal = await AgentWithdrawal.findOne({
    withdrawalId: enquiry.partnerWithdrawalId,
    status: { $in: ACTIVE_WITHDRAWAL_STATUSES },
  }).session(session).lean();
  if (!withdrawal) return null;
  if (withdrawal.status === "payout_processing" || enquiry.partnerPayoutLockWithdrawalId) {
    throw Object.assign(new Error("This referral is locked while its Razorpay payout is processing"), {
      status: 409,
      code: "REFERRAL_PAYOUT_LOCKED",
    });
  }
  await releaseRequirements(withdrawal.withdrawalId, session);
  const result = await AgentWithdrawal.updateOne(
    { withdrawalId: withdrawal.withdrawalId, status: withdrawal.status },
    {
      $set: {
        status: "eligibility_changed",
        activeSlot: "",
        payoutFailureReason: reason,
        updatedBy: actor,
        updatedAt: new Date(),
      },
      $push: {
        approvalHistory: historyPush(
          auditEntry("eligibility_changed", withdrawal.status, "eligibility_changed", reason, actor),
        ),
      },
    },
    { session },
  );
  if (result.modifiedCount !== 1) {
    throw Object.assign(new Error("Withdrawal eligibility changed concurrently. Refresh and try again."), {
      status: 409,
      code: "WITHDRAWAL_CONCURRENT_UPDATE",
    });
  }
  return getWithdrawal(withdrawal.withdrawalId, "", session);
}

async function markEligibilityChangedForRequirement(enquiryId, reason, actor = "crm-admin") {
  return withTransaction(async (session) => {
    const enquiry = await Enquiry.findOne({ enquiryId }).session(session).lean();
    if (!enquiry) return null;
    return markEligibilityChangedInSession(enquiry, reason, actor, session);
  }, { operationLabel: "Partner withdrawal operations" });
}

async function updateReferralValidation(enquiryId, input = {}, actor = "crm-admin") {
  const status = enumValue(input.status, ["valid", "invalid"], { label: "Lead validation status" });
  const method = enumValue(input.method, VALIDATION_METHODS, { label: "Validation method" });
  const noteRequired = status === "invalid" || method === "other";
  const note = textValue(input.note, {
    label: method === "other" ? "Other validation details" : "Validation note",
    required: noteRequired,
    maxLength: 2000,
    preserveWhitespace: true,
  });
  const reason = status === "invalid"
    ? enumValue(input.reason, INVALID_REASONS, { label: "Invalid referral reason" })
    : "";

  return withTransaction(async (session) => {
    const row = await Enquiry.findOne({ enquiryId }).session(session).lean();
    if (!row) throw Object.assign(new Error("Lead not found"), { status: 404 });
    if (canonicalLeadStatus(row.status) === "approved") {
      throw Object.assign(
        new Error("Lead validation is locked after approval because the lead is already published to providers."),
        { status: 409 },
      );
    }
    const agentLead = isAgentLead(row);
    if (agentLead) await assertRequirementNotPayoutProcessing(row, session);
    const now = new Date();
    const payoutStatus = agentLead
      ? (status === "invalid" ? "not_eligible" : (eligibilityDate(row) > now ? "waiting_period" : "unpaid"))
      : "";
    if (agentLead && status !== "valid") {
      await markEligibilityChangedInSession(
        row,
        `Referral changed to ${status}: ${note}`,
        actor,
        session,
      );
    }

    const set = {
      agentReferralValidation: status,
      leadValidationMethod: method,
      agentReferralInvalidReason: reason,
      agentReferralValidationNote: note,
      agentReferralValidatedAt: now,
      agentReferralValidatedBy: actor,
      updatedAt: now,
    };
    if (agentLead) {
      set.partnerEligibilityDate = row.partnerEligibilityDate || eligibilityDate(row);
      set.partnerPayoutStatus = row.partnerPayoutStatus === "paid" ? "paid" : payoutStatus;
      if (status === "invalid") {
        set.partnerWithdrawalId = "";
        set.partnerPayoutLockedAt = null;
        set.partnerPayoutLockWithdrawalId = "";
      }
    }
    const timeline = [{
      timelineId: uuid(),
      type: "lead_validation",
      message: `Lead marked ${status}`,
      method,
      note,
      reason,
      actor,
      createdAt: now,
    }];

    if (status === "invalid" && canonicalLeadStatus(row.status) !== "rejected") {
      const metadata = { ...(row.metadata || {}) };
      metadata.rejectedFromStatus = canonicalLeadStatus(row.status);
      metadata.rejectionReason = note;
      metadata.lastStatusNote = note;
      set.status = "rejected";
      set.marketplaceAvailable = false;
      set.marketplaceStatus = "closed";
      set.statusUpdatedAt = now;
      set.statusUpdatedBy = actor;
      set.metadata = metadata;
      timeline.push({
        timelineId: uuid(),
        type: "status_changed",
        message: "Lead was marked Invalid and automatically changed to Rejected.",
        fromStatus: canonicalLeadStatus(row.status),
        toStatus: "rejected",
        action: "reject",
        method,
        note,
        reason,
        actor,
        createdAt: now,
      });
    }

    const updateResult = await Enquiry.updateOne(
      unlockedReferralQuery(enquiryId),
      { $set: set, $push: { timeline: timelinePush(timeline) } },
      { session },
    );
    if (updateResult.matchedCount !== 1) {
      throw Object.assign(new Error("This referral is locked while its Razorpay payout is processing"), {
        status: 409,
        code: "REFERRAL_PAYOUT_LOCKED",
      });
    }
    return Enquiry.findOne({ enquiryId }).session(session).lean();
  }, { operationLabel: "Partner referral validation" });
}

async function updateSaleConversion(enquiryId, input = {}, actor = "crm-admin") {
  const status = enumValue(input.status, CONVERSION_STATUSES, { label: "Sale conversion status" });
  const note = textValue(input.note, {
    label: "Sale conversion note",
    required: true,
    maxLength: 2000,
    preserveWhitespace: true,
  });

  return withTransaction(async (session) => {
    const row = await Enquiry.findOne({ enquiryId }).session(session).lean();
    if (!row) throw Object.assign(new Error("Lead not found"), { status: 404 });
    if (!isAgentLead(row)) {
      throw validationError("Sale conversion tracking is available only for Agent Portal requirements");
    }
    await assertRequirementNotPayoutProcessing(row, session);
    if (status !== "converted") {
      await markEligibilityChangedInSession(
        row,
        `Sale conversion changed to ${status}: ${note}`,
        actor,
        session,
      );
    }
    const now = new Date();
    const set = {
      agentSaleConversion: status,
      agentSaleConversionNote: note,
      agentSaleConvertedAt: status === "converted" ? now : null,
      agentSaleConvertedBy: actor,
      updatedAt: now,
    };
    if (status !== "converted" && row.partnerPayoutStatus === "reserved") {
      set.partnerPayoutStatus = "unpaid";
      set.partnerWithdrawalId = "";
      set.partnerPayoutLockedAt = null;
      set.partnerPayoutLockWithdrawalId = "";
    }
    const result = await Enquiry.updateOne(
      unlockedReferralQuery(enquiryId),
      {
        $set: set,
        $push: {
          timeline: timelinePush({
            timelineId: uuid(),
            type: "agent_sale_conversion",
            message: `Agent referral sale marked ${status}`,
            note,
            actor,
            createdAt: now,
          }),
        },
      },
      { session },
    );
    if (result.matchedCount !== 1) {
      throw Object.assign(new Error("This referral is locked while its Razorpay payout is processing"), {
        status: 409,
        code: "REFERRAL_PAYOUT_LOCKED",
      });
    }
    return Enquiry.findOne({ enquiryId }).session(session).lean();
  }, { operationLabel: "Partner sale conversion update" });
}

module.exports = {
  WAITING_PERIOD_MS,
  ACTIVE_WITHDRAWAL_STATUSES,
  WITHDRAWAL_STATUSES,
  VALIDATION_STATUSES,
  VALIDATION_METHODS,
  CONVERSION_STATUSES,
  INVALID_REASONS,
  isAgentLead,
  eligibilityDate,
  calculateEligibility,
  summaryForAgent,
  submitWithdrawal,
  listWithdrawals,
  listAgentWithdrawals,
  getWithdrawal,
  transitionWithdrawal,
  processPayout,
  handleWebhook,
  markPaid,
  markPayoutFailed,
  markEligibilityChangedForRequirement,
  assertRequirementNotPayoutProcessing,
  updateReferralValidation,
  updateSaleConversion,
  revalidateWithdrawal,
};
