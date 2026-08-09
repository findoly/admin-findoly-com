"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");

const COLLECTION = "communication_rules";
const LEGACY_FIELDS = Object.freeze([
  "slackEnabled",
  "slackChannelId",
  "slackChannelName",
  "slackMessage",
]);

function legacyQuery() {
  return {
    $or: LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })),
  };
}

async function legacyIndexNames(collection) {
  const indexes = await collection.indexes();
  return indexes
    .filter((index) => Object.keys(index.key || {}).some((field) => LEGACY_FIELDS.includes(field)))
    .map((index) => index.name)
    .filter(Boolean);
}

async function run({ dryRun = process.argv.includes("--dry-run") } = {}) {
  await connectDatabase();
  const collection = mongoose.connection.collection(COLLECTION);
  const query = legacyQuery();
  const [matched, indexNames] = await Promise.all([
    collection.countDocuments(query),
    legacyIndexNames(collection),
  ]);

  if (dryRun) {
    const summary = { dryRun: true, matched, modified: 0, legacyIndexes: indexNames };
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const unset = Object.fromEntries(LEGACY_FIELDS.map((field) => [field, ""]));
  const result = matched
    ? await collection.updateMany(query, {
        $unset: unset,
        $set: {
          updatedBy: "slack-removal-migration",
          updatedAt: new Date(),
        },
      })
    : { modifiedCount: 0 };

  for (const indexName of indexNames) {
    await collection.dropIndex(indexName);
  }

  const remaining = await collection.countDocuments(query);
  if (remaining) throw new Error(`${remaining} communication rules still contain legacy Slack configuration`);

  const summary = {
    dryRun: false,
    matched,
    modified: result.modifiedCount || 0,
    droppedIndexes: indexNames,
    remaining,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = { LEGACY_FIELDS, legacyQuery, legacyIndexNames, run };
