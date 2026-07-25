const Enquiry = require("../../models/Enquiry");
const LeadDistribution = require("../../models/LeadDistribution");
const uuid = require("../../utils/uuid");
const {
  canonicalLeadStatus,
  PROVIDER_CONTROLLED_STATUS,
} = require("../../utils/lead-journey");
const {
  PROVIDER_LEAD_STATUSES,
  PROVIDER_SALE_OUTCOMES,
  providerStatusFromEvent,
  providerOutcomeFromEvent,
} = require("../../utils/provider-lead-status");
const {
  identifierValue,
  enumValue,
  textValue,
  validationError,
} = require("../../utils/validation");
const notificationService = require("../communication/notification-service");

const REASON_REQUIRED_STATUSES = Object.freeze([
  "rejected",
  "invalid",
  "not_interested",
  "other",
]);

function enquiryQuery(enquiryId) {
  const value = identifierValue(enquiryId, { label: "Lead Reference ID" });
  return { $or: [{ enquiryId: value }, { id: value }] };
}

function providerLabel(distribution = {}) {
  return (
    distribution.providerBusinessName ||
    distribution.providerName ||
    distribution.providerId ||
    "Provider"
  );
}

function statusActor(distribution = {}, fallback = "provider-status-sync") {
  const providerId = String(distribution.providerId || "").trim();
  return providerId ? `provider:${providerId}` : fallback;
}

function distributionLookup(input = {}) {
  const leadDistributionId = String(input.leadDistributionId || "").trim();
  if (leadDistributionId) {
    return {
      leadDistributionId: identifierValue(leadDistributionId, {
        label: "Lead distribution ID",
      }),
    };
  }

  const enquiryId = identifierValue(
    input.enquiryId || input.lead?.enquiryId || input.lead?.id,
    { label: "Lead Reference ID" },
  );
  const providerId = identifierValue(
    input.providerId || input.provider?.providerId || input.provider?.id,
    { label: "Provider ID" },
  );
  return { enquiryId, providerId };
}

function confirmedOutcomeQuery(reference) {
  return {
    enquiryId: reference,
    contactUnlocked: true,
    $or: [
      { providerSaleOutcome: "confirmed" },
      {
        $and: [
          { $or: [{ providerSaleOutcome: "" }, { providerSaleOutcome: { $exists: false } }] },
          { providerLeadStatus: "confirmed" },
        ],
      },
    ],
  };
}

