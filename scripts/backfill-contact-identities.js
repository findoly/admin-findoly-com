#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Agent = require("../models/Agent");
const Employee = require("../models/Employee");
const Provider = require("../models/Provider");
const ProviderJoinRequest = require("../models/ProviderJoinRequest");
const ContactIdentity = require("../models/ContactIdentity");
const SystemMigration = require("../models/SystemMigration");
const { contactEntries, normalizeEmail, normalizePhone } = require("../utils/contact-normalization");

const MIGRATION_ID = "contact-identities-v1";
const MIGRATION_VERSION = 2;
const STAGING_COLLECTION = "contactidentities_migration_v2";
const CONTACT_COLLECTION = "contactidentities";
const REPORT_SAMPLE_LIMIT = 100;
const EMPLOYEE_LINKED_TYPES = new Set(["agent", "provider", "employee", "provider_join_request"]);

const SOURCES = Object.freeze([
  {
    entityType: "agent",
    model: Agent,
    idField: "agentId",
    projection: { agentId: 1, mobile: 1, normalizedMobile: 1, email: 1, normalizedEmail: 1 },
    collection: "agents",
  },
  {
    entityType: "employee",
    model: Employee,
    idField: "employeeId",
    projection: { employeeId: 1, mobile: 1, normalizedMobile: 1, email: 1, normalizedEmail: 1 },
    collection: "crmemployees",
  },
  {
    entityType: "provider",
    model: Provider,
    idField: "providerId",
    projection: { providerId: 1, mobile: 1, normalizedMobile: 1, whatsappNumber: 1, normalizedWhatsappNumber: 1, email: 1, normalizedEmail: 1 },
    collection: "providers",
  },
  {
    entityType: "provider_join_request",
    model: ProviderJoinRequest,
    idField: "providerJoinRequestId",
    projection: { providerJoinRequestId: 1, mobile: 1, normalizedMobile: 1, whatsappNumber: 1, normalizedWhatsappNumber: 1, email: 1, normalizedEmail: 1, status: 1, convertedProviderId: 1 },
    collection: "providerjoinrequests",
  },
]);

function normalizationUpdate(entityType, row) {
  const update = {};
  const normalizedMobile = normalizePhone(row.mobile || row.normalizedMobile);
  const normalizedEmail = normalizeEmail(row.email || row.normalizedEmail);
  if (normalizedMobile && row.normalizedMobile !== normalizedMobile) update.normalizedMobile = normalizedMobile;
  if (normalizedEmail !== String(row.normalizedEmail || "")) update.normalizedEmail = normalizedEmail;
  if (entityType === "provider" || entityType === "provider_join_request") {
    const normalizedWhatsappNumber = normalizePhone(row.whatsappNumber || row.normalizedWhatsappNumber || row.mobile);
    if (normalizedWhatsappNumber && row.normalizedWhatsappNumber !== normalizedWhatsappNumber) {
      update.normalizedWhatsappNumber = normalizedWhatsappNumber;
    }
    if (entityType === "provider" && !row.whatsappNumber && normalizedWhatsappNumber) {
      update.whatsappNumber = normalizedWhatsappNumber;
    }
  }
  return update;
}

function rawValidationIssues(entityType, entityId, row) {
  const issues = [];
  const mobileRaw = String(row.mobile || row.normalizedMobile || "").trim();
  const emailRaw = String(row.email || row.normalizedEmail || "").trim();
  const whatsappRaw = String(row.whatsappNumber || row.normalizedWhatsappNumber || "").trim();
  if (mobileRaw && !normalizePhone(mobileRaw)) issues.push({ entityType, entityId, field: "mobile" });
  if (emailRaw && !normalizeEmail(emailRaw)) issues.push({ entityType, entityId, field: "email" });
  if (whatsappRaw && !normalizePhone(whatsappRaw)) issues.push({ entityType, entityId, field: "whatsapp" });
  return issues;
}

function normalizedContacts(row) {
  return {
    mobile: normalizePhone(row.mobile || row.normalizedMobile),
    whatsappNumber: normalizePhone(row.whatsappNumber || row.normalizedWhatsappNumber || row.mobile),
    email: normalizeEmail(row.email || row.normalizedEmail),
  };
}

function addSamples(report, items) {
  report.count += items.length;
  const remaining = Math.max(0, REPORT_SAMPLE_LIMIT - report.samples.length);
  if (remaining) report.samples.push(...items.slice(0, remaining));
}

async function dropCollectionIfPresent(database, name) {
  try {
    await database.collection(name).drop();
  } catch (error) {
    if (![26, "NamespaceNotFound"].includes(error?.code) && error?.codeName !== "NamespaceNotFound") {
      throw error;
    }
  }
}

