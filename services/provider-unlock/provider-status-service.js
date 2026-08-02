const Enquiry = require("../../models/Enquiry");
const ProviderLeadUnlock = require("../../models/ProviderLeadUnlock");
const { withTransaction } = require("../../utils/transaction");
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

function providerLabel(unlock = {}) {
  return unlock.providerBusinessName
    || unlock.providerName
    || unlock.providerId
    || "Provider";
}

function statusActor(unlock = {}, fallback = "provider-status-sync") {
  const providerId = String(unlock.providerId || "").trim();
  return providerId ? `provider:${providerId}` : fallback;
}

function unlockLookup(input = {}) {
  const providerLeadUnlockId = String(
    input.providerLeadUnlockId || "",
  ).trim();
  if (providerLeadUnlockId) {
    return {
      providerLeadUnlockId: identifierValue(providerLeadUnlockId, {
        label: "Provider lead unlock ID",
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

function normalizeFeedback(input = {}, current = {}) {
  const legacyStatus = String(input.status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const requestedOutcome = input.outcome
    || input.providerSaleOutcome
    || (PROVIDER_SALE_OUTCOMES.includes(legacyStatus) ? legacyStatus : "");
  const requestedActivity = input.activityStatus
    || input.providerLeadStatus
    || (PROVIDER_LEAD_STATUSES.includes(legacyStatus) ? legacyStatus : "");

  const outcome = enumValue(requestedOutcome, PROVIDER_SALE_OUTCOMES, {
    label: "Provider sale outcome",
    fallback: current.providerSaleOutcome || "",
  });
  const activityStatus = requestedActivity
    ? enumValue(requestedActivity, PROVIDER_LEAD_STATUSES, {
        label: "Provider activity status",
      })
    : "";
  const reason = textValue(input.reason, {
    label: "Provider status reason",
    maxLength: 120,
  });
  const note = textValue(input.note, {
    label: "Provider status note",
    maxLength: 2000,
    preserveWhitespace: true,
  });
  const outcomeNote = textValue(
    input.outcomeNote || input.providerSaleOutcomeNote,
    {
      label: "Provider outcome note",
      maxLength: 2000,
      preserveWhitespace: true,
    },
  );

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

function parseIntegrationEventSequence(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw validationError("Integration event sequence must be a positive integer number");
  }
  return value;
}

function storedSequence(value, label) {
  const sequence = Number(value || 0);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw Object.assign(new Error(`${label} is invalid in shared CRM state`), {
      code: "CRM_SYNC_SEQUENCE_STATE_INVALID",
    });
  }
  return sequence;
}

async function syncSaleConversion(enquiryId, { actor = "provider-status-sync", notify = false } = {}) {
  const lead = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
  const confirmedCount = Math.max(0, Number(lead.providerConfirmedCount || 0));
  const expectedStatus = confirmedCount > 0 ? "converted" : "not_converted";
  if (lead.providerSaleConversionStatus === expectedStatus) {
    return { changed: false, confirmedCount, status: expectedStatus, lead };
  }
  const now = new Date();
  await Enquiry.updateOne(enquiryQuery(enquiryId), {
    $set: {
      providerSaleConversionStatus: expectedStatus,
      providerSaleConversionUpdatedAt: now,
      updatedAt: now,
    },
  });
  const updated = await Enquiry.findOne(enquiryQuery(enquiryId)).lean();
  if (notify) {
    await notificationService.triggerSafe("sale_conversion_updated", {
      lead: updated,
      status: expectedStatus,
      note: `Provider sale conversion changed to ${expectedStatus}`,
      trigger: "provider_outcome_changed",
      idempotencySuffix: now.toISOString(),
    }, actor);
  }
  return { changed: true, confirmedCount, status: expectedStatus, lead: updated };
}

async function updateProviderLeadFeedback(input = {}, actor = "provider-integration") {
  const lookup = unlockLookup(input);
  const incomingSequence = parseIntegrationEventSequence(input.integrationEventSequence);
  const integrationEventId = String(input.integrationEventId || "").trim();

  const result = await withTransaction(async (session) => {
    const unlock = await ProviderLeadUnlock.findOne(lookup).session(session);
    if (!unlock) {
      throw Object.assign(new Error("Provider lead unlock not found"), { status: 404 });
    }

    const appliedSequence = storedSequence(
      unlock.crmSyncAppliedSequence,
      "Applied CRM sync sequence",
    );
    const committedSequence = storedSequence(
      unlock.crmSyncSequence,
      "Committed CRM sync sequence",
    );
    const latestSequence = Math.max(appliedSequence, committedSequence);
    if (incomingSequence > 0 && committedSequence > 0 && incomingSequence > committedSequence) {
      throw Object.assign(
        validationError("Integration event sequence is newer than the committed provider state"),
        { code: "CRM_SYNC_SEQUENCE_AHEAD" },
      );
    }
    const isStale = incomingSequence > 0 && incomingSequence < latestSequence;
    const isDuplicate = incomingSequence > 0
      && incomingSequence === appliedSequence
      && incomingSequence === latestSequence;
    const isUnsequencedReplay = incomingSequence === 0
      && latestSequence > 0
      && Boolean(integrationEventId);

    // Once sequenced events have been applied, never let an older or
    // unsequenced replay overwrite the latest provider feedback. A duplicate of
    // the currently applied sequence is a state no-op, but the controller may
    // still retry idempotent communications if the previous response was lost.
    if (isStale || isDuplicate || isUnsequencedReplay) {
      const lead = await Enquiry.findOne(enquiryQuery(unlock.enquiryId)).session(session);
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      const confirmedCount = Math.max(0, Number(lead.providerConfirmedCount || 0));
      const conversionStatus = lead.providerSaleConversionStatus
        || (confirmedCount > 0 ? "converted" : "not_converted");
      return {
        unlock: unlock.toObject(),
        lead: lead.toObject(),
        conversionChanged: false,
        conversionStatus,
        confirmedCount,
        outcomeChanged: false,
        activityChanged: false,
        updateActor: actor || statusActor(unlock),
        stale: isStale || isUnsequencedReplay,
        duplicate: isDuplicate,
      };
    }

    const feedback = normalizeFeedback(input, unlock.toObject());
    const now = new Date();
    const updateActor = actor || statusActor(unlock);
    const oldConfirmed = unlock.providerSaleOutcome === "confirmed";
    const newConfirmed = feedback.outcome === "confirmed";
    const confirmationDelta = Number(newConfirmed) - Number(oldConfirmed);
    const outcomeChanged = unlock.providerSaleOutcome !== feedback.outcome
      || String(unlock.providerSaleOutcomeNote || "") !== feedback.outcomeNote;
    const activityChanged = String(unlock.providerLeadStatus || "") !== feedback.activityStatus
      || String(unlock.providerLeadReason || "") !== feedback.reason
      || String(unlock.providerLeadNote || "") !== feedback.note;

    unlock.providerSaleOutcome = feedback.outcome;
    unlock.providerSaleOutcomeNote = feedback.outcomeNote;
    unlock.providerSaleOutcomeUpdatedAt = outcomeChanged
      ? now
      : unlock.providerSaleOutcomeUpdatedAt || now;
    unlock.providerSaleOutcomeUpdatedBy = outcomeChanged
      ? updateActor
      : unlock.providerSaleOutcomeUpdatedBy || updateActor;
    unlock.providerLeadStatus = feedback.activityStatus;
    unlock.providerLeadReason = feedback.reason;
    unlock.providerLeadNote = feedback.note;
    unlock.providerLeadStatusUpdatedAt = activityChanged && feedback.activityStatus
      ? now
      : unlock.providerLeadStatusUpdatedAt || null;
    unlock.providerLeadStatusUpdatedBy = activityChanged && feedback.activityStatus
      ? updateActor
      : unlock.providerLeadStatusUpdatedBy || "";
    if (incomingSequence > appliedSequence) {
      unlock.crmSyncAppliedSequence = incomingSequence;
    }
    const eventMatchesCurrent = !integrationEventId
      || !unlock.crmSyncCurrentEventId
      || integrationEventId === unlock.crmSyncCurrentEventId;
    if (eventMatchesCurrent) {
      unlock.crmSyncStatus = "synced";
      unlock.crmSyncError = "";
      unlock.crmSyncUpdatedAt = now;
    }
    if (outcomeChanged) {
      unlock.outcomeVerificationStatus = "pending_review";
      unlock.outcomeVerificationNote = "";
      unlock.outcomeVerifiedAt = null;
      unlock.outcomeVerifiedBy = "";
    }
    await unlock.save({ session });

    const lead = await Enquiry.findOne(enquiryQuery(unlock.enquiryId)).session(session);
    if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });

    const previousConversionStatus = lead.providerSaleConversionStatus || "pending";
    const confirmedCount = Math.max(
      0,
      Number(lead.providerConfirmedCount || 0) + confirmationDelta,
    );
    const conversionStatus = confirmedCount > 0 ? "converted" : "not_converted";
    lead.providerConfirmedCount = confirmedCount;
    lead.providerSaleConversionStatus = conversionStatus;
    lead.providerSaleConversionUpdatedAt = now;
    lead.providerSaleConvertedAt = confirmedCount > 0
      ? lead.providerSaleConvertedAt || now
      : null;
    if (lead.agentId) {
      lead.agentSaleConversion = conversionStatus;
      lead.agentSaleConversionNote = confirmedCount > 0
        ? `${providerLabel(unlock)} currently confirms the lead`
        : "No unlocked provider currently confirms the lead";
      lead.agentSaleConvertedAt = confirmedCount > 0
        ? lead.agentSaleConvertedAt || now
        : null;
      lead.agentSaleConvertedBy = confirmedCount > 0 ? unlock.providerId : updateActor;
    }
    await lead.save({ session });

    return {
      unlock: unlock.toObject(),
      lead: lead.toObject(),
      conversionChanged: previousConversionStatus !== conversionStatus,
      conversionStatus,
      confirmedCount,
      outcomeChanged,
      activityChanged,
      updateActor,
      stale: false,
      duplicate: false,
    };
  });

  if (!result.stale && !result.duplicate && result.conversionChanged) {
    await notificationService.triggerSafe("sale_conversion_updated", {
      lead: result.lead,
      status: result.conversionStatus,
      note: `${providerLabel(result.unlock)} marked the lead ${result.unlock.providerSaleOutcome.replace(/_/g, " ")}`,
      provider: result.unlock,
      trigger: "provider_outcome_changed",
      idempotencySuffix: result.unlock.providerSaleOutcomeUpdatedAt || new Date().toISOString(),
    }, result.updateActor);
  }

  return {
    unlock: result.unlock,
    lead: result.lead,
    stale: result.stale,
    duplicate: result.duplicate,
    changes: {
      outcomeChanged: result.outcomeChanged,
      activityChanged: result.activityChanged,
    },
    conversion: {
      changed: result.conversionChanged,
      status: result.conversionStatus,
      confirmedCount: result.confirmedCount,
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
  unlockLookup,
  normalizeFeedback,
  parseIntegrationEventSequence,
  storedSequence,
};
