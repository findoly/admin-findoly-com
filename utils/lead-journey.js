const LEAD_JOURNEY = Object.freeze([
  "new",
  "verification",
  "approved",
  "distributed",
]);

const STATUS_ALIASES = Object.freeze({
  verification_pending: "verification",
  verified: "verification",
  in_progress: "distributed",
  completed: "distributed",
  closed: "distributed",
});

function canonicalLeadStatus(value) {
  const status = String(value || "new").trim().toLowerCase();
  if (status === "rejected") return "rejected";
  if (LEAD_JOURNEY.includes(status)) return status;
  return STATUS_ALIASES[status] || "new";
}

function statusError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function resolveLeadStatusTransition(currentValue, input = {}, metadata = {}) {
  const currentStatus = canonicalLeadStatus(currentValue);
  const action = String(input.action || "").trim().toLowerCase();
  const requestedStatus = input.status
    ? canonicalLeadStatus(input.status)
    : "";
  const note = String(input.note || input.reason || "").trim();

  let targetStatus = currentStatus;
  let resolvedAction = action;

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
    targetStatus = canonicalLeadStatus(metadata.rejectedFromStatus || "new");
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
      targetStatus = canonicalLeadStatus(metadata.rejectedFromStatus || "new");
      resolvedAction = "restore";
    } else {
      const index = LEAD_JOURNEY.indexOf(currentStatus);
      if (index <= 0) throw statusError("Lead is already at the first journey stage");
      targetStatus = LEAD_JOURNEY[index - 1];
    }
  } else if (requestedStatus) {
    if (currentStatus === "rejected") {
      const restoreStatus = canonicalLeadStatus(metadata.rejectedFromStatus || "new");
      if (requestedStatus !== restoreStatus) {
        throw statusError("Restore the rejected lead before selecting another stage");
      }
      targetStatus = restoreStatus;
      resolvedAction = "restore";
    } else {
      const currentIndex = LEAD_JOURNEY.indexOf(currentStatus);
      const targetIndex = LEAD_JOURNEY.indexOf(requestedStatus);
      if (targetIndex < 0 || Math.abs(targetIndex - currentIndex) !== 1) {
        throw statusError("Lead status can only move to the next or previous journey stage");
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
  canonicalLeadStatus,
  resolveLeadStatusTransition,
};