async function prepareStaging(database) {
  await dropCollectionIfPresent(database, STAGING_COLLECTION);
  const staging = database.collection(STAGING_COLLECTION);
  await staging.createIndexes([
    { key: { key: 1 }, name: "key_1", unique: true },
    { key: { kind: 1 }, name: "kind_1" },
    { key: { entityType: 1 }, name: "entityType_1" },
    { key: { entityId: 1 }, name: "entityId_1" },
    { key: { entityType: 1, entityId: 1, createdAt: 1 }, name: "entityType_1_entityId_1_createdAt_1" },
    { key: { kind: 1, value: 1 }, name: "kind_1_value_1" },
  ]);
  return staging;
}

function writeErrors(error) {
  return error?.writeErrors || error?.result?.result?.writeErrors || [];
}

function identityOwners(document = {}) {
  const primary = {
    entityType: document.entityType || "",
    entityId: String(document.entityId || ""),
    field: document.field || "",
    sourceCollection: document.sourceCollection || "",
  };
  const shared = Array.isArray(document.sharedOwners) ? document.sharedOwners : [];
  return [primary, ...shared].filter((owner) => owner.entityType && owner.entityId);
}

function canMergeEmployeeLinkedOwner(existing, incoming) {
  if (!EMPLOYEE_LINKED_TYPES.has(incoming?.entityType)) return false;
  const owners = identityOwners(existing);
  if (!owners.length || owners.some((owner) => !EMPLOYEE_LINKED_TYPES.has(owner.entityType))) return false;
  if (owners.some((owner) => owner.entityType === incoming.entityType && String(owner.entityId) !== String(incoming.entityId))) {
    return false;
  }
  const employeeLinked = incoming.entityType === "employee"
    || owners.some((owner) => owner.entityType === "employee");
  return employeeLinked && !owners.some((owner) => (
    owner.entityType === incoming.entityType
    && String(owner.entityId) === String(incoming.entityId)
  ));
}

// Backward-compatible export for older migration tests and tooling.
const canMergeEmployeeProviderOwner = canMergeEmployeeLinkedOwner;

async function insertIdentityBatch(staging, documents, conflicts) {
  if (!documents.length) return;
  try {
    await staging.insertMany(documents, { ordered: false });
  } catch (error) {
    const failures = writeErrors(error);
    if (!failures.length || failures.some((failure) => Number(failure?.code) !== 11000)) throw error;
    const orderedFailures = [...failures].sort((left, right) => {
      const leftDocument = documents[Number(left.index)];
      const rightDocument = documents[Number(right.index)];
      return Number(rightDocument?.entityType === "employee") - Number(leftDocument?.entityType === "employee");
    });
    for (const failure of orderedFailures) {
      const document = documents[Number(failure.index)];
      if (!document) continue;
      const existing = await staging.findOne(
        { key: document.key },
        { projection: { _id: 0, key: 1, entityType: 1, entityId: 1, field: 1, sourceCollection: 1, sharedOwners: 1 } },
      );
      if (
        existing
        && identityOwners(existing).some((owner) => (
          owner.entityType === document.entityType
          && String(owner.entityId) === String(document.entityId)
        ))
      ) continue;
      if (existing && canMergeEmployeeLinkedOwner(existing, document)) {
        await staging.updateOne(
          { key: document.key },
          {
            $addToSet: {
              sharedOwners: {
                entityType: document.entityType,
                entityId: String(document.entityId),
                field: document.field,
                sourceCollection: document.sourceCollection,
              },
            },
            $set: { updatedAt: new Date() },
          },
        );
        continue;
      }
      addSamples(conflicts, [{
        key: document.key,
        owners: [
          existing || { entityType: "unknown", entityId: "", sourceCollection: "" },
          {
            entityType: document.entityType,
            entityId: document.entityId,
            field: document.field,
            sourceCollection: document.sourceCollection,
          },
        ],
      }]);
    }
  }
}

async function stageContactIdentities(database, { batchSize = 1000 } = {}) {
  const staging = await prepareStaging(database);
  const invalid = { count: 0, samples: [] };
  const conflicts = { count: 0, samples: [] };
  const sourceCounts = {};
  let normalizationChanges = 0;
  let scanned = 0;
  let batch = [];
  const now = new Date();

  async function flush() {
    const pending = batch;
    batch = [];
    await insertIdentityBatch(staging, pending, conflicts);
  }

  for (const source of SOURCES) {
    sourceCounts[source.entityType] = 0;
    const cursor = source.model.collection.find({}, { projection: source.projection, batchSize: 500 });
    for await (const row of cursor) {
      scanned += 1;
      sourceCounts[source.entityType] += 1;
      const entityId = String(row[source.idField] || "");
      if (!entityId) {
        addSamples(invalid, [{ entityType: source.entityType, entityId: "", field: source.idField }]);
        continue;
      }
      addSamples(invalid, rawValidationIssues(source.entityType, entityId, row));
      if (Object.keys(normalizationUpdate(source.entityType, row)).length) normalizationChanges += 1;

      // Once a request is converted, the provider owns its contact identities.
      if (source.entityType === "provider_join_request" && row.status === "converted" && row.convertedProviderId) {
        continue;
      }
      for (const contact of contactEntries(normalizedContacts(row))) {
        batch.push({
          ...contact,
          entityType: source.entityType,
          entityId,
          sourceCollection: source.collection,
          sharedOwners: [],
          createdAt: now,
          updatedAt: now,
        });
        if (batch.length >= batchSize) await flush();
      }
    }
  }
  await flush();
  const identityCount = await staging.countDocuments({});
  return {
    staging,
    scanned,
    identityCount,
    normalizationChanges,
    sourceCounts,
    invalid,
    conflicts,
  };
}

