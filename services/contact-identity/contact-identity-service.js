"use strict";

const ContactIdentity = require("../../models/ContactIdentity");
const Agent = require("../../models/Agent");
const Employee = require("../../models/Employee");
const Provider = require("../../models/Provider");
const ProviderJoinRequest = require("../../models/ProviderJoinRequest");
const {
  normalizePhone,
  normalizeEmail,
  contactEntries,
} = require("../../utils/contact-normalization");

const ENTITY_CONFIG = Object.freeze({
  agent: { idField: "agentId", collection: "agents" },
  provider: { idField: "providerId", collection: "providers" },
  employee: { idField: "employeeId", collection: "crmemployees" },
  provider_join_request: { idField: "providerJoinRequestId", collection: "providerjoinrequests" },
});

const EMPLOYEE_LINKED_TYPES = new Set(["employee", "agent", "provider", "provider_join_request"]);
// Backward-compatible aliases retained for existing deployment checks and callers.
const EMPLOYEE_PROVIDER_TYPES = EMPLOYEE_LINKED_TYPES;

function duplicateContactError(conflict = {}) {
  const label = conflict.kind === "email" ? "email address" : "mobile or WhatsApp number";
  const error = new Error(
    `This ${label} is already associated with an existing Employee, Agent, Provider, or Provider joining request.`,
  );
  error.status = 409;
  error.code = "CONTACT_ALREADY_EXISTS";
  error.conflict = {
    kind: conflict.kind || "contact",
    entityType: conflict.entityType || "record",
  };
  return error;
}

function sessionOptions(session) {
  return session ? { session } : {};
}

function ownerFromRow(row = {}) {
  return {
    entityType: row.entityType || "",
    entityId: String(row.entityId || ""),
    field: row.field || "",
    sourceCollection: row.sourceCollection || "",
  };
}

function sharedOwners(row = {}) {
  return Array.isArray(row.sharedOwners)
    ? row.sharedOwners.map((owner) => ({
      entityType: owner.entityType || "",
      entityId: String(owner.entityId || ""),
      field: owner.field || "",
      sourceCollection: owner.sourceCollection || "",
    }))
    : [];
}

function allOwners(row = {}) {
  return [ownerFromRow(row), ...sharedOwners(row)].filter((owner) => owner.entityType && owner.entityId);
}

function ownerMatches(owner, entityType, entityId) {
  return owner.entityType === entityType && String(owner.entityId) === String(entityId || "");
}

function isTransferableRequestOwner(owner, allowedProviderJoinRequestId) {
  return owner.entityType === "provider_join_request"
    && allowedProviderJoinRequestId
    && String(owner.entityId) === String(allowedProviderJoinRequestId);
}

function overlapEnabled(options = {}) {
  return Boolean(options.allowEmployeeRoleOverlap || options.allowEmployeeProviderOverlap);
}

function hasEmployeeOwner(row = {}) {
  return allOwners(row).some((owner) => owner.entityType === "employee");
}

function canShareEmployeeLinkedContact(row, entityType, entityId, enabled) {
  if (!enabled || !EMPLOYEE_LINKED_TYPES.has(entityType)) return false;
  const owners = allOwners(row);
  if (!owners.length || owners.some((owner) => !EMPLOYEE_LINKED_TYPES.has(owner.entityType))) return false;
  if (owners.some((owner) => owner.entityType === entityType && !ownerMatches(owner, entityType, entityId))) {
    return false;
  }
  return entityType === "employee" || hasEmployeeOwner(row);
}

function canShareEmployeeProviderContact(row, entityType, entityId, enabled) {
  return canShareEmployeeLinkedContact(row, entityType, entityId, enabled);
}

function entryMatchesRow(entry, row = {}) {
  if (entry.kind === "email") return normalizeEmail(row.normalizedEmail || row.email) === entry.value;
  return [
    normalizePhone(row.normalizedMobile || row.mobile),
    normalizePhone(row.normalizedWhatsappNumber || row.whatsappNumber),
  ].filter(Boolean).includes(entry.value);
}

async function employeeLinkedKeys(entries, incomingType, session = null) {
  const linked = new Set(incomingType === "employee" ? entries.map((entry) => entry.key) : []);
  for (const entry of entries) {
    const fields = entry.kind === "phone" ? ["normalizedMobile"] : ["normalizedEmail"];
    let lookup = Employee.findOne({ $or: fields.map((field) => ({ [field]: entry.value })) }).select({ employeeId: 1 });
    if (session) lookup = lookup.session(session);
    if (await lookup.lean()) linked.add(entry.key);
  }

  let identityLookup = ContactIdentity.find({ key: { $in: entries.map((entry) => entry.key) } });
  if (session) identityLookup = identityLookup.session(session);
  const identities = await identityLookup.lean();
  for (const row of identities) {
    if (hasEmployeeOwner(row)) linked.add(row.key);
  }
  return linked;
}

