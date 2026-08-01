#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const AgentWithdrawal = require("../models/AgentWithdrawal");

const ACTIVE_STATUSES = [
  "submitted",
  "under_review",
  "eligibility_approved",
  "finance_approved",
  "payout_processing",
  "payout_failed",
];

async function run({ dryRun = process.argv.includes("--dry-run") } = {}) {
  await connectDatabase();
  const duplicateAgents = await AgentWithdrawal.aggregate([
    { $match: { status: { $in: ACTIVE_STATUSES } } },
    { $group: { _id: "$agentId", count: { $sum: 1 }, withdrawalIds: { $push: "$withdrawalId" } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 100 },
  ]);
  if (duplicateAgents.length) {
    console.error("Multiple active withdrawals exist for one or more agents. Resolve them before continuing.");
    console.error(JSON.stringify(duplicateAgents, null, 2));
    process.exitCode = 2;
    return { duplicateAgents, updated: 0, dryRun };
  }

  const activeFilter = { status: { $in: ACTIVE_STATUSES } };
  const activeCount = await AgentWithdrawal.countDocuments(activeFilter);
  const terminalCount = await AgentWithdrawal.countDocuments({
    status: { $nin: ACTIVE_STATUSES },
    activeSlot: { $nin: ["", null] },
  });
  if (!dryRun) {
    await AgentWithdrawal.updateMany(activeFilter, [{ $set: { activeSlot: "$agentId", updatedAt: new Date() } }]);
    await AgentWithdrawal.updateMany(
      { status: { $nin: ACTIVE_STATUSES }, activeSlot: { $nin: ["", null] } },
      { $set: { activeSlot: "", updatedAt: new Date() } },
    );
  }
  console.log(`${dryRun ? "Would update" : "Updated"} ${activeCount} active and ${terminalCount} terminal withdrawal slots.`);
  return { duplicateAgents, updated: activeCount + terminalCount, dryRun };
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect().catch(() => {}));
}

module.exports = { ACTIVE_STATUSES, run };
