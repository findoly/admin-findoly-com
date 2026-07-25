const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function redesignedSources() {
  return [
    "models/Enquiry.js",
    "models/ProviderLeadUnlock.js",
    "models/PaymentOrder.js",
    "services/enquiry/enquiry-service.js",
    "services/provider-unlock/provider-unlock-service.js",
    "services/provider-unlock/provider-status-service.js",
    "controllers/providerUnlockController.js",
    "routes/provider-unlock.js",
    "views/provider-unlock/index.ejs",
  ].map(source).join("\n");
}

test("provider unlock documents are compact and uniquely identify provider plus lead", () => {
  const model = source("models/ProviderLeadUnlock.js");
  assert.match(model, /providerLeadUnlockId/);
  assert.match(model, /\{ providerId: 1, enquiryId: 1 \}, \{ unique: true \}/);
  assert.match(model, /serviceTypes/);
  assert.doesNotMatch(model, /customerMobile|customerEmail|customerAddress|timeline|History/);
});

test("approved leads own marketplace counters without provider fan-out", () => {
  const enquiry = source("models/Enquiry.js");
  for (const field of ["marketplaceAvailable", "unlockedCount", "reservedUnlockCount", "remainingUnlocks", "maxProviderUnlocks"]) {
    assert.match(enquiry, new RegExp(`${field}:`));
  }
  assert.equal(fs.existsSync(path.join(root, "models/LeadDistribution.js")), false);
  assert.equal(fs.existsSync(path.join(root, "services/distribution/distribution-service.js")), false);
});

test("redesigned workflow avoids aggregation pipelines expression queries and deep skip", () => {
  const text = redesignedSources();
  assert.doesNotMatch(text, /\.aggregate\s*\(|\$expr|\.skip\s*\(/);
  assert.doesNotMatch(text, /leadDistributionId|leaddistributions/);
  assert.match(text, /cursorPaginate/);
  assert.match(text, /module\.exports/);
});

test("high-volume pages use cursor navigation", () => {
  for (const file of [
    "views/enquiry/index.ejs",
    "views/provider/index.ejs",
    "views/provider-unlock/index.ejs",
    "views/communication/logs.ejs",
    "views/invoice/index.ejs",
  ]) {
    const text = source(file);
    assert.match(text, /cursor|Cursor/i, `${file} should expose cursor navigation`);
  }
});

test("production database startup uses bounded pools and disables automatic indexes by default", () => {
  const connection = source("db/connection.js");
  assert.match(connection, /maxPoolSize/);
  assert.match(connection, /minPoolSize/);
  assert.match(connection, /maxIdleTimeMS/);
  assert.match(connection, /autoIndex:\s*process\.env\.MONGO_AUTO_INDEX === "true"/);
  assert.match(source("scripts/ensure-indexes.js"), /ProviderLeadUnlock/);
});

test("provider unlock pages and routes replace the removed distribution area", () => {
  assert.match(source("routes/main.js"), /\/provider-unlocks/);
  assert.match(source("routes/frontend.js"), /\/provider-unlocks/);
  assert.match(source("views/partials/sidebar.ejs"), /Provider unlocks/);
  assert.match(source("routes/enquiry.js"), /\/:enquiryId\/providers\/\:providerLeadUnlockId/);
});


test("marketplace expiry cleanup is bounded indexed and CommonJS", () => {
  const cleanup = source("scripts/expire-marketplace-leads.js");
  const packageJson = JSON.parse(source("package.json"));
  assert.match(cleanup, /marketplaceExpiresAt: \{ \$lte: now \}/);
  assert.match(cleanup, /\.limit\(BATCH_SIZE\)/);
  assert.match(cleanup, /marketplaceStatus: "expired"/);
  assert.match(cleanup, /module\.exports/);
  assert.doesNotMatch(cleanup, /\.aggregate\s*\(|\$expr|\.skip\s*\(/);
  assert.equal(packageJson.scripts["cleanup:marketplace-leads"], "node scripts/expire-marketplace-leads.js");
});

test("CRM dashboard caps filtered counts instead of exact collection-wide counts", () => {
  const dashboard = source("services/dashboard/dashboard-service.js");
  const view = source("views/dashboard/index.ejs");
  assert.match(dashboard, /COUNT_CAP/);
  assert.match(dashboard, /async function boundedCount/);
  assert.match(dashboard, /\.limit\(cap \+ 1\)/);
  assert.doesNotMatch(dashboard, /countDocuments\s*\(/);
  assert.match(view, /metric\(data\.offered, data\.caps\?\.offered\)/);
});
