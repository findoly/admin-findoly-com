"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function matchesValue(value, condition) {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if ("$in" in condition && !condition.$in.includes(value)) return false;
    if ("$ne" in condition && value === condition.$ne) return false;
    if ("$exists" in condition && condition.$exists !== (value !== undefined)) return false;
    if ("$lt" in condition && !(value < condition.$lt)) return false;
    return true;
  }
  return value === condition;
}

function matches(row, query = {}) {
  if (query.$or && !query.$or.some((branch) => matches(row, branch))) return false;
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$or") continue;
    if (!matchesValue(row[key], condition)) return false;
  }
  return true;
}

class FakeQuery {
  constructor(value) { this.value = value; }
  session() { return this; }
  select() { return this; }
  sort() { return this; }
  limit() { return this; }
  async lean() { return clone(this.value); }
}

function createHarness(initialRows) {
  const rows = initialRows.map(clone);
  const released = [];
  const ProviderJoinRequest = {
    findOne(query) {
      return new FakeQuery(rows.find((row) => matches(row, query)) || null);
    },
    async updateOne(query, update) {
      const row = rows.find((candidate) => matches(candidate, query));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(row, clone(update.$set));
      if (update.$push?.statusHistory) {
        const spec = update.$push.statusHistory;
        row.statusHistory = [...(row.statusHistory || []), ...clone(spec.$each || [])];
        if (spec.$slice < 0) row.statusHistory = row.statusHistory.slice(spec.$slice);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const index = rows.findIndex((row) => matches(row, query));
      if (index < 0) return { deletedCount: 0 };
      rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    findOneAndUpdate() { throw new Error("not used by this isolated test"); },
  };

  const stubs = new Map([
    ["../../models/ProviderJoinRequest", ProviderJoinRequest],
    ["../../models/Provider", { findOne: () => new FakeQuery(null) }],
    ["../../models/Category", { find: () => new FakeQuery([]) }],
    ["../provider/provider-service", { create() {}, presentProvider(value) { return value; } }],
    ["../../utils/transaction", { withTransaction: async (fn) => fn({ testSession: true }) }],
    ["../contact-identity/contact-identity-service", {
      async releaseEntityContacts(type, id) { released.push({ type, id }); },
    }],
    ["../../utils/pagination", {
      getPagination() { return { limit: 20, cursor: "" }; },
      async cursorPaginate() { return { data: [], pagination: {} }; },
    }],
    ["../../utils/date-query", {
      applyDateRange() {},
      dateSort() { return { createdAt: -1, _id: -1 }; },
    }],
    ["../../utils/search-query", { buildSearchAlternatives() { return []; } }],
  ]);

  const servicePath = path.resolve(__dirname, "../services/provider-request/provider-request-service.js");
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  let service;
  try {
    service = require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
  return { service, rows, released };
}

test("rejected request requires a new note and then reopens with bounded history", async () => {
  const { service, rows } = createHarness([{
    providerJoinRequestId: "request-1",
    name: "Applicant",
    mobile: "9876543210",
    status: "rejected",
    internalNote: "Documents were incomplete",
    rejectedAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-08-01T10:00:00.000Z"),
    statusHistory: [],
    conversionLockAt: null,
  }]);

  await assert.rejects(
    () => service.updateStatus("request-1", {
      status: "contacted",
      internalNote: "Documents were incomplete",
    }, { employeeId: "employee-1" }),
    /explain why this rejected request is being reopened/,
  );

  const updated = await service.updateStatus("request-1", {
    status: "contacted",
    internalNote: "Applicant supplied the missing documents",
  }, { employeeId: "employee-1" });

  assert.equal(updated.status, "contacted");
  assert.equal(updated.internalNote, "Applicant supplied the missing documents");
  assert.equal(rows[0].statusHistory.length, 2);
  assert.equal(rows[0].statusHistory[0].toStatus, "rejected");
  assert.equal(rows[0].statusHistory[1].toStatus, "contacted");
});

test("request deletion releases contacts and converted requests remain protected", async () => {
  const deletable = createHarness([{
    providerJoinRequestId: "request-2",
    name: "Applicant",
    mobile: "9876543210",
    status: "rejected",
    conversionLockAt: null,
  }]);
  const result = await deletable.service.remove("request-2", { employeeId: "employee-2" });
  assert.equal(result.providerJoinRequestId, "request-2");
  assert.deepEqual(deletable.rows, []);
  assert.deepEqual(deletable.released, [{ type: "provider_join_request", id: "request-2" }]);

  const protectedRequest = createHarness([{
    providerJoinRequestId: "request-3",
    name: "Converted",
    mobile: "9876543211",
    status: "converted",
    conversionLockAt: null,
  }]);
  await assert.rejects(
    () => protectedRequest.service.remove("request-3", { employeeId: "employee-2" }),
    /retained for audit history/,
  );
  assert.equal(protectedRequest.rows.length, 1);
  assert.deepEqual(protectedRequest.released, []);
});
