const Enquiry = require("../../models/Enquiry");
const Provider = require("../../models/Provider");
const FollowUp = require("../../models/FollowUp");
const Invoice = require("../../models/Invoice");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const Communication = require("../../models/Communication");
const { presentEnquiry } = require("../enquiry/enquiry-service");

const CACHE_TTL_MS = Math.max(15_000, Number(process.env.DASHBOARD_CACHE_TTL_MS || 60_000));
const COUNT_CAP = Math.min(100_000, Math.max(1_000, Number(process.env.DASHBOARD_COUNT_CAP || 10_000)));
const ATTENTION_NO_UNLOCK_MINUTES = Math.min(10_080, Math.max(5, Number(process.env.LEAD_ATTENTION_NO_UNLOCK_MINUTES || 60) || 60));
const ATTENTION_STAGE_HOURS = Math.min(720, Math.max(1, Number(process.env.LEAD_ATTENTION_STAGE_HOURS || 24) || 24));
const ATTENTION_ROW_LIMIT = 20;
let dashboardCache = null;
let dashboardCacheExpiresAt = 0;
let dashboardBuildPromise = null;

async function boundedCount(Model, query, cap = COUNT_CAP) {
  const rows = await Model.aggregate([
    { $match: query },
    { $limit: cap + 1 },
    { $count: "value" },
  ]).option({ maxTimeMS: 5000 });
  const count = Number(rows[0]?.value || 0);
  return { value: Math.min(count, cap), capped: count > cap };
}

function attentionLead(lead = {}, details = {}) {
  return {
    enquiryId: String(lead.enquiryId || lead.id || ""),
    requirementTitle: lead.requirementTitle || lead.serviceType || "Customer requirement",
    name: lead.name || "",
    category: lead.category || lead.categorySlug || "",
    status: lead.status || lead.journeyStatus || "",
    priority: lead.priority || "normal",
    reasonCode: details.reasonCode || "",
    reason: details.reason || "",
    sinceAt: details.sinceAt || lead.updatedAt || lead.createdAt || null,
    severity: details.severity || "medium",
  };
}

