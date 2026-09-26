const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const { applyDateRange, dateSort } = require("../../utils/date-query");
const {
  identifierValue,
  enumValue,
  tokenValue,
} = require("../../utils/validation");

const UNLOCK_METHODS = Object.freeze(["credits", "direct_payment", "admin"]);
const SALE_OUTCOMES = Object.freeze(["confirmed", "not_confirmed"]);
const CREDIT_REFUND_STATUSES = Object.freeze(["pending_review", "refunded", "kept_charged"]);

async function list(filters = {}) {
  const { limit, cursor } = getPagination(filters);
  const query = {};
  if (filters.providerId) {
    query.providerId = identifierValue(filters.providerId, {
      label: "Provider ID filter",
    });
  }
  if (filters.enquiryId) {
    query.enquiryId = identifierValue(filters.enquiryId, {
      label: "Requirement ID filter",
    });
  }
  if (filters.unlockMethod) {
    query.unlockMethod = enumValue(filters.unlockMethod, UNLOCK_METHODS, {
      label: "Unlock method filter",
    });
  }
  if (filters.outcome) {
    query.providerSaleOutcome = enumValue(filters.outcome, SALE_OUTCOMES, {
      label: "Provider outcome filter",
    });
  }
  if (filters.refundStatus) {
    const refundStatus = enumValue(filters.refundStatus, CREDIT_REFUND_STATUSES, {
      label: "Credit refund status filter",
    });
    if (refundStatus === "pending_review") {
      query.$or = [
        { creditRefundStatus: { $exists: false } },
        { creditRefundStatus: "" },
        { creditRefundStatus: "pending_review" },
      ];
      query.unlockMethod = "credits";
      query.chargedCredits = { $gt: 0 };
    } else {
      query.creditRefundStatus = refundStatus;
    }
  }
  if (filters.categorySlug) {
    query.categorySlug = tokenValue(filters.categorySlug, {
      label: "Category filter",
      maxLength: 80,
    });
  }

  applyDateRange(query, filters, {
    fields: {
      unlockedAt: "Unlocked date",
      updatedAt: "Updated date",
      providerSaleOutcomeUpdatedAt: "Outcome updated date",
    },
    defaultField: "unlockedAt",
  });

  const result = await cursorPaginate(ProviderLeadUnlock, {
    query,
    sort: dateSort(filters, {
      fields: ["unlockedAt", "updatedAt", "providerSaleOutcomeUpdatedAt"],
      defaultField: "unlockedAt",
    }),
    limit,
    cursor,
  });

  const enquiryIds = [...new Set(result.data.map((row) => row.enquiryId).filter(Boolean))];
  const blockers = enquiryIds.length
    ? await ProviderLeadUnlock.find({
        enquiryId: { $in: enquiryIds },
        providerSaleOutcome: { $ne: "not_confirmed" },
      }).select({ enquiryId: 1 }).lean()
    : [];
  const blockedIds = new Set(blockers.map((row) => row.enquiryId));

  return {
    ...result,
    data: result.data.map((row) => ({
      ...row,
      reassignmentEligible: !blockedIds.has(row.enquiryId),
    })),
  };
}

module.exports = {
  list,
  UNLOCK_METHODS,
  SALE_OUTCOMES,
  CREDIT_REFUND_STATUSES,
};
