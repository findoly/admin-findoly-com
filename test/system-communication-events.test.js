const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SKIP_DB = "true";

const systemEventService = require("../services/communication/system-event-service");

test("provider unlock and feedback events are the only automatic provider email events", function () {
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("provider_lead_unlocked"), true);
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("provider_feedback_updated"), true);
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("lead_created"), false);
  assert.equal(systemEventService.PROVIDER_EMAIL_EVENTS.has("lead_distributed"), false);
});

test("provider event variables use CRM provider identity and lead details", function () {
  const variables = systemEventService.variablesFor({
    eventAt: "2026-07-20T10:00:00.000Z",
    provider: { providerId: "provider-1", name: "Dhiraj", businessName: "Findoly Services", email: "provider@example.com" },
    lead: { enquiryId: "lead-1", requirementTitle: "Paint a front door", category: "Painting" },
    distribution: { leadDistributionId: "distribution-1", city: "Mumbai", state: "Maharashtra", effectiveLeadCostCredits: 12 },
    unlockMethod: "credits",
  });
  assert.equal(variables.provider_name, "Findoly Services");
  assert.equal(variables.lead_id, "lead-1");
  assert.equal(variables.requirement_title, "Paint a front door");
  assert.equal(variables.location, "Mumbai, Maharashtra");
  assert.equal(variables.credits_used, "12");
});

test("internal Slack event summary excludes customer contact fields", function () {
  const context = {
    providerId: "provider-1",
    enquiryId: "lead-1",
    leadDistributionId: "distribution-1",
    eventAt: "2026-07-20T10:00:00.000Z",
    lead: { customerMobile: "9999999999", customerEmail: "customer@example.com" },
  };
  const variables = {
    provider_name: "Findoly Services",
    lead_id: "lead-1",
    lead_distribution_id: "distribution-1",
    requirement_title: "Paint a front door",
    category: "Painting",
    credits_used: "12",
    unlock_method: "credits",
    event_time: context.eventAt,
    outcome: "Not set",
    activity_status: "Not set",
    reason: "Not provided",
    note: "Not provided",
  };
  const message = systemEventService.slackMessage("provider_lead_unlocked", context, variables);
  assert.match(message, /Provider Lead Unlocked/);
  assert.match(message, /lead-1/);
  assert.doesNotMatch(message, /9999999999/);
  assert.doesNotMatch(message, /customer@example\.com/);
});
