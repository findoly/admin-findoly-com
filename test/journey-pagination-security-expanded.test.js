const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  LEAD_JOURNEY,
  STATUS_ALIASES,
  VALID_ACTIONS,
  canonicalLeadStatus,
  resolveLeadStatusTransition,
} = require("../utils/lead-journey");
const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_CURSOR_LENGTH,
  normalizeLimit,
  normalizeSort,
  encodeCursor,
  decodeCursor,
  buildCursorCondition,
  mergeQuery,
  cursorPaginate,
  getPagination,
} = require("../utils/pagination");
const { normalizedError } = require("../middleware/error");
const { encodeSession, decodeSession } = require("../middleware/auth");

function expectStatus(fn, status, pattern = /./) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

const journeyCases = [
  ["journey contains the four approved ordered stages", () => assert.deepEqual(LEAD_JOURNEY, ["new", "verification", "approved", "distributed"])],
  ["journey exposes only supported actions", () => assert.deepEqual(VALID_ACTIONS, ["next", "previous", "reject", "restore"])],
  ["journey maps verification_pending alias", () => assert.equal(canonicalLeadStatus("verification_pending"), "verification")],
  ["journey maps verified alias", () => assert.equal(canonicalLeadStatus("verified"), "verification")],
  ["journey maps in_progress alias", () => assert.equal(canonicalLeadStatus("in_progress"), "distributed")],
  ["journey maps completed alias", () => assert.equal(canonicalLeadStatus("completed"), "distributed")],
  ["journey maps closed alias", () => assert.equal(canonicalLeadStatus("closed"), "distributed")],
  ["journey preserves provider-controlled sale conversion", () => assert.equal(canonicalLeadStatus("sale_converted"), "sale_converted")],
  ["journey locks employee actions after sale conversion", () => expectStatus(() => resolveLeadStatusTransition("sale_converted", { action: "previous" }), 400, /provider-controlled/)],
  ["journey canonicalizer defaults unknown legacy values to new", () => assert.equal(canonicalLeadStatus("legacy-unknown"), "new")],
  ["journey moves new to verification", () => assert.equal(resolveLeadStatusTransition("new", { action: "next" }).toStatus, "verification")],
  ["journey moves verification to approved", () => assert.equal(resolveLeadStatusTransition("verification", { action: "next" }).toStatus, "approved")],
  ["journey moves approved to distributed", () => assert.equal(resolveLeadStatusTransition("approved", { action: "next" }).toStatus, "distributed")],
  ["journey locks previous after distribution", () => expectStatus(() => resolveLeadStatusTransition("distributed", { action: "previous" }), 400, /provider-controlled/)],
  ["journey moves approved to verification", () => assert.equal(resolveLeadStatusTransition("approved", { action: "previous" }).toStatus, "verification")],
  ["journey moves verification to new", () => assert.equal(resolveLeadStatusTransition("verification", { action: "previous" }).toStatus, "new")],
  ["journey accepts an adjacent requested status", () => assert.equal(resolveLeadStatusTransition("new", { status: "verification" }).action, "next")],
  ["journey accepts an adjacent previous requested status", () => assert.equal(resolveLeadStatusTransition("approved", { status: "verification" }).action, "previous")],
  ["journey rejects skipping forward", () => expectStatus(() => resolveLeadStatusTransition("new", { status: "approved" }), 400, /next or previous/)],
  ["journey rejects skipping backward after distribution", () => expectStatus(() => resolveLeadStatusTransition("distributed", { status: "verification" }), 400, /provider-controlled/)],
  ["journey rejects previous at first stage", () => expectStatus(() => resolveLeadStatusTransition("new", { action: "previous" }), 400, /first journey stage/)],
  ["journey locks next after distribution", () => expectStatus(() => resolveLeadStatusTransition("distributed", { action: "next" }), 400, /provider-controlled/)],
  ["journey allows rejection from new with a reason", () => assert.equal(resolveLeadStatusTransition("new", { action: "reject", note: "Invalid request" }).toStatus, "rejected")],
  ["journey allows rejection from verification", () => assert.equal(resolveLeadStatusTransition("verification", { status: "rejected", reason: "Duplicate" }).fromStatus, "verification")],
  ["journey requires a rejection reason", () => expectStatus(() => resolveLeadStatusTransition("approved", { action: "reject" }), 400, /reason is required/)],
  ["journey rejects rejecting an already rejected lead", () => expectStatus(() => resolveLeadStatusTransition("rejected", { action: "reject", note: "again" }), 400, /already rejected/)],
  ["journey restores rejected lead to recorded stage", () => assert.equal(resolveLeadStatusTransition("rejected", { action: "restore" }, { rejectedFromStatus: "approved" }).toStatus, "approved")],
  ["journey previous restores a rejected lead", () => assert.equal(resolveLeadStatusTransition("rejected", { action: "previous" }, { rejectedFromStatus: "verification" }).action, "restore")],
  ["journey safely restores invalid stored stage to new", () => assert.equal(resolveLeadStatusTransition("rejected", { action: "restore" }, { rejectedFromStatus: "rejected" }).toStatus, "new")],
  ["journey blocks direct rejected-to-different-stage selection", () => expectStatus(() => resolveLeadStatusTransition("rejected", { status: "approved" }, { rejectedFromStatus: "verification" }), 400, /Restore the rejected lead/)],
  ["journey accepts rejected-to-recorded-stage selection", () => assert.equal(resolveLeadStatusTransition("rejected", { status: "verification" }, { rejectedFromStatus: "verification" }).action, "restore")],
  ["journey rejects unknown actions", () => expectStatus(() => resolveLeadStatusTransition("new", { action: "delete" }), 400, /Select next/)],
  ["journey rejects unknown requested statuses", () => expectStatus(() => resolveLeadStatusTransition("new", { status: "archived" }), 400, /valid lead status/)],
  ["journey requires an action or adjacent status", () => expectStatus(() => resolveLeadStatusTransition("new", {}), 400, /Select next/)],
  ["journey trims status notes", () => assert.equal(resolveLeadStatusTransition("new", { action: "reject", note: "  duplicate  " }).note, "duplicate")],
  ["journey limits status notes", () => expectStatus(() => resolveLeadStatusTransition("new", { action: "reject", note: "x".repeat(1001) }), 400, /1000 characters/)],
  ["journey alias table remains backward compatible", () => assert.equal(Object.keys(STATUS_ALIASES).length, 5)],
];
for (const [name, fn] of journeyCases) test(name, fn);

