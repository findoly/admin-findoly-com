const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isMarketplaceVisible,
  isMarketplaceWithinAge,
  marketplaceVisibleAt,
  stageForDistance,
} = require("../utils/marketplace-radius");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("CRM marketplace radius stages match the provider portal", () => {
  assert.equal(stageForDistance(20).delayMinutes, 0);
  assert.equal(stageForDistance(20.1).delayMinutes, 10);
  assert.equal(stageForDistance(50).delayMinutes, 10);
  assert.equal(stageForDistance(50.1).delayMinutes, 30);
  assert.equal(stageForDistance(100).delayMinutes, 30);
  assert.equal(stageForDistance(100.1).delayMinutes, 60);
  assert.equal(stageForDistance(null), null);

  const publishedAt = new Date("2026-07-18T10:00:00.000Z");
  assert.equal(marketplaceVisibleAt(publishedAt, 20).toISOString(), "2026-07-18T10:00:00.000Z");
  assert.equal(marketplaceVisibleAt(publishedAt, 50).toISOString(), "2026-07-18T10:10:00.000Z");
  assert.equal(marketplaceVisibleAt(publishedAt, 100).toISOString(), "2026-07-18T10:30:00.000Z");
  assert.equal(marketplaceVisibleAt(publishedAt, 101).toISOString(), "2026-07-18T11:00:00.000Z");
  assert.equal(marketplaceVisibleAt(publishedAt, null).toISOString(), "2026-07-18T11:00:00.000Z");
  assert.equal(isMarketplaceVisible({ marketplacePublishedAt: publishedAt, providerDistanceKm: null }, new Date("2026-07-18T11:00:00.000Z")), true);
});

test("marketplace availability is limited to six months", () => {
  const now = new Date("2026-07-18T10:00:00.000Z");
  assert.equal(isMarketplaceWithinAge(new Date("2026-01-18T10:00:00.000Z"), now), true);
  assert.equal(isMarketplaceWithinAge(new Date("2026-01-17T23:59:59.000Z"), now), false);
});

test("CRM publishes once and controls the provider unlock limit", () => {
  const service = source("services/enquiry/enquiry-service.js");
  const form = source("views/enquiry/form.ejs");
  const show = source("views/enquiry/show.ejs");

  assert.match(service, /Provider-specific rows are no longer required for marketplace visibility/);
  assert.match(service, /marketplacePublishedAt/);
  assert.match(service, /maxProviderUnlocks/);
  assert.doesNotMatch(service, /Provider\.find\(/);
  assert.match(form, /Maximum provider unlocks/);
  assert.match(form, /maxProviderUnlocks:\s*5/);
  assert.match(show, /of.*unlocked/);
});
