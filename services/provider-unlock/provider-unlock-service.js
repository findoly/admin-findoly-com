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

  return cursorPaginate(ProviderLeadUnlock, {
    query,
    sort: dateSort(filters, {
      fields: ["unlockedAt", "updatedAt", "providerSaleOutcomeUpdatedAt"],
      defaultField: "unlockedAt",
    }),
    limit,
    cursor,
  });
}

module.exports = {
  list,
  UNLOCK_METHODS,
  SALE_OUTCOMES,
};
