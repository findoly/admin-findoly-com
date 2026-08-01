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

async function findDirectConflict({ entityType, entityId, contacts, allowedProviderJoinRequestId = "", session = null }) {
  const entries = contactEntries(contacts);
  const phones = [...new Set(entries.filter((entry) => entry.kind === "phone").map((entry) => entry.value))];
  const emails = [...new Set(entries.filter((entry) => entry.kind === "email").map((entry) => entry.value))];
  if (!phones.length && !emails.length) return null;

  const checks = [
    {
      entityType: "agent",
      model: Agent,
      idField: "agentId",
      phoneFields: ["normalizedMobile"],
      emailFields: ["normalizedEmail"],
    },
    {
      entityType: "employee",
      model: Employee,
      idField: "employeeId",
      phoneFields: ["normalizedMobile"],
      emailFields: ["normalizedEmail"],
    },
    {
      entityType: "provider",
      model: Provider,
      idField: "providerId",
      phoneFields: ["normalizedMobile", "normalizedWhatsappNumber"],
      emailFields: ["normalizedEmail"],
    },
    {
      entityType: "provider_join_request",
      model: ProviderJoinRequest,
      idField: "providerJoinRequestId",
      phoneFields: ["normalizedMobile", "normalizedWhatsappNumber"],
      emailFields: ["normalizedEmail"],
    },
  ];

  for (const check of checks) {
    const alternatives = [];
    if (phones.length) {
      for (const field of check.phoneFields) alternatives.push({ [field]: { $in: phones } });
    }
    if (emails.length) {
      for (const field of check.emailFields) alternatives.push({ [field]: { $in: emails } });
    }
    if (!alternatives.length) continue;
    const query = { $or: alternatives };
    const excludedIds = [];
    if (check.entityType === entityType && entityId) excludedIds.push(entityId);
    if (check.entityType === "provider_join_request" && allowedProviderJoinRequestId) {
      excludedIds.push(allowedProviderJoinRequestId);
    }
    if (excludedIds.length) query[check.idField] = { $nin: excludedIds };
    if (check.entityType === "provider_join_request" && entityType === "provider" && entityId) {
      query.$nor = [{ status: "converted", convertedProviderId: entityId }];
    }
    let lookup = check.model.findOne(query).select({ [check.idField]: 1, normalizedMobile: 1, mobile: 1, normalizedWhatsappNumber: 1, whatsappNumber: 1, normalizedEmail: 1, email: 1 });
    if (session) lookup = lookup.session(session);
    const row = await lookup.lean();
    if (!row) continue;
    const rowPhones = new Set([
      normalizePhone(row.normalizedMobile || row.mobile),
      normalizePhone(row.normalizedWhatsappNumber || row.whatsappNumber),
    ].filter(Boolean));
    const kind = phones.some((phone) => rowPhones.has(phone)) ? "phone" : "email";
    return { kind, entityType: check.entityType, entityId: row[check.idField] || "" };
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
    const sameOwner = row.entityType === options.entityType
      && String(row.entityId) === String(options.entityId || "");
    const transferableRequest = row.entityType === "provider_join_request"
      && options.allowedProviderJoinRequestId
      && String(row.entityId) === String(options.allowedProviderJoinRequestId);
    return !sameOwner && !transferableRequest;
  });
  if (conflict) throw duplicateContactError(conflict);
  return desired;
}

async function syncEntityContacts({ entityType, entityId, contacts, allowedProviderJoinRequestId = "", session = null }) {
  const config = ENTITY_CONFIG[entityType];
  if (!config || !entityId) throw new Error("Contact identity owner is invalid");
  const desired = await assertContactsAvailable({
    entityType,
    entityId,
    contacts,
    allowedProviderJoinRequestId,
    session,
  });
  const desiredKeys = desired.map((entry) => entry.key);

  await ContactIdentity.deleteMany(
    {
      entityType,
      entityId,
      ...(desiredKeys.length ? { key: { $nin: desiredKeys } } : {}),
    },
    sessionOptions(session),
  );

  for (const entry of desired) {
    try {
      const ownerAlternatives = [
        { entityType, entityId },
      ];
      if (allowedProviderJoinRequestId) {
        ownerAlternatives.push({
          entityType: "provider_join_request",
          entityId: allowedProviderJoinRequestId,
        });
      }
      await ContactIdentity.updateOne(
        { key: entry.key, $or: ownerAlternatives },
        {
          $setOnInsert: { key: entry.key },
          $set: {
            kind: entry.kind,
            value: entry.value,
            entityType,
            entityId,
            field: entry.field,
            sourceCollection: config.collection,
            updatedAt: new Date(),
          },
        },
        { ...sessionOptions(session), upsert: true },
      );
    } catch (error) {
      if (error?.code === 11000) {
        let conflictLookup = ContactIdentity.findOne({ key: entry.key });
        if (session) conflictLookup = conflictLookup.session(session);
        const conflict = await conflictLookup.lean();
        throw duplicateContactError(conflict || entry);
      }
      throw error;
    }
  }
  return desired;
}

async function releaseEntityContacts(entityType, entityId, session = null) {
  return ContactIdentity.deleteMany({ entityType, entityId }, sessionOptions(session));
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
