const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { adminCookie } = require("./helpers/auth");
const mongoose = require("mongoose");

process.env.SKIP_DB = "true";
process.env.AUTH_COOKIE_NAME = "service_crm_admin";
process.env.NODE_ENV = "test";

const app = require("../app");
const Enquiry = require("../models/Enquiry");
const Provider = require("../models/Provider");
const Category = require("../models/Category");
const FollowUp = require("../models/FollowUp");
const Communication = require("../models/Communication");
const Invoice = require("../models/Invoice");
const LeadDistribution = require("../models/LeadDistribution");
const WalletTransaction = require("../models/WalletTransaction");

test("health endpoint is public and reports CRM service", async () => {
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.service, "crm");
});

test("login page renders without authentication", async () => {
  const response = await request(app).get("/login");
  assert.equal(response.status, 200);
  assert.match(response.text, /Sign in|Login/i);
});

test("root redirects unauthenticated users to login", async () => {
  const response = await request(app).get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/login");
});

test("root redirects authenticated users to dashboard", async () => {
  const response = await request(app).get("/").set("Cookie", [adminCookie()]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/dashboard");
});

test("password login endpoint is removed", async () => {
  const response = await request(app).post("/api/auth/login").send({ email: "admin@example.com", password: "old-password" });
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal((response.headers["set-cookie"] || []).length, 0);
});

test("OTP send rejects a missing mobile number", async () => {
  const response = await request(app).post("/api/auth/send-otp").send({});
  assert.equal(response.status, 400);
  assert.match(response.body.message, /Mobile number is required/);
});

test("OTP verification uses mobile and OTP only", async () => {
  const response = await request(app).post("/api/auth/verify-otp").send({ mobile: "9819595467" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /OTP is required/);
});

test("auth me rejects missing cookie", async () => {
  const response = await request(app).get("/api/auth/me");
  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Authentication required");
});

test("auth me rejects expired cookie", async () => {
  const response = await request(app).get("/api/auth/me").set("Cookie", [adminCookie(Date.now() - 1000)]);
  assert.equal(response.status, 401);
  assert.ok((response.headers["set-cookie"] || []).some((cookie) => /service_crm_admin=;/i.test(cookie)));
});

test("auth me rejects malformed cookie", async () => {
  const response = await request(app).get("/api/auth/me").set("Cookie", ["service_crm_admin=not-json"]);
  assert.equal(response.status, 401);
});

test("auth me returns current admin for valid session", async () => {
  const response = await request(app).get("/api/auth/me").set("Cookie", [adminCookie()]);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.mobile, "9819595467");
});

test("logout rejects unauthenticated request", async () => {
  const response = await request(app).post("/api/auth/logout");
  assert.equal(response.status, 401);
});

test("logout clears authenticated session", async () => {
  const response = await request(app).post("/api/auth/logout").set("Cookie", [adminCookie()]);
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok((response.headers["set-cookie"] || []).some((cookie) => /service_crm_admin=;/i.test(cookie)));
});

test("malformed JSON returns a safe 400 response", async () => {
  const response = await request(app)
    .post("/api/leads")
    .set("Content-Type", "application/json")
    .send('{"name":');
  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid JSON request body");
});

test("oversized JSON returns 413 before business logic", async () => {
  const response = await request(app)
    .post("/api/leads")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ notes: "x".repeat(2 * 1024 * 1024 + 100) }));
  assert.equal(response.status, 413);
  assert.equal(response.body.message, "Request body is too large");
});

for (const alias of ["/api/leads", "/api/enquiries", "/api/requirements"]) {
  test(`public intake alias ${alias} validates required lead fields`, async () => {
    const response = await request(app).post(alias).send({});
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /Category is required/);
  });
}