const paginationCases = [
  ["pagination default limit is twenty", () => assert.equal(DEFAULT_LIMIT, 20)],
  ["pagination maximum limit is one hundred", () => assert.equal(MAX_LIMIT, 100)],
  ["pagination returns default for missing limit", () => assert.equal(normalizeLimit(undefined), 20)],
  ["pagination returns default for zero", () => assert.equal(normalizeLimit(0), 20)],
  ["pagination returns default for negative limit", () => assert.equal(normalizeLimit(-1), 20)],
  ["pagination returns default for decimal limit", () => assert.equal(normalizeLimit(1.5), 20)],
  ["pagination returns default for nonnumeric limit", () => assert.equal(normalizeLimit("many"), 20)],
  ["pagination accepts a valid limit", () => assert.equal(normalizeLimit("50"), 50)],
  ["pagination caps a large limit", () => assert.equal(normalizeLimit(500), 100)],
  ["pagination uses a safe custom fallback", () => assert.equal(normalizeLimit(undefined, 25), 25)],
  ["pagination caps a large custom fallback", () => assert.equal(normalizeLimit(undefined, 500), 100)],
  ["pagination replaces an invalid custom fallback", () => assert.equal(normalizeLimit(undefined, -1), 20)],
  ["pagination normalizes ascending direction", () => assert.deepEqual(normalizeSort({ name: 1 }), { name: 1, _id: 1 })],
  ["pagination normalizes other directions to descending", () => assert.deepEqual(normalizeSort({ name: 20 }), { name: -1, _id: -1 })],
  ["pagination retains explicit ID direction", () => assert.deepEqual(normalizeSort({ createdAt: -1, _id: 1 }), { createdAt: -1, _id: 1 })],
  ["pagination rejects a non-object sort", () => expectStatus(() => normalizeSort("createdAt"), 500, /sort must be an object/)],
  ["pagination rejects dollar-prefixed sort fields", () => expectStatus(() => normalizeSort({ $where: 1 }), 500, /field is invalid/)],
  ["pagination rejects dotted sort fields", () => expectStatus(() => normalizeSort({ "profile.name": 1 }), 500, /field is invalid/)],
  ["pagination rejects null-byte sort fields", () => expectStatus(() => normalizeSort({ "name\0x": 1 }), 500, /field is invalid/)],
  ["pagination cursor round-trips date ObjectId string number boolean and null", () => {
    const row = {
      createdAt: new Date("2026-07-12T00:00:00.000Z"),
      score: 10,
      active: true,
      name: "A",
      optional: null,
      _id: new mongoose.Types.ObjectId(),
    };
    const sort = { createdAt: -1, score: -1, active: -1, name: -1, optional: -1, _id: -1 };
    const decoded = decodeCursor(encodeCursor(row, sort), sort);
    assert.equal(decoded.createdAt.toISOString(), row.createdAt.toISOString());
    assert.equal(decoded._id.toString(), row._id.toString());
    assert.equal(decoded.score, 10);
    assert.equal(decoded.active, true);
    assert.equal(decoded.optional, null);
  }],
  ["pagination rejects encoding an empty row", () => expectStatus(() => encodeCursor(null, { createdAt: -1 }), 500, /empty pagination cursor/)],
  ["pagination rejects encoding an invalid date", () => expectStatus(() => encodeCursor({ createdAt: new Date("bad"), _id: new mongoose.Types.ObjectId() }, { createdAt: -1, _id: -1 }), 500, /invalid cursor date/)],
  ["pagination rejects unsupported cursor value types", () => expectStatus(() => encodeCursor({ nested: {}, _id: new mongoose.Types.ObjectId() }, { nested: -1, _id: -1 }), 500, /Unsupported/)],
  ["pagination returns null for empty cursor", () => assert.equal(decodeCursor("", { createdAt: -1 }), null)],
  ["pagination rejects invalid cursor alphabet", () => expectStatus(() => decodeCursor("not+base64", { createdAt: -1 }), 400, /Invalid pagination cursor/)],
  ["pagination rejects oversized cursor", () => expectStatus(() => decodeCursor("a".repeat(MAX_CURSOR_LENGTH + 1), { createdAt: -1 }), 400, /Invalid pagination cursor/)],
  ["pagination rejects malformed cursor JSON", () => expectStatus(() => decodeCursor(Buffer.from("not-json").toString("base64url"), { createdAt: -1 }), 400, /Invalid pagination cursor/)],
  ["pagination rejects cursor used with another sort", () => {
    const token = encodeCursor({ createdAt: new Date(), _id: new mongoose.Types.ObjectId() }, { createdAt: -1 });
    expectStatus(() => decodeCursor(token, { name: 1 }), 400, /Invalid pagination cursor/);
  }],
  ["pagination creates descending keyset conditions", () => {
    const date = new Date("2026-07-12T00:00:00Z");
    const id = new mongoose.Types.ObjectId();
    assert.deepEqual(buildCursorCondition({ createdAt: -1, _id: -1 }, { createdAt: date, _id: id }), { $or: [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: id } }] });
  }],
  ["pagination creates ascending keyset conditions", () => assert.deepEqual(buildCursorCondition({ name: 1, _id: 1 }, { name: "A", _id: "1" }), { $or: [{ name: { $gt: "A" } }, { name: "A", _id: { $gt: "1" } }] })],
  ["pagination rejects missing cursor fields", () => expectStatus(() => buildCursorCondition({ createdAt: -1, _id: -1 }, { createdAt: new Date() }), 400, /Invalid pagination cursor/)],
  ["pagination merge keeps base query without cursor", () => assert.deepEqual(mergeQuery({ active: true }, null), { active: true })],
  ["pagination merge returns cursor for empty base query", () => assert.deepEqual(mergeQuery({}, { $or: [{ id: { $lt: 1 } }] }), { $or: [{ id: { $lt: 1 } }] })],
  ["pagination merge combines both conditions", () => assert.deepEqual(mergeQuery({ active: true }, { $or: [{ id: { $lt: 1 } }] }), { $and: [{ active: true }, { $or: [{ id: { $lt: 1 } }] }] })],
  ["pagination query parser preserves a valid cursor", () => assert.deepEqual(getPagination({ limit: "25", cursor: "abc_123" }), { limit: 25, cursor: "abc_123" })],
  ["pagination query parser rejects oversized cursor before database access", () => expectStatus(() => getPagination({ cursor: "a".repeat(MAX_CURSOR_LENGTH + 1) }), 400, /Invalid pagination cursor/)],
];
for (const [name, fn] of paginationCases) test(name, fn);

