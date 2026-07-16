const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { adminCookie } = require("./helpers/auth");
const mongoose = require("mongoose");

process.env.SKIP_DB = "true";
process.env.AUTH_COOKIE_NAME = "service_crm_admin";

const app = require("../app");
const Enquiry = require("../models/Enquiry");
const LeadDistribution = require("../models/LeadDistribution");
const Provider = require("../models/Provider");
const WalletTransaction = require("../models/WalletTransaction");
const {
  normalizeLimit,
  normalizeSort,
  encodeCursor,
  decodeCursor,
  buildCursorCondition,
  cursorPaginate,
} = require("../utils/pagination");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}


test("cursor pagination uses stable keyset values and bounded page sizes", async () => {
  assert.equal(normalizeLimit("0"), 20);
  assert.equal(normalizeLimit("25"), 25);
  assert.equal(normalizeLimit("999"), 100);

  const sort = normalizeSort({ createdAt: -1 });
  assert.deepEqual(sort, { createdAt: -1, _id: -1 });

  const createdAt = new Date("2026-07-12T05:00:00.000Z");
  const objectId = new mongoose.Types.ObjectId();
  const token = encodeCursor({ createdAt, _id: objectId }, sort);
  const decoded = decodeCursor(token, sort);

  assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(decoded._id.toString(), objectId.toString());
  assert.deepEqual(buildCursorCondition(sort, decoded), {
    $or: [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: objectId } },
    ],
  });

  const rows = [
    { createdAt: new Date("2026-07-12T05:03:00.000Z"), _id: new mongoose.Types.ObjectId() },
    { createdAt: new Date("2026-07-12T05:02:00.000Z"), _id: new mongoose.Types.ObjectId() },
    { createdAt: new Date("2026-07-12T05:01:00.000Z"), _id: new mongoose.Types.ObjectId() },
  ];
  const calls = {};
  const queryBuilder = {
    sort(value) { calls.sort = value; return this; },
    limit(value) { calls.limit = value; return this; },
    select(value) { calls.select = value; return this; },
    async lean() { return rows; },
  };
  const FakeModel = {
    find(query) { calls.query = query; return queryBuilder; },
  };

  const page = await cursorPaginate(FakeModel, {
    query: { status: "active" },
    sort: { createdAt: -1, _id: -1 },
    limit: 2,
    select: { name: 1 },
  });

  assert.deepEqual(calls.query, { status: "active" });
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.equal(calls.limit, 3);
  assert.deepEqual(calls.select, { name: 1 });
  assert.equal(page.data.length, 2);
  assert.equal(page.pagination.returned, 2);
  assert.equal(page.pagination.hasNext, true);
  assert.ok(page.pagination.nextCursor);
});

test("lead reference ID is immutable and permanent deletion is blocked", async () => {
  assert.equal(Enquiry.schema.path("enquiryId").options.immutable, true);
  for (const field of [
    "isActive",
    "deactivatedAt",
    "deactivatedBy",
    "deactivationReason",
  ]) {
    assert.ok(Enquiry.schema.path(field), `${field} must exist`);
  }

  await assert.rejects(
    Enquiry.updateOne({}, { $set: { enquiryId: "changed" } }),
    /Reference ID cannot be changed/,
  );
  await assert.rejects(
    Enquiry.updateOne({}, { $rename: { id: "enquiryId" } }),
    /Reference ID cannot be changed/,
  );
  await assert.rejects(
    Enquiry.deleteOne({ enquiryId: "lead-1" }),
    /cannot be permanently deleted/,
  );
  await assert.rejects(
    new Enquiry({ categorySlug: "painting" }).deleteOne(),
    /cannot be permanently deleted/,
  );
});

test("provider portal shared collections and fields remain compatible", () => {
  assert.equal(Enquiry.collection.collectionName, "enquiries");
  assert.equal(LeadDistribution.collection.collectionName, "leaddistributions");
  assert.equal(Provider.collection.collectionName, "providers");
  assert.equal(WalletTransaction.collection.collectionName, "wallettransactions");

  for (const field of [
    "leadDistributionId",
    "enquiryId",
    "providerId",
    "status",
    "contactUnlocked",
    "leadPricePaise",
    "providerLeadStatus",
    "providerLeadReason",
    "providerLeadNote",
    "providerLeadStatusUpdatedAt",
    "providerLeadStatusUpdatedBy",
  ]) {
    assert.ok(LeadDistribution.schema.path(field), `${field} must remain available`);
  }
});

test("growable CRM tables use cursor pagination without skip or aggregation", () => {
  const services = [
    "services/enquiry/enquiry-service.js",
    "services/provider/provider-service.js",
    "services/follow-up/follow-up-service.js",
    "services/communication/communication-service.js",
    "services/invoice/invoice-service.js",
    "services/distribution/distribution-service.js",
    "services/catalog/catalog-service.js",
  ];

  for (const file of services) {
    const content = source(file);
    assert.doesNotMatch(content, /\.skip\s*\(/, `${file} must not use offset pagination`);
    assert.doesNotMatch(content, /\.aggregate\s*\(/, `${file} must not use aggregation`);
    assert.doesNotMatch(content, /countDocuments\s*\(/, `${file} must not count full result sets for tables`);
    assert.match(content, /cursorPaginate|\.cursor\s*\(/, `${file} must use bounded or streamed reads`);
  }

  const paginatedViews = [
    "views/enquiry/index.ejs",
    "views/enquiry/provider-statuses.ejs",
    "views/provider/index.ejs",
    "views/provider/show.ejs",
    "views/category/index.ejs",
    "views/follow-up/index.ejs",
    "views/communication/index.ejs",
    "views/invoice/index.ejs",
    "views/distribution/index.ejs",
  ];
  for (const file of paginatedViews) {
    const content = source(file);
    assert.match(content, /createCursorPagination/);
    assert.match(content, /cursorNext/);
    assert.match(content, /cursorPrevious/);
  }
});

test("lead provider status navigation renders separate list and detail pages", async () => {
  const cookie = adminCookie();
  const listPage = await request(app)
    .get("/enquiries/lead-1/providers")
    .set("Cookie", [cookie]);
  assert.equal(listPage.status, 200);
  assert.match(listPage.text, /provider statuses/i);
  assert.match(listPage.text, /\/api\/enquiry\/.*\/providers/);

  const detailPage = await request(app)
    .get("/enquiries/lead-1/providers/distribution-1")
    .set("Cookie", [cookie]);
  assert.equal(detailPage.status, 200);
  assert.match(detailPage.text, /Provider journey/);

  const routes = source("routes/enquiry.js");
  assert.match(routes, /\/:enquiryId\/providers/);
  assert.match(routes, /\/:enquiryId\/deactivate/);
  assert.match(routes, /\/:enquiryId\/reactivate/);

  const leadList = source("views/enquiry/index.ejs");
  assert.match(leadList, /Provider status/);
  assert.doesNotMatch(leadList, /deleteLead|Delete lead/);
});
