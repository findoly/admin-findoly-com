"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const responsiveFilterViews = [
  "views/agent/index.ejs",
  "views/billing/provider-subscriptions.ejs",
  "views/communication/logs.ejs",
  "views/communication/templates.ejs",
  "views/distribution/index.ejs",
  "views/employee/index.ejs",
  "views/enquiry/index.ejs",
  "views/enquiry/provider-statuses.ejs",
  "views/follow-up/index.ejs",
  "views/invoice/index.ejs",
  "views/partner-payout/index.ejs",
  "views/provider/index.ejs",
];

test("employee profile dropdown is viewport-safe and statically anchored", () => {
  const navbar = read("views/partials/navbar.ejs");
  const css = read("public/css/app.css");

  assert.match(navbar, /crm-admin-dropdown-wrap/);
  assert.match(navbar, /data-bs-display="static"/);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*max-width:\s*calc\(100vw - 1rem\)/s);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*right:\s*0\s*!important/s);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*transform:\s*none\s*!important/s);
});

test("shared filter bars are responsive on phone, tablet and laptop", () => {
  const css = read("public/css/app.css");

  assert.match(css, /CRM responsive consistency repair/);
  assert.match(css, /@media \(max-width: 1199\.98px\)/);
  assert.match(css, /@media \(max-width: 991\.98px\)/);
  assert.match(css, /@media \(max-width: 767\.98px\)/);
  assert.match(css, /@media \(max-width: 479\.98px\)/);
  assert.match(css, /\.crm-filter-bar > \.form-control,[\s\S]*max-width:\s*none\s*!important/);
  assert.match(css, /\.crm-filter-bar > \.btn,[\s\S]*flex:\s*1 1 calc\(50% - \.25rem\)/);

  for (const view of responsiveFilterViews) {
    assert.match(read(view), /crm-filter-(?:bar|toolbar)/, `${view} must use the shared filter layout`);
  }
});

test("tables and page shell contain horizontal overflow", () => {
  const css = read("public/css/app.css");
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.table-responsive\s*\{[^}]*overflow-x:\s*auto/s);

  for (const file of fs.readdirSync(path.join(root, "views"), { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".ejs")) continue;
    const source = read(path.join("views", file));
    let cursor = 0;
    while ((cursor = source.indexOf("<table", cursor)) !== -1) {
      const nearby = source.slice(Math.max(0, cursor - 700), cursor);
      assert.match(nearby, /table-responsive/, `${file} has a table outside a responsive container`);
      cursor += 6;
    }
  }
});

test("mobile header and storage controls have dedicated responsive rules", () => {
  const css = read("public/css/app.css");
  const storage = read("views/storage/index.ejs");

  assert.match(css, /\.crm-brand-copy,\s*\.crm-admin-copy\s*\{\s*display:\s*none\s*!important/s);
  assert.match(css, /\.crm-primary-action\s*\{[^}]*font-size:\s*\.78rem/s);
  assert.match(css, /\.crm-storage-toolbar-actions\s*\{/);
  assert.match(storage, /crm-storage-toolbar/);
  assert.match(storage, /crm-storage-toolbar-actions/);
  assert.doesNotMatch(storage, /style="min-width:220px"/);
});
