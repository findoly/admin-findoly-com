#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Enquiry = require("../models/Enquiry");
const { normalizeSearchText } = require("../utils/normalization");

const BATCH_SIZE = Math.min(500, Math.max(25, Number(process.env.LOCATION_BACKFILL_BATCH_SIZE || 200)));

async function run() {
  await connectDatabase();
  const cursor = Enquiry.find({}).select({ _id: 1, name: 1, city: 1, requirementTitle: 1 }).lean().cursor();
  let operations = [];
  let processed = 0;
  for await (const row of cursor) {
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: {
          nameKey: normalizeSearchText(row.name),
          cityKey: normalizeSearchText(row.city),
          requirementTitleKey: normalizeSearchText(row.requirementTitle),
        } },
      },
    });
    if (operations.length >= BATCH_SIZE) {
      await Enquiry.bulkWrite(operations, { ordered: false });
      processed += operations.length;
      operations = [];
    }
  }
  if (operations.length) {
    await Enquiry.bulkWrite(operations, { ordered: false });
    processed += operations.length;
  }
  console.log(`Marketplace search/location keys updated for ${processed} enquiries`);
}

run()
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => mongoose.disconnect().catch(() => {}));
