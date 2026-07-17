const LEAD_JOURNEY = Object.freeze([
  "new",
  "verification",
  "approved",
  "distributed",
]);

const PROVIDER_CONTROLLED_STATUS = "sale_converted";

const STATUS_ALIASES = Object.freeze({
  verification_pending: "verification",
  verified: "verification",
  in_progress: "distributed",
  completed: "distributed",
  closed: "distributed",
});

const VALID_STATUS_INPUTS = Object.freeze([
  ...LEAD_JOURNEY,
  "rejected",
  PROVIDER_CONTROLLED_STATUS,
  ...Object.keys(STATUS_ALIASES),
]);
const VALID_ACTIONS = Object.freeze([
  "next",
  "previous",
  "reject",
  "restore",
]);

function canonicalLeadStatus(value) {
  const status = String(value || "new").trim().toLowerCase();
  if (status === "rejected") return "rejected";
  if (status === PROVIDER_CONTROLLED_STATUS) return PROVIDER_CONTROLLED_STATUS;
  if (LEAD_JOURNEY.includes(status)) return status;
  return STATUS_ALIASES[status] || "new";
}

function statusError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function restoreTarget(metadata = {}) {
  const candidate = canonicalLeadStatus(metadata.rejectedFromStatus || "new");
  return LEAD_JOURNEY.includes(candidate) ? candidate : "new";
}

function resolveLeadStatusTransition(currentValue, input = {}, metadata = {}) {
  const currentStatus = canonicalLeadStatus(currentValue);
  const action = String(input.action || "").trim().toLowerCase();
  const rawRequestedStatus = String(input.status || "").trim().toLowerCase();
  if (action && !VALID_ACTIONS.includes(action)) {
    throw statusError("Select next, previous, reject or restore");
  }
  if (rawRequestedStatus && !VALID_STATUS_INPUTS.includes(rawRequestedStatus)) {
    throw statusError("Select a valid lead status");
  }
  const requestedStatus = rawRequestedStatus
    ? canonicalLeadStatus(rawRequestedStatus)
    : "";
  const note = String(input.note || input.reason || "").trim();
  if (note.length > 1000) {
    throw statusError("Status note must be 1000 characters or less");
  }

  let targetStatus = currentStatus;
  let resolvedAction = action;

  if (["distributed", PROVIDER_CONTROLLED_STATUS].includes(currentStatus)) {
    throw statusError(
      "Lead journey is provider-controlled after distribution and cannot be changed by an employee",
    );
  }

  if (requestedStatus === PROVIDER_CONTROLLED_STATUS) {
    throw statusError("Sale conversion can only be updated by an unlocked provider");
  }

  if (action === "reject" || requestedStatus === "rejected") {
    if (currentStatus === "rejected") {
      throw statusError("Lead is already rejected");
    }
    if (!note) throw statusError("Rejection reason is required");
    targetStatus = "rejected";
    resolvedAction = "reject";
  } else if (action === "restore") {
    if (currentStatus !== "rejected") {
      throw statusError("Only a rejected lead can be restored");
    }
    targetStatus = restoreTarget(metadata);
    resolvedAction = "restore";
  } else if (action === "next") {
    if (currentStatus === "rejected") {
      throw statusError("Restore the rejected lead before moving it forward");
    }
    const index = LEAD_JOURNEY.indexOf(currentStatus);
    if (index < 0 || index >= LEAD_JOURNEY.length - 1) {
      throw statusError("Lead is already at the final journey stage");
    }
    targetStatus = LEAD_JOURNEY[index + 1];
  } else if (action === "previous") {
    if (currentStatus === "rejected") {
      targetStatus = restoreTarget(metadata);
      resolvedAction = "restore";
    } else {
      const index = LEAD_JOURNEY.indexOf(currentStatus);
      if (index <= 0) {
        throw statusError("Lead is already at the first journey stage");
      }
      targetStatus = LEAD_JOURNEY[index - 1];
    }
  } else if (requestedStatus) {
    if (currentStatus === "rejected") {
      const restoreStatus = restoreTarget(metadata);
      if (requestedStatus !== restoreStatus) {
        throw statusError(
          "Restore the rejected lead before selecting another stage",
        );
      }
      targetStatus = restoreStatus;
      resolvedAction = "restore";
    } else {
      const currentIndex = LEAD_JOURNEY.indexOf(currentStatus);
      const targetIndex = LEAD_JOURNEY.indexOf(requestedStatus);
      if (targetIndex < 0 || Math.abs(targetIndex - currentIndex) !== 1) {
        throw statusError(
          "Lead status can only move to the next or previous journey stage",
        );
      }
      targetStatus = requestedStatus;
      resolvedAction = targetIndex > currentIndex ? "next" : "previous";
    }
  } else {
    throw statusError("Select next, previous or reject");
  }

  return {
    action: resolvedAction,
    fromStatus: currentStatus,
    toStatus: targetStatus,
    note,
  };
}

module.exports = {
  LEAD_JOURNEY,
  STATUS_ALIASES,
  VALID_STATUS_INPUTS,
  VALID_ACTIONS,
  canonicalLeadStatus,
  resolveLeadStatusTransition,
  PROVIDER_CONTROLLED_STATUS,
};
