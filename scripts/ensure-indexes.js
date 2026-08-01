#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");

const MODELS = Object.freeze([
  require("../models/Agent"),
  require("../models/AgentWithdrawal"),
  require("../models/Category"),
  require("../models/Communication"),
  require("../models/CommunicationRule"),
  require("../models/CommunicationTemplate"),
  require("../models/ContactIdentity"),
  require("../models/CreditAllocation"),
  require("../models/CrmOtpRateLimit"),
  require("../models/CrmOtpIpRateLimit"),
  require("../models/Employee"),
  require("../models/Enquiry"),
  require("../models/FollowUp"),
  require("../models/FormTemplate"),
  require("../models/Invoice"),
  require("../models/OtpRequest"),
  require("../models/PaymentOrder"),
  require("../models/PincodeLocation"),
  require("../models/Provider"),
  require("../models/ProviderJoinRequest"),
  require("../models/ProviderLeadUnlock"),
  require("../models/ProviderSubscription"),
  require("../models/Role"),
  require("../models/ServiceType"),
  require("../models/SystemMigration"),
  require("../models/WalletTransaction"),
]);

function indexedModels() {
  return [...MODELS];
}

function stableKey(value = {}) {
  return JSON.stringify(Object.entries(value));
}

function expectedIndexSignatures(model) {
  return model.schema.indexes().map(([key, options = {}]) => ({
    key,
    keySignature: stableKey(key),
    unique: Boolean(options.unique),
    sparse: Boolean(options.sparse),
    expireAfterSeconds: options.expireAfterSeconds,
    partialFilterExpression: options.partialFilterExpression,
    name: options.name || "",
  }));
}

function actualIndexSignatures(indexes = []) {
  return indexes.map((index = {}) => ({
    key: index.key || {},
    keySignature: stableKey(index.key || {}),
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
    name: index.name || "",
  }));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value ?? null;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function verifyDeclaredIndexes(model, actualIndexes) {
  const expected = expectedIndexSignatures(model);
  const actual = actualIndexSignatures(actualIndexes);
  const missing = expected.filter((definition) => !actual.some((candidate) => (
    candidate.keySignature === definition.keySignature
      && candidate.unique === definition.unique
      && candidate.sparse === definition.sparse
      && candidate.expireAfterSeconds === definition.expireAfterSeconds
      && sameJson(candidate.partialFilterExpression, definition.partialFilterExpression)
  )));
  if (missing.length) {
    const details = missing.map((index) => index.name || index.keySignature).join(", ");
    const error = new Error(`Missing declared indexes for ${model.collection.collectionName}: ${details}`);
    error.code = "INDEX_VERIFICATION_FAILED";
    throw error;
  }
  return { expected: expected.length, actual: actual.length };
}

async function providerDuplicateReport() {
  const Provider = require("../models/Provider");
  const [mobileDuplicates, whatsappDuplicates, emailDuplicates] = await Promise.all([
    Provider.aggregate([
      { $match: { normalizedMobile: { $type: "string", $gt: "" } } },
      { $group: { _id: "$normalizedMobile", count: { $sum: 1 }, providerIds: { $push: "$providerId" } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]),
    Provider.aggregate([
      { $match: { normalizedWhatsappNumber: { $type: "string", $gt: "" } } },
      { $group: { _id: "$normalizedWhatsappNumber", count: { $sum: 1 }, providerIds: { $push: "$providerId" } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]),
    Provider.aggregate([
      { $match: { normalizedEmail: { $type: "string", $gt: "" } } },
      { $group: { _id: "$normalizedEmail", count: { $sum: 1 }, providerIds: { $push: "$providerId" } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]),
  ]);
  return { mobileDuplicates, whatsappDuplicates, emailDuplicates };
}

async function assertProviderContactsCanBeIndexed() {
  const report = await providerDuplicateReport();
  if (
    !report.mobileDuplicates.length
    && !report.whatsappDuplicates.length
    && !report.emailDuplicates.length
  ) return report;
  const error = new Error(
    "Provider contact duplicates must be resolved before unique indexes can be created. Run npm run migrate:contact-identities -- --dry-run for details.",
  );
  error.code = "PROVIDER_CONTACT_DUPLICATES";
  error.report = report;
  throw error;
}

async function assertWithdrawalSlotsReady() {
  const AgentWithdrawal = require("../models/AgentWithdrawal");
  const activeStatuses = [
    "submitted",
    "under_review",
    "eligibility_approved",
    "finance_approved",
    "payout_processing",
    "payout_failed",
  ];
  const [duplicateAgents, missingSlots] = await Promise.all([
    AgentWithdrawal.aggregate([
      { $match: { status: { $in: activeStatuses } } },
      { $group: { _id: "$agentId", count: { $sum: 1 }, withdrawalIds: { $push: "$withdrawalId" } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ]),
    AgentWithdrawal.countDocuments({
      status: { $in: activeStatuses },
      $expr: { $ne: ["$activeSlot", "$agentId"] },
    }),
  ]);
  if (!duplicateAgents.length && missingSlots === 0) return { duplicateAgents, missingSlots };
  const error = new Error(
    "Active withdrawal slots are not ready for the unique index. Run npm run migrate:withdrawal-slots and resolve any reported conflicts.",
  );
  error.code = "WITHDRAWAL_SLOT_MIGRATION_REQUIRED";
  error.report = { duplicateAgents, missingSlots };
  throw error;
}

async function run({ verifyOnly = process.argv.includes("--verify-only") } = {}) {
  await connectDatabase();
  const { assertContactIdentityReady } = require("./backfill-contact-identities");
  await assertContactIdentityReady();
  await assertProviderContactsCanBeIndexed();
  await assertWithdrawalSlotsReady();
  for (const model of indexedModels()) {
    if (!verifyOnly) await model.createIndexes();
    const actual = await model.collection.indexes();
    const result = verifyDeclaredIndexes(model, actual);
    console.log(
      `${verifyOnly ? "Indexes verified" : "Indexes ensured"}: ${model.collection.collectionName} (${result.expected} declared, ${result.actual} present)`,
    );
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
  indexedModels,
  expectedIndexSignatures,
  verifyDeclaredIndexes,
  canonicalJson,
  providerDuplicateReport,
  assertProviderContactsCanBeIndexed,
  assertWithdrawalSlotsReady,
  run,
};