async function findDirectConflict({
  entityType,
  entityId,
  contacts,
  allowedProviderJoinRequestId = "",
  allowEmployeeRoleOverlap = false,
  allowEmployeeProviderOverlap = false,
  session = null,
}) {
  const entries = contactEntries(contacts);
  if (!entries.length) return null;
  const allowOverlap = allowEmployeeRoleOverlap || allowEmployeeProviderOverlap;
  const linkedKeys = allowOverlap ? await employeeLinkedKeys(entries, entityType, session) : new Set();

  const checks = [
    { entityType: "agent", model: Agent, idField: "agentId", phoneFields: ["normalizedMobile"], emailFields: ["normalizedEmail"] },
    { entityType: "employee", model: Employee, idField: "employeeId", phoneFields: ["normalizedMobile"], emailFields: ["normalizedEmail"] },
    { entityType: "provider", model: Provider, idField: "providerId", phoneFields: ["normalizedMobile", "normalizedWhatsappNumber"], emailFields: ["normalizedEmail"] },
    { entityType: "provider_join_request", model: ProviderJoinRequest, idField: "providerJoinRequestId", phoneFields: ["normalizedMobile", "normalizedWhatsappNumber"], emailFields: ["normalizedEmail"] },
  ];

  for (const entry of entries) {
    for (const check of checks) {
      const fields = entry.kind === "phone" ? check.phoneFields : check.emailFields;
      if (!fields.length) continue;
      const query = { $or: fields.map((field) => ({ [field]: entry.value })) };
      const excludedIds = [];
      if (check.entityType === entityType && entityId) excludedIds.push(entityId);
      if (check.entityType === "provider_join_request" && allowedProviderJoinRequestId) excludedIds.push(allowedProviderJoinRequestId);
      if (excludedIds.length) query[check.idField] = { $nin: excludedIds };
      if (check.entityType === "provider_join_request" && entityType === "provider" && entityId) {
        query.$nor = [{ status: "converted", convertedProviderId: entityId }];
      }

      let lookup = check.model.findOne(query).select({ [check.idField]: 1 });
      if (session) lookup = lookup.session(session);
      const row = await lookup.lean();
      if (!row) continue;

      const existingId = row[check.idField] || "";
      if (check.entityType === entityType && String(existingId) !== String(entityId || "")) {
        return { kind: entry.kind, entityType: check.entityType, entityId: existingId };
      }
      if (check.entityType === "provider_join_request"
        && allowedProviderJoinRequestId
        && String(existingId) === String(allowedProviderJoinRequestId)) continue;

      const employeeLinkedShare = allowOverlap
        && EMPLOYEE_LINKED_TYPES.has(entityType)
        && EMPLOYEE_LINKED_TYPES.has(check.entityType)
        && entityType !== check.entityType
        && (entityType === "employee" || linkedKeys.has(entry.key));
      if (employeeLinkedShare) continue;
      return { kind: entry.kind, entityType: check.entityType, entityId: existingId };
    }
  }
  return null;
}

async function assertContactsAvailable(options) {
  const direct = await findDirectConflict(options);
  if (direct) throw duplicateContactError(direct);

  const desired = contactEntries(options.contacts);
  if (!desired.length) return desired;
  let lookup = ContactIdentity.find({ key: { $in: desired.map((entry) => entry.key) } });
  if (options.session) lookup = lookup.session(options.session);
  const existing = await lookup.lean();
  const conflict = existing.find((row) => {
    const owners = allOwners(row);
    const sameOwner = owners.some((owner) => ownerMatches(owner, options.entityType, options.entityId));
    const transferableRequest = owners.some((owner) => isTransferableRequestOwner(
      owner,
      options.allowedProviderJoinRequestId,
    ));
    const employeeRoleShare = canShareEmployeeLinkedContact(
      row,
      options.entityType,
      options.entityId,
      overlapEnabled(options),
    );
    return !sameOwner && !transferableRequest && !employeeRoleShare;
  });
  if (conflict) throw duplicateContactError(conflict);
  return desired;
}

function ownerRecord(entityType, entityId, field, sourceCollection) {
  return {
    entityType,
    entityId: String(entityId),
    field,
    sourceCollection,
  };
}

async function removeOwnerFromRow(row, entityType, entityId, session) {
  const primaryMatches = ownerMatches(ownerFromRow(row), entityType, entityId);
  const secondaryOwners = sharedOwners(row);
  if (primaryMatches) {
    if (!secondaryOwners.length) {
      await ContactIdentity.deleteOne({ _id: row._id }, sessionOptions(session));
      return;
    }
    const [promoted, ...remaining] = secondaryOwners;
    await ContactIdentity.updateOne(
      { _id: row._id },
      {
        $set: {
          entityType: promoted.entityType,
          entityId: promoted.entityId,
          field: promoted.field,
          sourceCollection: promoted.sourceCollection,
          sharedOwners: remaining,
          updatedAt: new Date(),
        },
      },
      sessionOptions(session),
    );
    return;
  }

  const remaining = secondaryOwners.filter((owner) => !ownerMatches(owner, entityType, entityId));
  if (remaining.length !== secondaryOwners.length) {
    await ContactIdentity.updateOne(
      { _id: row._id },
      { $set: { sharedOwners: remaining, updatedAt: new Date() } },
      sessionOptions(session),
    );
  }
}