test("cursor pagination fetches only limit plus one and emits next cursor", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    createdAt: new Date(`2026-07-12T00:0${4 - index}:00Z`),
    _id: new mongoose.Types.ObjectId(),
    name: `row-${index}`,
  }));
  const calls = {};
  const builder = {
    sort(value) { calls.sort = value; return this; },
    limit(value) { calls.limit = value; return this; },
    select(value) { calls.select = value; return this; },
    async lean() { return rows; },
  };
  const Model = { find(query) { calls.query = query; return builder; } };
  const result = await cursorPaginate(Model, { query: { active: true }, limit: 3, select: { name: 1 } });
  assert.equal(calls.limit, 4);
  assert.deepEqual(calls.query, { active: true });
  assert.deepEqual(calls.select, { name: 1 });
  assert.equal(result.data.length, 3);
  assert.equal(result.pagination.hasNext, true);
  assert.ok(result.pagination.nextCursor);
});

test("cursor pagination omits next cursor on final page", async () => {
  const rows = [{ createdAt: new Date(), _id: new mongoose.Types.ObjectId() }];
  const builder = { sort() { return this; }, limit() { return this; }, async lean() { return rows; } };
  const result = await cursorPaginate({ find() { return builder; } }, { limit: 2 });
  assert.equal(result.pagination.hasNext, false);
  assert.equal(result.pagination.nextCursor, "");
  assert.equal(result.pagination.returned, 1);
});

