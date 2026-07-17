const PROVIDER_LEAD_STATUSES = Object.freeze([
  "contacted",
  "valid",
  "follow_up",
  "on_hold",
  "rejected",
  "invalid",
  "not_interested",
  "other",
]);

const PROVIDER_SALE_OUTCOMES = Object.freeze([
  "confirmed",
  "not_confirmed",
]);

const PROVIDER_EVENT_STATUS = Object.freeze({
  provider_contacted: "contacted",
  provider_valid: "valid",
  provider_follow_up: "follow_up",
  provider_on_hold: "on_hold",
  provider_rejected: "rejected",
  provider_invalid: "invalid",
  provider_not_interested: "not_interested",
  provider_other: "other",
});

const PROVIDER_EVENT_OUTCOME = Object.freeze({
  provider_confirmed: "confirmed",
  provider_not_confirmed: "not_confirmed",
});

const GENERIC_PROVIDER_STATUS_EVENTS = Object.freeze([
  "provider_status",
  "provider_status_updated",
  "provider-status",
  "provider-status-updated",
]);

const GENERIC_PROVIDER_FEEDBACK_EVENTS = Object.freeze([
  "provider_feedback_updated",
  "provider-feedback-updated",
  "provider_outcome_updated",
  "provider-outcome-updated",
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function providerStatusFromEvent(eventName, fallback = "") {
  const event = normalize(eventName);
  const requested = normalize(fallback);
  if (PROVIDER_EVENT_STATUS[event]) return PROVIDER_EVENT_STATUS[event];
  if (
    GENERIC_PROVIDER_STATUS_EVENTS.includes(event) &&
    PROVIDER_LEAD_STATUSES.includes(requested)
  ) {
    return requested;
  }
  return "";
}

function providerOutcomeFromEvent(eventName, fallback = "") {
  const event = normalize(eventName);
  const requested = normalize(fallback);
  if (PROVIDER_EVENT_OUTCOME[event]) return PROVIDER_EVENT_OUTCOME[event];
  if (
    GENERIC_PROVIDER_FEEDBACK_EVENTS.includes(event) &&
    PROVIDER_SALE_OUTCOMES.includes(requested)
  ) {
    return requested;
  }
  return "";
}

module.exports = {
  PROVIDER_LEAD_STATUSES,
  PROVIDER_SALE_OUTCOMES,
  PROVIDER_EVENT_STATUS,
  PROVIDER_EVENT_OUTCOME,
  GENERIC_PROVIDER_STATUS_EVENTS,
  GENERIC_PROVIDER_FEEDBACK_EVENTS,
  providerStatusFromEvent,
  providerOutcomeFromEvent,
};