async function syncSaleConversion(
  enquiryId,
  {
    actor = "provider-status-sync",
    triggerDistribution = null,
    notify = true,
  } = {},
) {
  const query = enquiryQuery(enquiryId);
  const lead = await Enquiry.findOne(query).lean();
  if (!lead) {
    throw Object.assign(new Error("Lead not found"), { status: 404 });
  }

  const reference = lead.enquiryId || lead.id || enquiryId;
  const confirmedProviders = await LeadDistribution.find(confirmedOutcomeQuery(reference))
    .sort({ providerSaleOutcomeUpdatedAt: -1, providerLeadStatusUpdatedAt: -1, updatedAt: -1, _id: -1 })
    .select({
      leadDistributionId: 1,
      providerId: 1,
      providerName: 1,
      providerBusinessName: 1,
      providerSaleOutcomeUpdatedAt: 1,
      providerLeadStatusUpdatedAt: 1,
      updatedAt: 1,
    })
    .lean();

  const confirmedCount = confirmedProviders.length;
  const latestConfirmed = confirmedProviders[0] || null;
  const currentStatus = canonicalLeadStatus(lead.status);
  const conversionStage = ["distributed", PROVIDER_CONTROLLED_STATUS].includes(currentStatus);
  const targetStatus = confirmedCount > 0 ? PROVIDER_CONTROLLED_STATUS : "distributed";
  const now = new Date();
  const changedStatus = conversionStage && currentStatus !== targetStatus;
  const trigger = triggerDistribution || latestConfirmed || {};
  const providerName = providerLabel(trigger);
  const providerId = String(trigger.providerId || "").trim();
  const updateActor = actor || statusActor(trigger);

  const expectedConversionStatus = conversionStage
    ? (confirmedCount > 0 ? "converted" : "not_converted")
    : "pending";
  const expectedProviderId = String(latestConfirmed?.providerId || "").trim();
  const expectedProviderName = latestConfirmed ? providerLabel(latestConfirmed) : "";
  const set = {
    providerConfirmedCount: confirmedCount,
    providerSaleConversionStatus: expectedConversionStatus,
    providerSaleConversionUpdatedAt: now,
    providerSaleConversionProviderId: expectedProviderId,
    providerSaleConversionProviderName: expectedProviderName,
    updatedAt: now,
  };

  if (conversionStage) {
    set.status = targetStatus;
    if (changedStatus) {
      set.statusUpdatedAt = now;
      set.statusUpdatedBy = updateActor;
    }
    if (confirmedCount > 0) {
      set.providerSaleConvertedAt = lead.providerSaleConvertedAt || now;
      set.providerSaleConvertedBy = String(latestConfirmed?.providerId || providerId || updateActor).trim();
    } else {
      set.providerSaleConvertedAt = null;
      set.providerSaleConvertedBy = "";
    }

    if (lead.agentId) {
      set.agentSaleConversion = confirmedCount > 0 ? "converted" : "not_converted";
      set.agentSaleConversionNote = confirmedCount > 0
        ? `${providerLabel(latestConfirmed || trigger)} currently confirms the lead`
        : "No unlocked provider currently confirms the lead";
      set.agentSaleConvertedAt = confirmedCount > 0 ? lead.agentSaleConvertedAt || now : null;
      set.agentSaleConvertedBy = confirmedCount > 0
        ? String(latestConfirmed?.providerId || providerId || updateActor).trim()
        : updateActor;
    }
  }

  const summaryChanged =
    Number(lead.providerConfirmedCount || 0) !== confirmedCount ||
    String(lead.providerSaleConversionStatus || "pending") !== expectedConversionStatus ||
    String(lead.providerSaleConversionProviderId || "") !== expectedProviderId ||
    String(lead.providerSaleConversionProviderName || "") !== expectedProviderName;
  const agentConversionChanged = Boolean(
    conversionStage &&
    lead.agentId &&
    String(lead.agentSaleConversion || "pending") !==
      (confirmedCount > 0 ? "converted" : "not_converted"),
  );

  if (!changedStatus && !summaryChanged && !agentConversionChanged) {
    return { changed: false, confirmedCount, status: currentStatus, lead };
  }

  const update = { $set: set };
  let timelineEntry = null;
  if (changedStatus) {
    const converted = targetStatus === PROVIDER_CONTROLLED_STATUS;
    timelineEntry = {
      timelineId: uuid(),
      type: converted ? "provider_sale_conversion" : "provider_sale_conversion_reverted",
      message: converted
        ? `${providerName} marked the sale Confirmed. Status automatically changed to Sale Converted.`
        : "No unlocked provider remains Confirmed. Status automatically returned to Distributed.",
      fromStatus: currentStatus,
      toStatus: targetStatus,
      providerId,
      providerName,
      actor: updateActor,
      createdAt: now,
    };
    update.$push = { timeline: timelineEntry };
  }

  await Enquiry.updateOne(query, update);

  if (
    changedStatus &&
    targetStatus === "distributed" &&
    lead.agentId &&
    lead.partnerWithdrawalId &&
    lead.partnerPayoutStatus === "reserved"
  ) {
    await require("../partner-payout/partner-payout-service")
      .markEligibilityChangedForRequirement(
        reference,
        "Provider confirmation was removed; sale conversion reverted to Distributed",
        updateActor,
      );
  }

  const updatedLead = await Enquiry.findOne(query).lean();
  if (changedStatus && notify) {
    await notificationService.triggerSafe(
      "sale_conversion_updated",
      {
        lead: updatedLead,
        status: targetStatus,
        note: timelineEntry?.message || "",
        provider: trigger,
        trigger: "provider_outcome_changed",
        idempotencySuffix: now.toISOString(),
      },
      updateActor,
    );
  }

  return {
    changed: changedStatus,
    confirmedCount,
    status: conversionStage ? targetStatus : currentStatus,
    lead: updatedLead,
  };
}