test("cursor pagination applies decoded cursor condition to the direct query", async () => {
  const date = new Date("2026-07-12T00:00:00Z");
  const id = new mongoose.Types.ObjectId();
  const sort = { createdAt: -1, _id: -1 };
  const cursor = encodeCursor({ createdAt: date, _id: id }, sort);
  let received;
  const builder = { sort() { return this; }, limit() { return this; }, async lean() { return []; } };
  await cursorPaginate({ find(query) { received = query; return builder; } }, { query: { active: true }, sort, cursor });
  assert.deepEqual(received, { $and: [{ active: true }, { $or: [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: id } }] }] });
});

test("cursor pagination rejects invalid model", async () => {
  await assert.rejects(cursorPaginate({}, {}), (error) => error.status === 500 && /model is invalid/.test(error.message));
});

test("cursor pagination rejects a non-array database response", async () => {
  const builder = { sort() { return this; }, limit() { return this; }, async lean() { return null; } };
  await assert.rejects(cursorPaginate({ find() { return builder; } }, {}), (error) => error.status === 500 && /invalid result/.test(error.message));
});

const errorCases = [
  ["error normalizer maps malformed JSON", () => assert.deepEqual(normalizedError({ type: "entity.parse.failed" }), { status: 400, message: "Invalid JSON request body" })],
  ["error normalizer maps oversized body", () => assert.deepEqual(normalizedError({ type: "entity.too.large" }), { status: 413, message: "Request body is too large" })],
  ["error normalizer maps duplicate keys", () => assert.deepEqual(normalizedError({ code: 11000 }), { status: 409, message: "A record with the same unique value already exists" })],
  ["error normalizer maps Mongoose validation errors", () => assert.deepEqual(normalizedError({ name: "ValidationError", errors: { field: { message: "Field invalid" } } }), { status: 400, message: "Field invalid" })],
  ["error normalizer maps cast errors", () => assert.deepEqual(normalizedError({ name: "CastError", path: "_id" }), { status: 400, message: "Invalid value for _id" })],
  ["error normalizer preserves safe client errors", () => assert.deepEqual(normalizedError({ status: 422, message: "Cannot process" }), { status: 422, message: "Cannot process" })],
  ["error normalizer hides server error details", () => assert.deepEqual(normalizedError({ status: 500, message: "database password leaked" }), { status: 500, message: "Something went wrong" })],
  ["error normalizer converts invalid status to server error", () => assert.deepEqual(normalizedError({ status: 200, message: "bad" }), { status: 500, message: "Something went wrong" })],
  ["signed auth session round trips", () => {
    const token = encodeSession({ v: 1, employeeId: "employee-1", exp: Date.now() + 1000 });
    assert.equal(decodeSession(token).employeeId, "employee-1");
  }],
  ["signed auth session rejects tampering", () => {
    const token = encodeSession({ v: 1, employeeId: "employee-1", exp: Date.now() + 1000 });
    assert.throws(() => decodeSession(token + "x"), /Invalid session/);
  }],
  ["signed auth session requires employee identity", () => {
    const token = encodeSession({ v: 1, exp: Date.now() + 1000 });
    assert.throws(() => decodeSession(token), /Invalid session payload/);
  }],
];
for (const [name, fn] of errorCases) test(name, fn);
