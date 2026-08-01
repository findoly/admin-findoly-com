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
  "views/category/index.ejs",
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

test("employee profile dropdown is viewport-safe and statically anchored", () => {
  const navbar = read("views/partials/navbar.ejs");
  const css = read("public/css/app.css");

  assert.match(navbar, /crm-admin-dropdown-wrap/);
  assert.match(navbar, /data-bs-display="static"/);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*max-width:\s*calc\(100vw - 1rem\)/s);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*right:\s*0\s*!important/s);
  assert.match(css, /\.crm-admin-dropdown\s*\{[^}]*transform:\s*none\s*!important/s);
});



test("real shell keeps a single-row header and a full-viewport mobile drawer", () => {
  const head = read("views/partials/head.ejs");
  const navbar = read("views/partials/navbar.ejs");
  const sidebar = read("views/partials/sidebar.ejs");
  const css = read("public/css/app.css");

  assert.match(head, /app\.css\?v=20260801-provider-requests-1/);
  assert.match(navbar, /crm-brand-copy d-none d-xl-flex/);
  assert.match(navbar, /crm-global-search d-none d-xl-flex/);
  assert.match(navbar, /crm-admin-copy d-none d-xl-flex/);
  assert.match(navbar, /aria-controls="crmPrimaryNavigation"/);
  assert.match(sidebar, /id="crmPrimaryNavigation"/);
  assert.match(sidebar, /crm-mobile-drawer-open/);
  assert.match(sidebar, /@keydown\.escape\.window="sidebarOpen=false"/);

  assert.match(css, /CRM real-shell responsive repair/);
  assert.match(css, /\.crm-topbar,\s*\.crm-topbar \.container-fluid\s*\{[^}]*height:\s*64px[^}]*max-height:\s*64px/s);
  assert.match(css, /\.crm-topbar \.container-fluid\s*\{[^}]*flex-wrap:\s*nowrap\s*!important/s);
  assert.match(css, /\.crm-sidebar\s*\{[^}]*inset:\s*0 auto 0 0\s*!important[^}]*height:\s*100dvh/s);
  assert.match(css, /\.crm-sidebar-overlay\s*\{[^}]*inset:\s*0\s*!important[^}]*z-index:\s*1055/s);
  assert.match(css, /\.crm-sidebar-mobile-head\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
  assert.doesNotMatch(css, /\.crm-sidebar\s*\{[^}]*top:\s*64px/s);
  assert.doesNotMatch(css, /\.crm-sidebar-overlay\s*\{[^}]*inset:\s*64px/s);
});

test("shared filter bars are responsive and consistent on phone, tablet and laptop", () => {
  const css = read("public/css/app.css");

  assert.match(css, /CRM unified filter system — authoritative layout/);
  assert.match(css, /@media \(max-width: 1199\.98px\)/);
  assert.match(css, /@media \(max-width: 991\.98px\)/);
  assert.match(css, /@media \(max-width: 767\.98px\)/);
  assert.match(css, /@media \(max-width: 479\.98px\)/);
  assert.match(css, /\.crm-filter-field\s*\{[\s\S]*flex-direction:\s*column/s);
  assert.match(css, /\.crm-filter-actions\s*\{[\s\S]*display:\s*flex/s);
  assert.match(css, /\.crm-filter-actions \.btn\s*\{[\s\S]*white-space:\s*nowrap/s);

  for (const view of responsiveFilterViews) {
    const source = read(view);
    assert.match(source, /crm-filter-(?:bar|toolbar)/, `${view} must use the shared filter layout`);
    assert.doesNotMatch(source, /style="max-width:[^"]+"/, `${view} must not use inline filter widths`);
  }
});

test("filter date controls have visible labels and actions stay grouped", () => {
  const dateViews = [
    "views/agent/index.ejs",
    "views/billing/provider-subscriptions.ejs",
    "views/category/index.ejs",
    "views/communication/logs.ejs",
    "views/employee/index.ejs",
    "views/follow-up/index.ejs",
    "views/invoice/index.ejs",
    "views/partner-payout/index.ejs",
    "views/provider-unlock/index.ejs",
    "views/provider-request/index.ejs",
    "views/provider/index.ejs",
  ];
  for (const view of dateViews) {
    const source = read(view);
    assert.match(source, /crm-filter-date/, `${view} must use labelled date controls`);
    assert.match(source, /<span>From<\/span>/, `${view} must label the from date`);
    assert.match(source, /<span>To<\/span>/, `${view} must label the to date`);
    assert.match(source, /crm-filter-actions/, `${view} must keep Apply and Clear together`);
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