function normalizeFeedback(input = {}, current = {}) {
  const legacyStatus = String(input.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const requestedOutcome = input.outcome || input.providerSaleOutcome ||
    (PROVIDER_SALE_OUTCOMES.includes(legacyStatus) ? legacyStatus : "");
  const requestedActivity = input.activityStatus || input.providerLeadStatus ||
    (PROVIDER_LEAD_STATUSES.includes(legacyStatus) ? legacyStatus : "");

  const outcome = enumValue(requestedOutcome, PROVIDER_SALE_OUTCOMES, {
    label: "Provider sale outcome",
    fallback: current.providerSaleOutcome ||
      (current.providerLeadStatus === "confirmed" ? "confirmed" : ""),
  });
  const activityStatus = requestedActivity
    ? enumValue(requestedActivity, PROVIDER_LEAD_STATUSES, { label: "Provider activity status" })
    : "";
  const reason = textValue(input.reason, { label: "Provider status reason", maxLength: 120 });
  const note = textValue(input.note, {
    label: "Provider status note",
    maxLength: 2000,
    preserveWhitespace: true,
  });
  const outcomeNote = textValue(input.outcomeNote || input.providerSaleOutcomeNote, {
    label: "Provider outcome note",
    maxLength: 2000,
    preserveWhitespace: true,
  });

  if (REASON_REQUIRED_STATUSES.includes(activityStatus) && !reason && !note) {
    throw validationError(
      `A reason or note is required when a provider marks an activity ${activityStatus.replace(/_/g, " ")}`,
    );
  }
  if (!outcome) {
    throw validationError("Provider must select Confirmed or Not Confirmed");
  }
  return { outcome, outcomeNote, activityStatus, reason, note };
}

async function updateProviderLeadFeedback(input = {}, actor = "provider-integration") {
  const lookup = distributionLookup(input);
  const distribution = await LeadDistribution.findOne(lookup).lean();
  if (!distribution) {
    throw Object.assign(new Error("Provider lead distribution not found"), { status: 404 });
  }
  if (distribution.contactUnlocked !== true) {
    throw Object.assign(new Error("The provider must unlock the lead before updating its outcome"), { status: 409 });
  }

  const feedback = normalizeFeedback(input, distribution);
  const now = new Date();
  const updateActor = actor || statusActor(distribution);
  const currentOutcome = distribution.providerSaleOutcome ||
    (distribution.providerLeadStatus === "confirmed" ? "confirmed" : "");
  const currentActivity = distribution.providerLeadStatus === "confirmed"
    ? ""
    : String(distribution.providerLeadStatus || "");
  const outcomeChanged =
    currentOutcome !== feedback.outcome ||
    String(distribution.providerSaleOutcomeNote || "") !== feedback.outcomeNote;
  const activityChanged =
    currentActivity !== feedback.activityStatus ||
    String(distribution.providerLeadReason || "") !== feedback.reason ||
    String(distribution.providerLeadNote || "") !== feedback.note;

  const set = {
    providerSaleOutcome: feedback.outcome,
    providerSaleOutcomeNote: feedback.outcomeNote,
    providerSaleOutcomeUpdatedAt: outcomeChanged
      ? now
      : distribution.providerSaleOutcomeUpdatedAt || now,
    providerSaleOutcomeUpdatedBy: outcomeChanged
      ? updateActor
      : distribution.providerSaleOutcomeUpdatedBy || updateActor,
    providerLeadStatus: feedback.activityStatus,
    providerLeadReason: feedback.reason,
    providerLeadNote: feedback.note,
    providerLeadStatusUpdatedAt: activityChanged && feedback.activityStatus
      ? now
      : distribution.providerLeadStatusUpdatedAt || null,
    providerLeadStatusUpdatedBy: activityChanged && feedback.activityStatus
      ? updateActor
      : distribution.providerLeadStatusUpdatedBy || "",
    crmSyncStatus: "synced",
    crmSyncError: "",
    crmSyncUpdatedAt: now,
    updatedAt: now,
  };

  if (outcomeChanged) {
    set.outcomeVerificationStatus = "pending_review";
    set.outcomeVerificationNote = "";
    set.outcomeVerifiedAt = null;
    set.outcomeVerifiedBy = "";
  }

  const update = { $set: set };
  const push = {};
  if (outcomeChanged) {
    push.providerSaleOutcomeHistory = {
      historyId: uuid(),
      fromOutcome: currentOutcome,
      outcome: feedback.outcome,
      note: feedback.outcomeNote,
      actor: updateActor,
      createdAt: now,
    };
  }
  if (activityChanged) {
    push.providerLeadStatusHistory = {
      historyId: uuid(),
      fromStatus: currentActivity,
      status: feedback.activityStatus,
      toStatus: feedback.activityStatus,
      reason: feedback.reason,
      note: feedback.note,
      actor: updateActor,
      providerLeadStatusUpdatedBy: updateActor,
      createdAt: now,
    };
  }
  if (Object.keys(push).length) update.$push = push;

  await LeadDistribution.updateOne(
    { leadDistributionId: distribution.leadDistributionId },
    update,
  );

  const updatedDistribution = await LeadDistribution.findOne({
    leadDistributionId: distribution.leadDistributionId,
  }).lean();
  const conversion = await syncSaleConversion(distribution.enquiryId, {
    actor: updateActor,
    triggerDistribution: updatedDistribution,
  });

  return {
    distribution: updatedDistribution,
    lead: conversion.lead,
    changes: { outcomeChanged, activityChanged },
    conversion: {
      changed: conversion.changed,
      status: conversion.status,
      confirmedCount: conversion.confirmedCount,
    },
  };
}

async function updateProviderLeadStatus(input = {}, actor = "provider-integration") {
  return updateProviderLeadFeedback(input, actor);
}

module.exports = {
  PROVIDER_LEAD_STATUSES,
  PROVIDER_SALE_OUTCOMES,
  REASON_REQUIRED_STATUSES,
  providerStatusFromEvent,
  providerOutcomeFromEvent,
  syncSaleConversion,
  updateProviderLeadFeedback,
  updateProviderLeadStatus,
  distributionLookup,
  normalizeFeedback,
};
