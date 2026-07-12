const LeadDistribution = require("../../models/LeadDistribution");
const { getPagination, cursorPaginate } = require("../../utils/pagination");
const {
  identifierValue,
  enumValue,
  tokenValue,
} = require("../../utils/validation");

const DISTRIBUTION_STATUSES = Object.freeze([
  "offered",
  "unlocked",
  "withdrawn",
  "expired",
]);

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
  if (filters.status) {
    query.status = enumValue(filters.status, DISTRIBUTION_STATUSES, {
      label: "Distribution status filter",
    });
  }
  if (filters.categorySlug) {
    query.categorySlug = tokenValue(filters.categorySlug, {
      label: "Category filter",
      maxLength: 80,
    });
  }

  return cursorPaginate(LeadDistribution, {
    query,
    sort: { distributedAt: -1, _id: -1 },
    limit,
    cursor,
  });
}

module.exports = { list, DISTRIBUTION_STATUSES };
