#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Enquiry = require("../models/Enquiry");
const { normalizeSearchText } = require("../utils/normalization");

const BATCH_SIZE = Math.min(1000, Math.max(50, Number(process.env.MIGRATION_BATCH_SIZE || 500)));
const MARKETPLACE_TTL_DAYS = Math.max(1, Number(process.env.MARKETPLACE_LEAD_TTL_DAYS || 180));

function addDays(value, days) {
  const date = new Date(value || Date.now());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function normalizeLead(row) {
  const approved = String(row.status || "") === "approved" && row.isActive !== false;
  const maxProviderUnlocks = Math.max(1, Number(row.maxProviderUnlocks || 5));
  const unlockedCount = Math.max(0, Number(row.unlockedCount || 0));
  const reservedUnlockCount = Math.max(0, Number(row.reservedUnlockCount || 0));
  const remainingUnlocks = Math.max(0, maxProviderUnlocks - unlockedCount - reservedUnlockCount);
  const publishedAt = row.marketplacePublishedAt || (approved ? row.updatedAt || row.createdAt || new Date() : null);
  const marketplaceAvailable = approved && remainingUnlocks > 0;
  return {
    nameKey: normalizeSearchText(row.name),
    cityKey: normalizeSearchText(row.city),
    requirementTitleKey: normalizeSearchText(row.requirementTitle),
    maxProviderUnlocks,
    unlockedCount,
    reservedUnlockCount,
    remainingUnlocks,
    marketplaceStatus: marketplaceAvailable ? "published" : approved ? "closed" : "draft",
    marketplaceAvailable,
    marketplaceClosureReason: approved && !marketplaceAvailable ? "unlock_limit" : "",
    marketplacePublishedAt: publishedAt,
    marketplaceExpiresAt: publishedAt ? row.marketplaceExpiresAt || addDays(publishedAt, MARKETPLACE_TTL_DAYS) : null,
  };
}

async function dropLegacyDistributionCollection() {
  try {
    await mongoose.connection.db.dropCollection("leaddistributions");
    console.log("Removed legacy leaddistributions collection");
    return true;
  } catch (error) {
    if (error?.codeName === "NamespaceNotFound" || error?.code === 26) return false;
    throw error;
  }
}

async function run() {
  await connectDatabase();
  const cursor = Enquiry.find({}).select({
    _id: 1,
    status: 1,
    isActive: 1,
    name: 1,
    city: 1,
    requirementTitle: 1,
    maxProviderUnlocks: 1,
    unlockedCount: 1,
    reservedUnlockCount: 1,
    marketplacePublishedAt: 1,
    marketplaceExpiresAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }).lean().cursor();

  let operations = [];
  let processed = 0;
  for await (const row of cursor) {
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: normalizeLead(row),
          $unset: {
            leadIntent: "",
            pendingUnlockCount: "",
            distributedAt: "",
            distributedBy: "",
          },
        },
      },
    });
    if (operations.length >= BATCH_SIZE) {
      await Enquiry.bulkWrite(operations, { ordered: false });
      processed += operations.length;
      operations = [];
      console.log(`Normalized ${processed} enquiries`);
    }
  }
  if (operations.length) {
    await Enquiry.bulkWrite(operations, { ordered: false });
    processed += operations.length;
  }
  const legacyCollectionRemoved = await dropLegacyDistributionCollection();
  const result = { processed, legacyCollectionRemoved };
  console.log(`Structure migration completed: ${JSON.stringify(result)}`);
  return result;
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
  BATCH_SIZE,
  MARKETPLACE_TTL_DAYS,
  addDays,
  normalizeLead,
  dropLegacyDistributionCollection,
  run,
};
