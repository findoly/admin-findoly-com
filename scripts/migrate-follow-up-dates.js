#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const FollowUp = require("../models/FollowUp");
const { parseIndiaDateTime } = require("../utils/india-datetime");

function parsedDate(value) {
  return parseIndiaDateTime(value);
}

async function run({ dryRun = process.argv.includes("--dry-run"), batchSize = 500 } = {}) {
  await connectDatabase();
  const cursor = FollowUp.collection.find({ dueAt: { $type: "string" } }, {
    projection: { _id: 1, followUpId: 1, dueAt: 1 },
    batchSize,
  });
  let scanned = 0;
  let converted = 0;
  const invalid = [];
  let operations = [];

  async function flush() {
    if (!operations.length || dryRun) {
      operations = [];
      return;
    }
    await FollowUp.collection.bulkWrite(operations, { ordered: false });
    operations = [];
  }

  for await (const row of cursor) {
    scanned += 1;
    const raw = String(row.dueAt || "").trim();
    const value = parsedDate(raw);
    if (raw && !value) {
      invalid.push({ followUpId: row.followUpId || "", dueAt: raw.slice(0, 100) });
      continue;
    }
    converted += 1;
    operations.push({
      updateOne: {
        filter: { _id: row._id, dueAt: row.dueAt },
        update: { $set: { dueAt: value, updatedAt: new Date() } },
      },
    });
    if (operations.length >= batchSize) await flush();
  }
  await flush();

  console.log(`${dryRun ? "Would convert" : "Converted"} ${converted} of ${scanned} string follow-up dates.`);
  if (invalid.length) {
    console.error(`Found ${invalid.length} invalid follow-up dates; they were not changed.`);
    console.error(JSON.stringify(invalid.slice(0, 50), null, 2));
    process.exitCode = 2;
  }
  return { scanned, converted, invalid, dryRun };
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = { parsedDate, run };
