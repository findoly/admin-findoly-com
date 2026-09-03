"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("provider health route remains read-only and permission protected", () => {
  const route = read("routes/provider-health.js");
  const controller = read("controllers/providerHealthController.js");
  assert.match(
    route,
    /router\.get\("\/", requirePermission\("providers\.view"\), controller\.list\)/,
  );
  assert.doesNotMatch(route, /router\.(?:post|put|patch|delete)/);
  assert.match(controller, /service\.list\(req\.query\)/);
});

test("provider health page exposes the three approved operational views", () => {
  const view = read("views/provider/health.ejs");
  assert.match(view, /Provider health/);
  assert.match(view, /Low credits/);
  assert.match(view, /Frequent unlockers/);
  assert.match(view, /Idle providers/);
  assert.match(view, /\/api\/providers\/health/);
  assert.match(view, /\/providers\/.*row\.providerId/);
  assert.match(view, /Never unlocked/);
  assert.match(view, /No unlock in 30 days/);
  assert.doesNotMatch(view, /provider-subscriptions/);
});

test("provider health is wired under Provider without changing subscription history", () => {
  const main = read("routes/main.js");
  const frontend = read("routes/frontend.js");
  const pages = read("controllers/frontendController.js");
  const sidebar = read("views/partials/sidebar.ejs");
  const providers = read("views/provider/index.ejs");

  assert.match(main, /router\.use\("\/providers\/health", require\("\.\/provider-health"\)\)/);
  assert.match(frontend, /router\.get\("\/providers\/health"[\s\S]*page\.providerHealth/);
  assert.match(pages, /providerHealth:\s*render\("provider\/health", "Provider health"\)/);
  assert.match(sidebar, /href="\/providers\/health"[\s\S]*Provider health/);
  assert.match(providers, /href="\/providers\/health"[\s\S]*Provider health/);
  assert.doesNotMatch(read("views/billing/provider-subscriptions.ejs"), /Provider health/);
});

test("provider health keeps legacy provider IDs compatible", () => {
  const service = read("services/provider/provider-health-service.js");
  assert.match(service, /\$eq: \["\$id", "\$\$providerId"\]/);
  assert.match(service, /\$ifNull: \["\$providerId", "\$id"\]/);
});