async function buildAttentionQueue(now = new Date()) {
  const current = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const noUnlockCutoff = new Date(current.getTime() - ATTENTION_NO_UNLOCK_MINUTES * 60 * 1000);
  const staleStageCutoff = new Date(current.getTime() - ATTENTION_STAGE_HOURS * 60 * 60 * 1000);
  const communicationRetentionDays = Math.max(1, Number(process.env.COMMUNICATION_LOG_RETENTION_DAYS || 7) || 7);
  const communicationCutoff = new Date(current.getTime() - communicationRetentionDays * 24 * 60 * 60 * 1000);
  const leadProjection = {
    enquiryId: 1, id: 1, requirementTitle: 1, serviceType: 1, name: 1,
    category: 1, categorySlug: 1, status: 1, journeyStatus: 1, priority: 1,
    createdAt: 1, updatedAt: 1, marketplacePublishedAt: 1,
  };

  const [noUnlockRows, staleStageRows, failedCommunications] = await Promise.all([
    Enquiry.find({
      isActive: { $ne: false },
      marketplaceAvailable: true,
      marketplaceStatus: "published",
      marketplacePublishedAt: { $lte: noUnlockCutoff },
      $or: [{ unlockedCount: 0 }, { unlockedCount: { $exists: false } }],
    }).select(leadProjection).sort({ marketplacePublishedAt: 1, _id: 1 }).limit(ATTENTION_ROW_LIMIT).lean(),
    Enquiry.find({
      isActive: { $ne: false },
      status: { $in: ["new", "verification"] },
      updatedAt: { $lte: staleStageCutoff },
    }).select(leadProjection).sort({ updatedAt: 1, _id: 1 }).limit(ATTENTION_ROW_LIMIT).lean(),
    Communication.find({
      channel: "whatsapp",
      purpose: "nearby_lead_available",
      status: { $in: ["failed", "rejected"] },
      enquiryId: { $ne: "" },
      createdAt: { $gte: communicationCutoff },
    }).select({ enquiryId: 1, status: 1, failureReason: 1, createdAt: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(ATTENTION_ROW_LIMIT)
      .lean(),
  ]);

  const failedIds = [...new Set(failedCommunications.map((row) => String(row.enquiryId || "").trim()).filter(Boolean))];
  const failedLeads = failedIds.length
    ? await Enquiry.find({ enquiryId: { $in: failedIds } }).select(leadProjection).lean()
    : [];
  const failedLeadById = new Map(failedLeads.map((lead) => [String(lead.enquiryId || lead.id || ""), lead]));
  const attention = new Map();

  const add = (row) => {
    if (!row?.enquiryId) return;
    const rank = { high: 3, medium: 2, low: 1 };
    const currentRow = attention.get(row.enquiryId);
    if (!currentRow || (rank[row.severity] || 0) > (rank[currentRow.severity] || 0)) {
      attention.set(row.enquiryId, row);
    }
  };

  for (const lead of noUnlockRows) {
    add(attentionLead(lead, {
      reasonCode: "published_no_unlock",
      reason: `Published for more than ${ATTENTION_NO_UNLOCK_MINUTES} minutes with no provider unlock`,
      sinceAt: lead.marketplacePublishedAt,
      severity: "medium",
    }));
  }
  for (const lead of staleStageRows) {
    add(attentionLead(lead, {
      reasonCode: "stage_stale",
      reason: `${lead.status === "verification" ? "Verification" : "New"} stage has not changed for ${ATTENTION_STAGE_HOURS}+ hours`,
      sinceAt: lead.updatedAt,
      severity: "low",
    }));
  }
  for (const communication of failedCommunications) {
    const lead = failedLeadById.get(String(communication.enquiryId || ""));
    if (!lead) continue;
    add(attentionLead(lead, {
      reasonCode: "provider_whatsapp_failed",
      reason: communication.failureReason
        ? `Provider WhatsApp failed: ${String(communication.failureReason).slice(0, 180)}`
        : "Provider WhatsApp alert failed",
      sinceAt: communication.createdAt,
      severity: "high",
    }));
  }

  return [...attention.values()]
    .sort((left, right) => {
      const rank = { high: 3, medium: 2, low: 1 };
      const severity = (rank[right.severity] || 0) - (rank[left.severity] || 0);
      if (severity) return severity;
      return new Date(left.sinceAt || 0).getTime() - new Date(right.sinceAt || 0).getTime();
    })
    .slice(0, ATTENTION_ROW_LIMIT);
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
    needsAttention,
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
    buildAttentionQueue(),
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
    needsAttention,
    attentionThresholds: {
      noUnlockMinutes: ATTENTION_NO_UNLOCK_MINUTES,
      stageHours: ATTENTION_STAGE_HOURS,
    },
    generatedAt: new Date(),
  };
}

async function getDashboard(options = {}) {
  const now = Date.now();
  if (!options.refresh && dashboardCache && dashboardCacheExpiresAt > now) {
    return dashboardCache;
  }
  if (!dashboardBuildPromise) {
    dashboardBuildPromise = buildDashboard()
      .then((result) => {
        dashboardCache = result;
        dashboardCacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return result;
      })
      .finally(() => {
        dashboardBuildPromise = null;
      });
  }
  return dashboardBuildPromise;
}

function clearDashboardCache() {
  dashboardCache = null;
  dashboardCacheExpiresAt = 0;
  dashboardBuildPromise = null;
}

module.exports = {
  COUNT_CAP,
  ATTENTION_NO_UNLOCK_MINUTES,
  ATTENTION_STAGE_HOURS,
  ATTENTION_ROW_LIMIT,
  boundedCount,
  buildAttentionQueue,
  buildDashboard,
  getDashboard,
  clearDashboardCache,
};
