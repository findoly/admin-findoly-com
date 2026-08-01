#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Provider = require("../models/Provider");
const { providerDuplicateReport } = require("./ensure-indexes");
const { normalizePhone, normalizeEmail: normalizeContactEmail } = require("../utils/contact-normalization");

function normalizeMobile(value) {
  return normalizePhone(value);
}

function normalizeEmail(value) {
  return normalizeContactEmail(value);
}

function sameIndexKey(left = {}, right = {}) {
  return JSON.stringify(Object.entries(left)) === JSON.stringify(Object.entries(right));
}

async function conflictingProviderContactIndexes() {
  const expectedUniqueKeys = [
    { normalizedMobile: 1 },
    { normalizedWhatsappNumber: 1 },
    { normalizedEmail: 1 },
  ];
  const indexes = await Provider.collection.indexes();
  return indexes.filter((index) => (
    index.name !== "_id_"
    && expectedUniqueKeys.some((key) => sameIndexKey(index.key, key))
    && index.unique !== true
  ));
}

async function removeConflictingProviderContactIndexes({ dryRun = false } = {}) {
  const conflicts = await conflictingProviderContactIndexes();
  if (!dryRun) {
    for (const index of conflicts) await Provider.collection.dropIndex(index.name);
  }
  return conflicts.map((index) => index.name);
}

async function run({ dryRun = process.argv.includes("--dry-run"), batchSize = 500 } = {}) {
  await connectDatabase();
  const cursor = Provider.collection.find({}, {
    projection: {
      _id: 1,
      providerId: 1,
      mobile: 1,
      normalizedMobile: 1,
      whatsappNumber: 1,
      normalizedWhatsappNumber: 1,
      email: 1,
      normalizedEmail: 1,
    },
    batchSize,
  });
  let scanned = 0;
  let changed = 0;
  const invalid = [];
  let operations = [];

  async function flush() {
    if (!operations.length || dryRun) {
      operations = [];
      return;
    }
    await Provider.collection.bulkWrite(operations, { ordered: false });
    operations = [];
  }

  for await (const row of cursor) {
    scanned += 1;
    const mobileRaw = String(row.mobile || row.normalizedMobile || "").trim();
    const whatsappRaw = String(
      row.whatsappNumber || row.normalizedWhatsappNumber || mobileRaw,
    ).trim();
    const emailRaw = String(row.email || row.normalizedEmail || "").trim();
    const normalizedMobile = normalizeMobile(mobileRaw);
    const normalizedWhatsappNumber = normalizeMobile(whatsappRaw);
    const normalizedEmail = normalizeEmail(emailRaw);
    if (mobileRaw && !normalizedMobile) {
      invalid.push({ providerId: row.providerId || "", field: "mobile" });
      continue;
    }
    if (emailRaw && !normalizedEmail) {
      invalid.push({ providerId: row.providerId || "", field: "email" });
      continue;
    }
    if (whatsappRaw && !normalizedWhatsappNumber) {
      invalid.push({ providerId: row.providerId || "", field: "whatsappNumber" });
      continue;
    }
    if (
      row.normalizedMobile === normalizedMobile
      && row.normalizedWhatsappNumber === normalizedWhatsappNumber
      && row.normalizedEmail === normalizedEmail
      && (row.whatsappNumber || "") === normalizedWhatsappNumber
    ) continue;
    changed += 1;
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            normalizedMobile,
            whatsappNumber: normalizedWhatsappNumber,
            normalizedWhatsappNumber,
            normalizedEmail,
            updatedAt: new Date(),
          },
        },
      },
    });
    if (operations.length >= batchSize) await flush();
  }
  await flush();

  const duplicates = await providerDuplicateReport();
  console.log(`${dryRun ? "Would update" : "Updated"} ${changed} of ${scanned} provider contact records.`);
  const hasBlockingIssues = (
    invalid.length
    || duplicates.mobileDuplicates.length
    || duplicates.whatsappDuplicates.length
    || duplicates.emailDuplicates.length
  );
  let removedIndexes = [];
  if (hasBlockingIssues) {
    console.error("Provider contact preflight found records that require manual resolution.");
    console.error(JSON.stringify({ invalid: invalid.slice(0, 50), ...duplicates }, null, 2));
    process.exitCode = 2;
  } else {
    removedIndexes = await removeConflictingProviderContactIndexes({ dryRun });
    if (removedIndexes.length) {
      console.log(`${dryRun ? "Would remove" : "Removed"} conflicting non-unique provider contact indexes: ${removedIndexes.join(", ")}`);
    }
  }
  return { scanned, changed, invalid, duplicates, removedIndexes, dryRun };
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = {
  normalizeMobile,
  normalizeEmail,
  sameIndexKey,
  conflictingProviderContactIndexes,
  removeConflictingProviderContactIndexes,
  run,
};