async function applyNormalizationChanges({ batchSize = 500 } = {}) {
  let changed = 0;
  for (const source of SOURCES) {
    let operations = [];
    async function flush() {
      if (!operations.length) return;
      const result = await source.model.collection.bulkWrite(operations, { ordered: false });
      changed += Number(result.modifiedCount || 0);
      operations = [];
    }
    const cursor = source.model.collection.find({}, { projection: { _id: 1, ...source.projection }, batchSize });
    for await (const row of cursor) {
      const update = normalizationUpdate(source.entityType, row);
      if (!Object.keys(update).length) continue;
      operations.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { ...update, updatedAt: new Date() } },
        },
      });
      if (operations.length >= batchSize) await flush();
    }
    await flush();
  }
  return changed;
}

async function uniqueContactKeyIndexPresent() {
  try {
    const indexes = await ContactIdentity.collection.indexes();
    return indexes.some((index) => (
      index.unique === true
      && JSON.stringify(index.key || {}) === JSON.stringify({ key: 1 })
    ));
  } catch (_error) {
    return false;
  }
}

async function assertContactIdentityReady() {
  const [marker, uniqueKeyIndex] = await Promise.all([
    SystemMigration.findOne({
      migrationId: MIGRATION_ID,
      version: MIGRATION_VERSION,
      status: "completed",
    }).lean(),
    uniqueContactKeyIndexPresent(),
  ]);
  if (marker && uniqueKeyIndex) return marker;
  const error = new Error(
    "Contact identities are not ready. Run npm run migrate:contact-identities in a maintenance window before ensuring indexes.",
  );
  error.code = "CONTACT_IDENTITY_MIGRATION_REQUIRED";
  error.report = { migrationMarkerPresent: Boolean(marker), uniqueKeyIndexPresent: uniqueKeyIndex };
  throw error;
}

async function run({ dryRun = process.argv.includes("--dry-run"), batchSize = 1000 } = {}) {
  await connectDatabase();
  const database = mongoose.connection.db;
  let stagingRenamed = false;
  try {
    const plan = await stageContactIdentities(database, { batchSize });
    if (plan.invalid.count || plan.conflicts.count) {
      console.error("Contact identity migration found conflicts or invalid contact values. No business records were changed.");
      console.error(JSON.stringify({
        invalidCount: plan.invalid.count,
        invalid: plan.invalid.samples,
        duplicateCount: plan.conflicts.count,
        duplicates: plan.conflicts.samples,
      }, null, 2));
      process.exitCode = 2;
      return { ...plan, dryRun };
    }

    if (dryRun) {
      console.log(`Would normalize ${plan.normalizationChanges} records and would register ${plan.identityCount} contact identities from ${plan.scanned} records.`);
      return { ...plan, dryRun };
    }

    // Swapping the derived registry is atomic at collection level. Run this
    // migration in a maintenance window so account writes cannot race it.
    await plan.staging.rename(CONTACT_COLLECTION, { dropTarget: true });
    stagingRenamed = true;
    const normalized = await applyNormalizationChanges({ batchSize: Math.min(batchSize, 1000) });
    const completedAt = new Date();
    await SystemMigration.updateOne(
      { migrationId: MIGRATION_ID },
      {
        $set: {
          version: MIGRATION_VERSION,
          status: "completed",
          completedAt,
          details: {
            scanned: plan.scanned,
            identityCount: plan.identityCount,
            normalized,
            sourceCounts: plan.sourceCounts,
          },
        },
      },
      { upsert: true },
    );
    console.log(`Normalized ${normalized} records and registered ${plan.identityCount} contact identities from ${plan.scanned} records.`);
    return { ...plan, normalized, dryRun };
  } finally {
    if (!stagingRenamed) await dropCollectionIfPresent(database, STAGING_COLLECTION).catch(() => {});
  }
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      if (error.report) console.error(JSON.stringify(error.report, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = {
  MIGRATION_ID,
  MIGRATION_VERSION,
  STAGING_COLLECTION,
  SOURCES,
  normalizationUpdate,
  rawValidationIssues,
  normalizedContacts,
  identityOwners,
  canMergeEmployeeLinkedOwner,
  canMergeEmployeeProviderOwner,
  stageContactIdentities,
  applyNormalizationChanges,
  uniqueContactKeyIndexPresent,
  assertContactIdentityReady,
  run,
};
