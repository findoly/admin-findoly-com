const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { normalizeMobile, validateMobile } = require("../utils/mobile");
const {
  LEAD_JOURNEY,
  canonicalLeadStatus,
  resolveLeadStatusTransition,
} = require("../utils/lead-journey");
const { providerJourney } = require("../services/enquiry/enquiry-service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Indian mobile numbers are normalized and restricted to ten digits", () => {
  assert.equal(normalizeMobile("+91 86930 97982"), "8693097982");
  assert.equal(normalizeMobile("08693097982"), "8693097982");
  assert.equal(validateMobile("8693097982"), "8693097982");
  assert.throws(
    () => validateMobile("869309798"),
    /exactly 10 digits/,
  );
});

test("lead journey only allows next, previous and rejection transitions", () => {
  assert.deepEqual(LEAD_JOURNEY, [
    "new",
    "verification",
    "approved",
    "distributed",
  ]);
  assert.equal(canonicalLeadStatus("verification_pending"), "verification");
  assert.equal(canonicalLeadStatus("sale_converted"), "sale_converted");
  assert.equal(
    resolveLeadStatusTransition("new", { action: "next" }).toStatus,
    "verification",
  );
  assert.equal(
    resolveLeadStatusTransition("approved", { action: "previous" }).toStatus,
    "verification",
  );
  assert.equal(
    resolveLeadStatusTransition("approved", {
      action: "reject",
      note: "Customer requirement is invalid",
    }).toStatus,
    "rejected",
  );
  assert.equal(
    resolveLeadStatusTransition(
      "rejected",
      { action: "previous" },
      { rejectedFromStatus: "approved" },
    ).toStatus,
    "approved",
  );
  assert.throws(
    () => resolveLeadStatusTransition("new", { status: "approved" }),
    /next or previous/,
  );
});

test("provider journey combines offered, unlocked and provider status events", () => {
  const events = providerJourney({
    providerId: "provider-1",
    distributedBy: "admin@example.com",
    distributedAt: new Date("2026-07-12T05:00:00.000Z"),
    contactUnlocked: true,
    unlockedAt: new Date("2026-07-12T05:10:00.000Z"),
    providerLeadStatus: "confirmed",
    providerLeadReason: "service_booked",
    providerLeadNote: "Booked for Monday",
    providerLeadStatusUpdatedAt: new Date("2026-07-12T05:20:00.000Z"),
    providerLeadStatusUpdatedBy: "provider-1",
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["distributed", "unlocked", "provider_status"],
  );
  assert.equal(events[2].status, "confirmed");
  assert.equal(events[2].note, "Booked for Monday");
});

test("CRM views expose managed categories, multi-select categories and journey controls", () => {
  assert.match(source("views/category/index.ejs"), /Create category/);
  assert.match(source("views/provider/form.ejs"), /multiple/);
  assert.match(source("views/provider/form.ejs"), /\/api\/catalog\/categories/);
  assert.match(source("views/enquiry/form.ejs"), /crm-mobile-prefix/);
  assert.match(source("views/enquiry/show.ejs"), /changeStatus\('next'\)/);
  assert.match(source("views/enquiry/show.ejs"), /providerJourney/);
  assert.match(source("routes/catalog.js"), /router\.post\("\/categories"/);
  assert.match(source("routes/enquiry.js"), /\/:enquiryId\/status/);
});
