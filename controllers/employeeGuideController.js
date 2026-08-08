"use strict";

const path = require("path");

const GUIDE_ROOT = path.join(__dirname, "..", "resources", "employee-guide");
const GUIDE_HTML = path.join(GUIDE_ROOT, "findoly-crm-employee-guide.html");
const GUIDE_PDF = path.join(GUIDE_ROOT, "findoly-crm-employee-guide.pdf");

function page(req, res) {
  res.render("help/employee-guide", { title: "Employee Guide" });
}

function content(req, res, next) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Content-Security-Policy", "frame-ancestors 'self'");
  res.sendFile(GUIDE_HTML, (error) => { if (error) next(error); });
}

function pdf(req, res, next) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.download(GUIDE_PDF, "findoly-crm-employee-guide.pdf", (error) => { if (error && !res.headersSent) next(error); });
}

module.exports = { page, content, pdf };
