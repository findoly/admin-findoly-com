"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const sharedFilterViews = [
  "views/agent/index.ejs",
  "views/billing/provider-subscriptions.ejs",
  "views/category/index.ejs",
  "views/category/service-types.ejs",
  "views/communication/logs.ejs",
  "views/communication/templates.ejs",
  "views/provider-unlock/index.ejs",
  "views/provider-request/index.ejs",
  "views/employee/index.ejs",
  "views/enquiry/index.ejs",
  "views/enquiry/provider-statuses.ejs",
  "views/follow-up/index.ejs",
  "views/invoice/index.ejs",
  "views/partner-payout/index.ejs",
  "views/provider/index.ejs",
];

test("CRM loads shared mobile filter assets before the Alpine runtime", () => {
  const head = read("views/partials/head.ejs");
  assert.match(head, /\/css\/mobile-filters\.css\?v=/);
  assert.match(head, /\/js\/mobile-filters\.js\?v=/);
  assert.match(head, /\/js\/crm-ui-runtime\.js\?v=/);
  assert.doesNotMatch(head, /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs@3\.x\.x/);
  assert.ok(head.indexOf("/js/mobile-filters.js") < head.indexOf("/js/crm-ui-runtime.js"));
});

test("mobile filters collapse secondary controls and remain touch friendly", () => {
  const css = read("public/css/mobile-filters.css");
  assert.match(css, /@media \(max-width: 991\.98px\)/);
  assert.match(css, /@media \(max-width: 575\.98px\)/);
  assert.match(css, /data-crm-mobile-filter-bar/);
  assert.match(css, /crm-mobile-filter-panel/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /min-height:\s*42px/);
});

test("shared filter lifecycle preserves URL state and recovers BFCache pages", () => {
  const source = read("public/js/mobile-filters.js");
  assert.match(source, /FILTER_FORM_SELECTOR/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /restoreFormsFromUrl/);
  assert.match(source, /mergePageFiltersIntoApiUrl/);
  assert.match(source, /window\.addEventListener\('pageshow'/);
  assert.match(source, /event\.persisted/);
  assert.match(source, /crm:page-restored/);
  assert.match(source, /form\.requestSubmit\(\)/);
  assert.match(source, /crm-mobile-filters-open/);
});

test("Alpine runtime is pinned and has a secondary network source plus visible failure state", () => {
  const source = read("public/js/crm-ui-runtime.js");
  assert.match(source, /alpinejs@3\.16\.2\/dist\/cdn\.min\.js/);
  assert.match(source, /cdn\.jsdelivr\.net/);
  assert.match(source, /unpkg\.com/);
  assert.match(source, /crm-runtime-error/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test("core CRM list screens remain on the shared filter system", () => {
  for (const view of sharedFilterViews) {
    const source = read(view);
    assert.match(source, /crm-filter-(?:card|shell)/, `${view} must keep the shared filter container`);
    assert.match(source, /crm-filter-(?:bar|toolbar)|crm-filter-drawer/, `${view} must keep a shared filter layout`);
  }
});
