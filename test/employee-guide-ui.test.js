"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("employee guide routes are authenticated and resources stay outside public", () => {
  const routes = read("routes/frontend.js");
  assert.match(routes, /router\.get\("\/employee-guide", pageAuth, employeeGuide\.page\)/);
  assert.match(routes, /router\.get\("\/employee-guide\/content", pageAuth, employeeGuide\.content\)/);
  assert.match(routes, /router\.get\("\/employee-guide\/pdf", pageAuth, employeeGuide\.pdf\)/);
  assert.equal(fs.existsSync(path.join(root, "public", "findoly-crm-employee-guide.html")), false);
  assert.equal(fs.existsSync(path.join(root, "resources", "employee-guide", "findoly-crm-employee-guide.html")), true);
  assert.equal(fs.existsSync(path.join(root, "resources", "employee-guide", "findoly-crm-employee-guide.pdf")), true);
});

test("employee guide page and sidebar expose protected training controls", () => {
  const page = read("views/help/employee-guide.ejs");
  const sidebar = read("views/partials/sidebar.ejs");
  assert.match(page, /\/employee-guide\/content/);
  assert.match(page, /Download PDF/);
  assert.match(sidebar, /Help &amp; Training/);
  assert.match(sidebar, /href="\/employee-guide"/);
});
