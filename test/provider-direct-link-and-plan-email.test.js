"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const directLinkService = require("../services/enquiry/provider-direct-link-service");
const planEmailService = require("../services/communication/provider-plan-email-service");

const SECRET = "test-direct-link-secret-with-more-than-32-characters";

test("employee direct lead link token is provider and enquiry specific", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const token = directLinkService.createToken({
    providerId: "provider-1",
    enquiryId: "lead-1",
    now,
    env: {
      PROVIDER_DIRECT_LEAD_LINK_SECRET: SECRET,
      PROVIDER_DIRECT_LEAD_LINK_EXPIRY_HOURS: "24",
    },
  });
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], directLinkService.TOKEN_PREFIX);
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  assert.equal(payload.p, "provider-1");
  assert.equal(payload.e, "lead-1");
  assert.equal(payload.x - payload.i, 24 * 60 * 60);
  assert.equal(parts[2], directLinkService.signatureFor(parts[1], {
    PROVIDER_DIRECT_LEAD_LINK_SECRET: SECRET,
  }));
});

test("employee direct links are allowed at unlock-limit closure but not deactivation", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  const lead = {
    status: "approved",
    isActive: true,
    marketplacePublishedAt: new Date("2026-09-03T00:00:00.000Z"),
    marketplaceExpiresAt: new Date("2026-09-05T00:00:00.000Z"),
    marketplaceAvailable: false,
    marketplaceStatus: "closed",
    marketplaceClosureReason: "unlock_limit",
    remainingUnlocks: 0,
  };
  assert.equal(directLinkService.leadAllowsDirectLink(lead, now), true);
  assert.equal(directLinkService.leadAllowsDirectLink({ ...lead, marketplaceClosureReason: "deactivated" }, now), false);
  assert.equal(directLinkService.leadAllowsDirectLink({ ...lead, isActive: false }, now), false);
});

test("provider alert URLs use the canonical plural lead route", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/communication/nearby-lead-alert-service.js"), "utf8");
  assert.match(source, /url\.pathname = `\/leads\/\$\{encodeURIComponent/);
  assert.doesNotMatch(source, /url\.pathname = `\/lead\/\$\{encodeURIComponent/);
});

test("nearby provider UI exposes permission-gated copy link action", () => {
  const view = fs.readFileSync(path.join(__dirname, "../views/enquiry/nearby-providers.ejs"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "../routes/enquiry.js"), "utf8");
  assert.match(view, /Copy lead link/);
  assert.match(view, /copyDirectLink\(provider\)/);
  assert.match(route, /direct-link/);
  assert.match(route, /requirePermission\("requirements\.manage"\)/);
});

test("provider plan email is simple, growth-focused and contains no emoji", () => {
  assert.equal(planEmailService.SUBJECT, "Thank you for growing with Findoly");
  assert.match(planEmailService.BODY, /grow with us/i);
  assert.match(planEmailService.BODY, /genuine customer enquiries/i);
  assert.match(planEmailService.BODY, /Team Findoly/);
  assert.doesNotMatch(planEmailService.SUBJECT + planEmailService.BODY, /[\p{Extended_Pictographic}\uFE0F]/u);
});

test("provider plan email uses accurate active and scheduled renewal wording", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  assert.equal(
    planEmailService.planStatusLine({ planStatus: "active", startsAt: now }, "Growth", now),
    "Your Growth plan is now active.",
  );
  const scheduled = planEmailService.planStatusLine(
    { planStatus: "scheduled", startsAt: new Date("2026-09-10T00:00:00.000Z") },
    "Growth",
    now,
  );
  assert.match(scheduled, /^Your Growth plan renewal is confirmed and will start on /);
  assert.match(scheduled, /10 Sept 2026\.$/);
});

test("provider plan email classifies terminal failures for outbox retries", () => {
  for (const status of ["failed", "bounced", "complained", "rejected"]) {
    assert.equal(planEmailService.deliveryFailed({ status }), true);
  }
  for (const status of ["queued", "accepted", "sent", "delivered"]) {
    assert.equal(planEmailService.deliveryFailed({ status }), false);
  }
  const source = fs.readFileSync(path.join(__dirname, "../services/communication/provider-plan-email-service.js"), "utf8");
  assert.match(source, /communicationService\.retry\(/);
  assert.match(source, /deliveryFailed\(communication\)/);
});

test("provider plan event has an exact communication-token route before generic events", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/main.js"), "utf8");
  const exact = routes.indexOf('/communication/events/provider_plan_purchased');
  const generic = routes.indexOf('/communication/events/:event');
  assert.ok(exact >= 0);
  assert.ok(generic > exact);
  assert.match(routes, /communicationEventAccess, providerPlanCommunicationController\.integrationEvent/);
});