async function removeStaleOwnership(entityType, entityId, desiredKeys, session) {
  let lookup = ContactIdentity.find({
    $or: [
      { entityType, entityId },
      { sharedOwners: { $elemMatch: { entityType, entityId } } },
    ],
    ...(desiredKeys.length ? { key: { $nin: desiredKeys } } : {}),
  });
  if (session) lookup = lookup.session(session);
  const rows = await lookup.lean();
  for (const row of rows) {
    await removeOwnerFromRow(row, entityType, entityId, session);
  }
}

async function writeOwnerForEntry({
  entry,
  entityType,
  entityId,
  sourceCollection,
  allowedProviderJoinRequestId,
  allowEmployeeRoleOverlap,
  allowEmployeeProviderOverlap,
  session,
}) {
  const incomingOwner = ownerRecord(entityType, entityId, entry.field, sourceCollection);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let lookup = ContactIdentity.findOne({ key: entry.key });
    if (session) lookup = lookup.session(session);
    const existing = await lookup.lean();

    if (!existing) {
      try {
        await ContactIdentity.create([{
          key: entry.key,
          kind: entry.kind,
          value: entry.value,
          ...incomingOwner,
          sharedOwners: [],
        }], { session });
        return;
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
    }

    const primary = ownerFromRow(existing);
    const secondaries = sharedOwners(existing);
    if (ownerMatches(primary, entityType, entityId)) {
      await ContactIdentity.updateOne(
        { _id: existing._id },
        {
          $set: {
            kind: entry.kind,
            value: entry.value,
            field: entry.field,
            sourceCollection,
            updatedAt: new Date(),
          },
        },
        sessionOptions(session),
      );
      return;
    }

    const sharedIndex = secondaries.findIndex((owner) => ownerMatches(owner, entityType, entityId));
    if (sharedIndex >= 0) {
      secondaries[sharedIndex] = incomingOwner;
      await ContactIdentity.updateOne(
        { _id: existing._id },
        {
          $set: {
            kind: entry.kind,
            value: entry.value,
            sharedOwners: secondaries,
            updatedAt: new Date(),
          },
        },
        sessionOptions(session),
      );
      return;
    }

    if (isTransferableRequestOwner(primary, allowedProviderJoinRequestId)) {
      await ContactIdentity.updateOne(
        { _id: existing._id, entityType: "provider_join_request", entityId: allowedProviderJoinRequestId },
        {
          $set: {
            kind: entry.kind,
            value: entry.value,
            ...incomingOwner,
            updatedAt: new Date(),
          },
        },
        sessionOptions(session),
      );
      return;
    }

    if (canShareEmployeeLinkedContact(
      existing,
      entityType,
      entityId,
      Boolean(allowEmployeeRoleOverlap || allowEmployeeProviderOverlap),
    )) {
      await ContactIdentity.updateOne(
        { _id: existing._id },
        {
          $set: {
            kind: entry.kind,
            value: entry.value,
            sharedOwners: [...secondaries, incomingOwner],
            updatedAt: new Date(),
          },
        },
        sessionOptions(session),
      );
      return;
    }

    throw duplicateContactError(existing);
  }

  let conflictLookup = ContactIdentity.findOne({ key: entry.key });
  if (session) conflictLookup = conflictLookup.session(session);
  const conflict = await conflictLookup.lean();
  throw duplicateContactError(conflict || entry);
}

async function syncEntityContacts({
  entityType,
  entityId,
  contacts,
  allowedProviderJoinRequestId = "",
  allowEmployeeRoleOverlap = false,
  allowEmployeeProviderOverlap = false,
  session = null,
}) {
  const config = ENTITY_CONFIG[entityType];
  if (!config || !entityId) throw new Error("Contact identity owner is invalid");
  const desired = await assertContactsAvailable({
    entityType,
    entityId,
    contacts,
    allowedProviderJoinRequestId,
    allowEmployeeRoleOverlap,
    allowEmployeeProviderOverlap,
    session,
  });
  const desiredKeys = desired.map((entry) => entry.key);

  await removeStaleOwnership(entityType, entityId, desiredKeys, session);

  for (const entry of desired) {
    await writeOwnerForEntry({
      entry,
      entityType,
      entityId,
      sourceCollection: config.collection,
      allowedProviderJoinRequestId,
      allowEmployeeRoleOverlap,
      allowEmployeeProviderOverlap,
      session,
    });
  }
  return desired;
}

async function releaseEntityContacts(entityType, entityId, session = null) {
  let lookup = ContactIdentity.find({
    $or: [
      { entityType, entityId },
      { sharedOwners: { $elemMatch: { entityType, entityId } } },
    ],
  });
  if (session) lookup = lookup.session(session);
  const rows = await lookup.lean();
  for (const row of rows) {
    await removeOwnerFromRow(row, entityType, entityId, session);
  }
  return { acknowledged: true, modifiedCount: rows.length };
}

module.exports = {
  ENTITY_CONFIG,
  normalizePhone,
  normalizeEmail,
  contactEntries,
  duplicateContactError,
  findDirectConflict,
  assertContactsAvailable,
  syncEntityContacts,
  releaseEntityContacts,
};