test("public intake rejects non-new initial status", async () => {
  const response = await request(app).post("/api/leads").send({ status: "approved" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /must start at the New/);
});

test("public intake rejects invalid initial status", async () => {
  const response = await request(app).post("/api/leads").send({ status: "deleted" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /must start at the New/);
});

test("public intake rejects invalid category before database access", async () => {
  const response = await request(app).post("/api/leads").send({ status: "new", categorySlug: "bad category" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /letters, numbers/);
});

test("public intake rejects invalid mobile before database access", async () => {
  const response = await request(app).post("/api/leads").send({ status: "new", categorySlug: "painting", mobile: "123" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /exactly 10 digits/);
});

const protectedApiRoutes = [
  "/api/dashboard",
  "/api/enquiry",
  "/api/enquiries",
  "/api/requirements",
  "/api/provider",
  "/api/providers",
  "/api/catalog/categories",
  "/api/follow-up",
  "/api/follow-ups",
  "/api/communication",
  "/api/communications",
  "/api/invoice",
  "/api/invoices",
  "/api/distribution",
  "/api/distributions",
  "/api/employees",
  "/api/roles",
];
for (const route of protectedApiRoutes) {
  test(`protected API route ${route} returns JSON 401 without a session`, async () => {
    const response = await request(app).get(route);
    assert.equal(response.status, 401);
    assert.equal(response.type, "application/json");
    assert.equal(response.body.message, "Authentication required");
  });
}

const protectedPages = [
  "/dashboard",
  "/enquiries",
  "/requirements",
  "/enquiries/new",
  "/requirements/new",
  "/providers",
  "/providers/new",
  "/categories",
  "/follow-ups",
  "/follow-ups/new",
  "/communications",
  "/communications/new",
  "/billing",
  "/billing/new",
  "/distributions",
  "/reports",
  "/employees",
  "/roles",
];
for (const route of protectedPages) {
  test(`protected page ${route} redirects unauthenticated users`, async () => {
    const response = await request(app).get(route);
    assert.equal(response.status, 302);
    assert.match(response.headers.location, /^\/login\?returnTo=/);
  });
}

const renderPages = [
  "/dashboard",
  "/enquiries",
  "/enquiries/new",
  "/enquiries/REQ-1",
  "/enquiries/REQ-1/edit",
  "/enquiries/REQ-1/providers",
  "/enquiries/REQ-1/providers/DIST-1",
  "/providers",
  "/providers/new",
  "/providers/PROVIDER-1",
  "/providers/PROVIDER-1/edit",
  "/categories",
  "/follow-ups",
  "/follow-ups/new",
  "/follow-ups/F1/edit",
  "/communications",
  "/communications/new",
  "/communications/C1/edit",
  "/billing",
  "/billing/new",
  "/billing/I1/edit",
  "/distributions",
  "/reports",
  "/employees",
  "/employees/new",
  "/roles",
  "/roles/new",
];
for (const route of renderPages) {
  test(`authenticated frontend page ${route} renders without database reads`, async () => {
    const response = await request(app).get(route).set("Cookie", [adminCookie()]);
    assert.equal(response.status, 200);
    assert.match(response.type, /html/);
  });
}

test("unknown API route returns JSON 404", async () => {
  const response = await request(app).get("/api/no-such-route").set("Cookie", [adminCookie()]);
  assert.equal(response.status, 404);
  assert.equal(response.body.message, "API route not found");
});

test("unknown frontend route renders HTML 404", async () => {
  const response = await request(app).get("/no-such-page");
  assert.equal(response.status, 404);
  assert.match(response.type, /html/);
});

const modelCases = [
  ["Enquiry keeps the shared enquiries collection", () => assert.equal(Enquiry.collection.collectionName, "enquiries")],
  ["Provider keeps the shared providers collection", () => assert.equal(Provider.collection.collectionName, "providers")],
  ["LeadDistribution keeps the shared leaddistributions collection", () => assert.equal(LeadDistribution.collection.collectionName, "leaddistributions")],
  ["WalletTransaction keeps the shared wallettransactions collection", () => assert.equal(WalletTransaction.collection.collectionName, "wallettransactions")],
  ["lead reference ID is immutable and unique", () => {
    assert.equal(Enquiry.schema.path("enquiryId").options.immutable, true);
    assert.equal(Enquiry.schema.path("enquiryId").options.unique, true);
  }],
  ["provider ID is immutable", () => assert.equal(Provider.schema.path("providerId").options.immutable, true)],
  ["category ID is immutable", () => assert.equal(Category.schema.path("categoryId").options.immutable, true)],
  ["follow-up ID is immutable", () => assert.equal(FollowUp.schema.path("followUpId").options.immutable, true)],
  ["communication ID is immutable", () => assert.equal(Communication.schema.path("communicationId").options.immutable, true)],
  ["invoice ID is immutable", () => assert.equal(Invoice.schema.path("invoiceId").options.immutable, true)],
  ["distribution relationship identifiers are immutable", () => {
    assert.equal(LeadDistribution.schema.path("leadDistributionId").options.immutable, true);
    assert.equal(LeadDistribution.schema.path("enquiryId").options.immutable, true);
    assert.equal(LeadDistribution.schema.path("providerId").options.immutable, true);
  }],
  ["lead active-state fields are additive", () => {
    for (const field of ["isActive", "deactivatedAt", "deactivatedBy", "deactivationReason"]) assert.ok(Enquiry.schema.path(field));
  }],
  ["lead model allows provider-compatible extra legacy fields", () => assert.equal(Enquiry.schema.options.strict, false)],
  ["distribution model allows provider-compatible extra status history fields", () => assert.equal(LeadDistribution.schema.options.strict, false)],
];
for (const [name, fn] of modelCases) test(name, fn);

test("lead schema rejects invalid mobile", () => {
  const error = new Enquiry({ categorySlug: "painting", mobile: "123" }).validateSync();
  assert.match(error.errors.mobile.message, /invalid/i);
});

test("lead schema rejects invalid pincode", () => {
  const error = new Enquiry({ categorySlug: "painting", pincode: "000001" }).validateSync();
  assert.match(error.errors.pincode.message, /exactly 6 digits/);
});

test("lead schema rejects invalid category slug", () => {
  const error = new Enquiry({ categorySlug: "bad category" }).validateSync();
  assert.ok(error.errors.categorySlug);
});

test("lead schema rejects unsupported priority", () => {
  const error = new Enquiry({ categorySlug: "painting", priority: "critical" }).validateSync();
  assert.ok(error.errors.priority);
});

test("provider schema rejects rating above five", () => {
  const error = new Provider({ name: "Provider", mobile: "9876543210", categorySlugs: ["painting"], rating: 6 }).validateSync();
  assert.ok(error.errors.rating);
});

test("provider schema rejects invalid email", () => {
  const error = new Provider({ name: "Provider", mobile: "9876543210", categorySlugs: ["painting"], email: "bad" }).validateSync();
  assert.ok(error.errors.email);
});

test("invoice schema rejects unsupported status", () => {
  const error = new Invoice({ status: "refunded" }).validateSync();
  assert.ok(error.errors.status);
});

test("lead updateOne blocks direct Reference ID changes before database access", async () => {
  await assert.rejects(Enquiry.updateOne({}, { $set: { enquiryId: "changed" } }), /Reference ID cannot be changed/);
});

test("lead updateMany blocks Reference ID removal before database access", async () => {
  await assert.rejects(Enquiry.updateMany({}, { $unset: { enquiryId: 1 } }), /Reference ID cannot be changed/);
});

test("lead findOneAndUpdate blocks Reference ID rename before database access", async () => {
  await assert.rejects(Enquiry.findOneAndUpdate({}, { $rename: { enquiryId: "oldId" } }), /Reference ID cannot be changed/);
});

test("lead replacement is blocked before database access", async () => {
  await assert.rejects(Enquiry.replaceOne({}, { categorySlug: "painting" }), /Reference ID cannot be changed/);
});

test("lead query deletion is blocked before database access", async () => {
  await assert.rejects(Enquiry.deleteMany({}), /cannot be permanently deleted/);
});

test("lead document deletion is blocked before database access", async () => {
  await assert.rejects(new Enquiry({ categorySlug: "painting" }).deleteOne(), /cannot be permanently deleted/);
});

test("lead bulk deletion is blocked before database access", async () => {
  await assert.rejects(Enquiry.bulkWrite([{ deleteOne: { filter: { enquiryId: "REQ-1" } } }]), /cannot be permanently deleted/);
});

test("lead bulk Reference ID change is blocked before database access", async () => {
  await assert.rejects(Enquiry.bulkWrite([{ updateOne: { filter: {}, update: { $set: { enquiryId: "changed" } } } }]), /Reference ID cannot be changed/);
});
