const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("categories store and validate a provider unlock default", () => {
  const model = source("models/Category.js");
  const service = source("services/catalog/catalog-service.js");
  const view = source("views/category/index.ejs");

  assert.match(model, /defaultProviderUnlocks:\s*\{[^}]*default:\s*3[^}]*min:\s*1[^}]*max:\s*1000/);
  assert.match(service, /DEFAULT_PROVIDER_UNLOCKS\s*=\s*3/);
  assert.match(service, /label:\s*"Default provider unlocks"/);
  assert.match(service, /defaultProviderUnlocks:\s*data\.defaultProviderUnlocks/);
  assert.match(view, /Default provider unlocks/);
  assert.match(view, /form\.defaultProviderUnlocks/);
});

test("category provider unlock lookup uses a five-minute in-memory cache", () => {
  const service = source("services/catalog/catalog-service.js");

  assert.match(service, /CATEGORY_PROVIDER_UNLOCK_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(service, /categoryProviderUnlockCache\s*=\s*new Map\(\)/);
  assert.match(service, /cached\s*&&\s*cached\.expiresAt\s*>\s*Date\.now\(\)/);
  assert.match(service, /select\(\{\s*defaultProviderUnlocks:\s*1\s*\}\)/);
  assert.match(service, /cacheCategoryProviderUnlocks\(presented\.slug, presented\.defaultProviderUnlocks\)/);
  assert.match(service, /cacheCategoryProviderUnlocks\(updated\.slug, updated\.defaultProviderUnlocks\)/);
});

test("new leads resolve the category default while existing leads keep their saved limit", () => {
  const service = source("services/enquiry/enquiry-service.js");
  const form = source("views/enquiry/form.ejs");
  const model = source("models/Enquiry.js");

  assert.match(service, /await catalogService\.getCategoryDefaultProviderUnlocks\(categorySlug\)/);
  assert.match(service, /currentMaxProviderUnlocks[\s\S]*maxProviderUnlockFallback/);
  assert.match(service, /fallback:\s*maxProviderUnlockFallback/);
  assert.match(form, /category\?\.defaultProviderUnlocks\s*\|\|\s*3/);
  assert.match(model, /remainingUnlocks:\s*\{[^}]*default:\s*3/);
  assert.match(model, /maxProviderUnlocks:\s*\{[^}]*default:\s*3/);
});
