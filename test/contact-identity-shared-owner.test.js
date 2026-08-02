"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function valueMatches(candidate, condition) {
  if (condition && typeof condition === "object" && "$in" in condition) {
    return condition.$in.includes(candidate);
  }
  if (condition && typeof condition === "object" && "$nin" in condition) {
    return !condition.$nin.includes(candidate);
  }
  return candidate === condition;
}

function rowMatches(row, query = {}) {
  if (query.$or && !query.$or.some((branch) => rowMatches(row, branch))) return false;
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$or") continue;
    if (key === "sharedOwners" && condition?.$elemMatch) {
      if (!(row.sharedOwners || []).some((owner) => rowMatches(owner, condition.$elemMatch))) return false;
      continue;
    }
    if (!valueMatches(row[key], condition)) return false;
  }
  return true;
}

class FakeQuery {
  constructor(value) {
    this.value = value;
  }
  select() { return this; }
  session() { return this; }
  sort() { return this; }
  limit() { return this; }
  async lean() { return clone(this.value); }
}

function createHarness() {
  const identities = [];
  const collections = {
    agent: [],
    employee: [],
    provider: [],
    provider_join_request: [],
  };
  let nextId = 1;

  const ContactIdentity = {
    find(query) {
      return new FakeQuery(identities.filter((row) => rowMatches(row, query)));
    },
    findOne(query) {
      return new FakeQuery(identities.find((row) => rowMatches(row, query)) || null);
    },
    async create(rows) {
      for (const input of rows) {
        if (identities.some((row) => row.key === input.key)) {
          const error = new Error("duplicate");
          error.code = 11000;
          throw error;
        }
        identities.push({ _id: String(nextId++), ...clone(input) });
      }
      return rows;
    },
    async updateOne(filter, update) {
      const row = identities.find((candidate) => rowMatches(candidate, filter));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(row, clone(update.$set));
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) {
      const index = identities.findIndex((row) => rowMatches(row, filter));
      if (index < 0) return { deletedCount: 0 };
      identities.splice(index, 1);
      return { deletedCount: 1 };
    },
  };

  function modelFor(type, idField) {
    return {
      findOne(query) {
        const row = collections[type].find((candidate) => rowMatches(candidate, query));
        return new FakeQuery(row ? { ...row, [idField]: row[idField] } : null);
      },
    };
  }

  const fakeModules = new Map([
    ["../../models/ContactIdentity", ContactIdentity],
    ["../../models/Agent", modelFor("agent", "agentId")],
    ["../../models/Employee", modelFor("employee", "employeeId")],
    ["../../models/Provider", modelFor("provider", "providerId")],
    ["../../models/ProviderJoinRequest", modelFor("provider_join_request", "providerJoinRequestId")],
  ]);

  const servicePath = path.resolve(__dirname, "../services/contact-identity/contact-identity-service.js");
  delete require.cache[servicePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (fakeModules.has(request)) return fakeModules.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  let service;
  try {
    service = require(servicePath);
  } finally {
    Module._load = originalLoad;
  }

  return { service, identities, collections };
}

test("Employee and Provider can share one contact identity without weakening Agent conflicts", async () => {
  const { service, identities, collections } = createHarness();
  collections.employee.push({
    employeeId: "employee-1",
    normalizedMobile: "9876543210",
    normalizedEmail: "person@example.com",
  });
  identities.push({
    _id: "identity-1",
    key: "phone:9876543210",
    kind: "phone",
    value: "9876543210",
    entityType: "employee",
    entityId: "employee-1",
    field: "mobile",
    sourceCollection: "crmemployees",
    sharedOwners: [],
  });

  await service.syncEntityContacts({
    entityType: "provider",
    entityId: "provider-1",
    contacts: { mobile: "9876543210" },
    allowEmployeeProviderOverlap: true,
  });

  assert.equal(identities.length, 1);
  assert.equal(identities[0].entityType, "employee");
  assert.deepEqual(identities[0].sharedOwners, [{
    entityType: "provider",
    entityId: "provider-1",
    field: "mobile",
    sourceCollection: "providers",
  }]);

  collections.provider.push({ providerId: "provider-1", normalizedMobile: "9876543210" });
  await assert.rejects(
    () => service.syncEntityContacts({
      entityType: "agent",
      entityId: "agent-1",
      contacts: { mobile: "9876543210" },
    }),
    (error) => error?.code === "CONTACT_ALREADY_EXISTS",
  );

  await service.releaseEntityContacts("employee", "employee-1");
  assert.equal(identities[0].entityType, "provider");
  assert.equal(identities[0].entityId, "provider-1");
  assert.deepEqual(identities[0].sharedOwners, []);

  await service.releaseEntityContacts("provider", "provider-1");
  assert.deepEqual(identities, []);
});

test("Employee-linked contact can be shared by Agent, Provider and Provider joining request while same-role duplicates stay blocked", async () => {
  const { service, identities, collections } = createHarness();
  const contact = "9876543210";
  collections.employee.push({ employeeId: "employee-1", normalizedMobile: contact });
  identities.push({
    _id: "identity-1",
    key: `phone:${contact}`,
    kind: "phone",
    value: contact,
    entityType: "employee",
    entityId: "employee-1",
    field: "mobile",
    sourceCollection: "crmemployees",
    sharedOwners: [],
  });

  await service.syncEntityContacts({
    entityType: "agent",
    entityId: "agent-1",
    contacts: { mobile: contact },
    allowEmployeeRoleOverlap: true,
  });
  collections.agent.push({ agentId: "agent-1", normalizedMobile: contact });

  await service.syncEntityContacts({
    entityType: "provider",
    entityId: "provider-1",
    contacts: { mobile: contact },
    allowEmployeeRoleOverlap: true,
  });
  collections.provider.push({ providerId: "provider-1", normalizedMobile: contact });

  await service.syncEntityContacts({
    entityType: "provider_join_request",
    entityId: "request-1",
    contacts: { mobile: contact },
    allowEmployeeRoleOverlap: true,
  });
  collections.provider_join_request.push({ providerJoinRequestId: "request-1", normalizedMobile: contact });

  assert.deepEqual(
    identities[0].sharedOwners.map((owner) => owner.entityType).sort(),
    ["agent", "provider", "provider_join_request"],
  );

  await assert.rejects(
    () => service.syncEntityContacts({
      entityType: "agent",
      entityId: "agent-2",
      contacts: { mobile: contact },
      allowEmployeeRoleOverlap: true,
    }),
    (error) => error?.code === "CONTACT_ALREADY_EXISTS",
  );
});
