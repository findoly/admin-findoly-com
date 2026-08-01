#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Invoice = require("../models/Invoice");
const { parseIndiaDateOnly } = require("../utils/india-datetime");

function parseDateOnly(value) {
  return parseIndiaDateOnly(value);
}

async function run({ dryRun = process.argv.includes("--dry-run"), batchSize = 500 } = {}) {
  await connectDatabase();
  const cursor = Invoice.collection.find(
    { $or: [{ issueDate: { $type: "string" } }, { dueDate: { $type: "string" } }] },
    { projection: { _id: 1, invoiceId: 1, issueDate: 1, dueDate: 1 }, batchSize },
  );
  let scanned = 0;
  let converted = 0;
  const invalid = [];
  let operations = [];

  async function flush() {
    if (!operations.length || dryRun) {
      operations = [];
      return;
    }
    await Invoice.collection.bulkWrite(operations, { ordered: false });
    operations = [];
  }

  for await (const row of cursor) {
    scanned += 1;
    const issueRaw = typeof row.issueDate === "string" ? row.issueDate.trim() : "";
    const dueRaw = typeof row.dueDate === "string" ? row.dueDate.trim() : "";
    const issueDate = typeof row.issueDate === "string" ? parseDateOnly(issueRaw) : row.issueDate;
    const dueDate = typeof row.dueDate === "string" ? parseDateOnly(dueRaw) : row.dueDate;
    if ((issueRaw && !issueDate) || (dueRaw && !dueDate)) {
      invalid.push({ invoiceId: row.invoiceId || "", issueDate: issueRaw, dueDate: dueRaw });
      continue;
    }
    converted += 1;
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { issueDate: issueDate || null, dueDate: dueDate || null, updatedAt: new Date() } },
      },
    });
    if (operations.length >= batchSize) await flush();
  }
  await flush();

  console.log(`${dryRun ? "Would convert" : "Converted"} ${converted} of ${scanned} invoice date records.`);
  if (invalid.length) {
    console.error(`Found ${invalid.length} invalid invoice date records; they were not changed.`);
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

module.exports = { parseDateOnly, run };
