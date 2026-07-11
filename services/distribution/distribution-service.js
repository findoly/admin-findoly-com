const LeadDistribution = require("../../models/LeadDistribution");
const { getPagination, pageResult } = require("../../utils/pagination");

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.providerId) query.providerId = filters.providerId;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;

  const [rows, total] = await Promise.all([
    LeadDistribution.find(query)
      .sort({ distributedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LeadDistribution.countDocuments(query),
  ]);

  return pageResult(rows, total, page, limit);
}

module.exports = { list };
