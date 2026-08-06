#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Enquiry = require("../models/Enquiry");

const BATCH_SIZE = Math.min(1000, Math.max(25, Number(process.env.MARKETPLACE_EXPIRY_BATCH_SIZE || 250)));
const MAX_BATCHES = Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_EXPIRY_MAX_BATCHES || 20)));

async function expireBatch(now = new Date()) {
  const rows = await Enquiry.find({
    marketplaceAvailable: true,
    marketplaceStatus: "published",
    marketplaceExpiresAt: { $lte: now },
  })
    .select({ _id: 1 })
    .sort({ marketplaceExpiresAt: 1, _id: 1 })
    .limit(BATCH_SIZE)
    .lean();

  if (!rows.length) return { scanned: 0, expired: 0 };

  const result = await Enquiry.updateMany(
    {
      _id: { $in: rows.map((row) => row._id) },
      marketplaceAvailable: true,
      marketplaceStatus: "published",
      marketplaceExpiresAt: { $lte: now },
    },
    {
      $set: {
        marketplaceAvailable: false,
        marketplaceStatus: "expired",
        marketplaceClosureReason: "expired",
        updatedAt: now,
      },
    },
  );

  return { scanned: rows.length, expired: Number(result.modifiedCount || 0) };
}

async function main() {
  await connectDatabase();
  const summary = { scanned: 0, expired: 0, batches: 0 };

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await expireBatch(new Date());
    summary.scanned += result.scanned;
    summary.expired += result.expired;
    summary.batches += result.scanned > 0 ? 1 : 0;
    if (result.scanned < BATCH_SIZE) break;
  }

  console.log(`Marketplace expiry cleanup: ${JSON.stringify(summary)}`);
  return summary;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = {
  BATCH_SIZE,
  MAX_BATCHES,
  expireBatch,
  main,
};
