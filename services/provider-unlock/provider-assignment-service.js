"use strict";

const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");

function blockingQuery(enquiryId, excludeProviderId = "") {
  const query = {
    enquiryId: String(enquiryId || "").trim(),
    providerSaleOutcome: { $ne: "not_confirmed" },
  };
  if (excludeProviderId) query.providerId = { $ne: String(excludeProviderId) };
  return query;
}

async function findBlockingUnlock(enquiryId, excludeProviderId = "", session = null) {
  let query = ProviderLeadUnlock.findOne(blockingQuery(enquiryId, excludeProviderId))
    .select({
      providerLeadUnlockId: 1,
      providerId: 1,
      providerSaleOutcome: 1,
      unlockedAt: 1,
    });
  if (session) query = query.session(session);
  return query.lean();
}

async function closeForActiveProvider(enquiryId, session = null, now = new Date()) {
  let query = Enquiry.findOne({ $or: [{ enquiryId }, { id: enquiryId }] });
  if (session) query = query.session(session);
  const lead = await query;
  if (!lead) return { closed: false, reason: "lead_missing" };

  const terminalClosure = ["status_change", "invalid", "deactivated", "expired"]
    .includes(String(lead.marketplaceClosureReason || ""));
  const activeLifecycle =
    lead.status === "approved"
    && lead.isActive !== false
    && lead.marketplaceExpiresAt
    && new Date(lead.marketplaceExpiresAt) > now;
  if (terminalClosure || !activeLifecycle) {
    return { closed: false, reason: "lead_not_active" };
  }

  lead.marketplaceAvailable = false;
  lead.marketplaceStatus = "closed";
  lead.marketplaceClosureReason = Number(lead.remainingUnlocks || 0) <= 0
    ? "unlock_limit"
    : "provider_pending";
  lead.updatedAt = now;
  await lead.save({ session });
  return { closed: true, lead: lead.toObject() };
}

async function markReadyForReassignment(enquiryId, session = null, now = new Date()) {
  const blocker = await findBlockingUnlock(enquiryId, "", session);
  if (blocker) return { eligible: false, blocked: true, blocker };

  let query = Enquiry.findOne({ $or: [{ enquiryId }, { id: enquiryId }] });
  if (session) query = query.session(session);
  const lead = await query;
  if (!lead) return { eligible: false, blocked: false, reason: "lead_missing" };

  const activeLifecycle =
    lead.status === "approved"
    && lead.isActive !== false
    && lead.marketplacePublishedAt
    && new Date(lead.marketplacePublishedAt) <= now
    && lead.marketplaceExpiresAt
    && new Date(lead.marketplaceExpiresAt) > now;
  if (!activeLifecycle) return { eligible: false, blocked: false, reason: "lead_not_eligible" };

  lead.marketplaceAvailable = false;
  lead.marketplaceStatus = "closed";
  lead.marketplaceClosureReason = Number(lead.remainingUnlocks || 0) <= 0
    ? "unlock_limit"
    : "provider_pending";
  lead.updatedAt = now;
  await lead.save({ session });
  return { eligible: true, blocked: false, lead: lead.toObject() };
}

module.exports = {
  blockingQuery,
  findBlockingUnlock,
  closeForActiveProvider,
  markReadyForReassignment,
};
