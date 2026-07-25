const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const FollowUp = require("../../models/FollowUp");
const Invoice = require("../../models/Invoice");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { presentEnquiry } = require("../enquiry/enquiry-service");

const CACHE_TTL_MS = Math.max(15_000, Number(process.env.DASHBOARD_CACHE_TTL_MS || 60_000));
const COUNT_CAP = Math.min(100_000, Math.max(1_000, Number(process.env.DASHBOARD_COUNT_CAP || 10_000)));
let dashboardCache = null;
let dashboardCacheExpiresAt = 0;

async function boundedCount(Model, query, cap = COUNT_CAP) {
  const rows = await Model.find(query)
    .select({ _id: 1 })
    .limit(cap + 1)
    .lean();
  return { value: Math.min(rows.length, cap), capped: rows.length > cap };
}

async function buildDashboard() {
  const [
    totalLeads,
    newLeads,
    verificationLeads,
    approvedLeads,
    rejectedLeads,
    providers,
    activeProviders,
    openFollowUps,
    invoices,
    marketplaceAvailable,
    unlocked,
    recentLeads,
  ] = await Promise.all([
    Enquiry.estimatedDocumentCount(),
    boundedCount(Enquiry, { status: "new" }),
    boundedCount(Enquiry, { status: "verification" }),
    boundedCount(Enquiry, { status: "approved" }),
    boundedCount(Enquiry, { status: "rejected" }),
    Provider.estimatedDocumentCount(),
    boundedCount(Provider, { status: "active", portalAccessEnabled: { $ne: false } }),
    boundedCount(FollowUp, { status: { $in: ["open", "pending"] } }),
    Invoice.estimatedDocumentCount(),
    boundedCount(Enquiry, { marketplaceAvailable: true, marketplaceStatus: "published" }),
    ProviderLeadUnlock.estimatedDocumentCount(),
    Enquiry.find()
      .select({ enquiryId: 1, requirementTitle: 1, name: 1, category: 1, categorySlug: 1, status: 1, priority: 1, createdAt: 1, updatedAt: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .lean(),
  ]);

  return {
    totalLeads,
    providers,
    activeProviders: activeProviders.value,
    openFollowUps: openFollowUps.value,
    invoices,
    offered: marketplaceAvailable.value,
    marketplaceAvailable: marketplaceAvailable.value,
    unlocked,
    statusCounts: {
      new: newLeads.value,
      verification: verificationLeads.value,
      approved: approvedLeads.value,
      rejected: rejectedLeads.value,
    },
    caps: {
      activeProviders: activeProviders.capped,
      openFollowUps: openFollowUps.capped,
      offered: marketplaceAvailable.capped,
      statusCounts: {
        new: newLeads.capped,
        verification: verificationLeads.capped,
        approved: approvedLeads.capped,
        rejected: rejectedLeads.capped,
      },
    },
    countCap: COUNT_CAP,
    recentLeads: recentLeads.map(presentEnquiry),
    generatedAt: new Date(),
  };
}

async function getDashboard(options = {}) {
  const now = Date.now();
  if (!options.refresh && dashboardCache && dashboardCacheExpiresAt > now) {
    return dashboardCache;
  }
  dashboardCache = await buildDashboard();
  dashboardCacheExpiresAt = now + CACHE_TTL_MS;
  return dashboardCache;
}

function clearDashboardCache() {
  dashboardCache = null;
  dashboardCacheExpiresAt = 0;
}

module.exports = {
  COUNT_CAP,
  boundedCount,
  buildDashboard,
  getDashboard,
  clearDashboardCache,
};
