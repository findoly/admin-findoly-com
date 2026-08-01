#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Category = require("../models/Category");
const ServiceType = require("../models/ServiceType");
const Enquiry = require("../models/Enquiry");
const ProviderLeadUnlock = require("../models/ProviderLeadUnlock");
const ProviderSubscription = require("../models/ProviderSubscription");
const PaymentOrder = require("../models/PaymentOrder");
const WalletTransaction = require("../models/WalletTransaction");
const ProviderJoinRequest = require("../models/ProviderJoinRequest");

function indexedModels() {
  return [
    Category,
    ServiceType,
    Enquiry,
    ProviderLeadUnlock,
    ProviderSubscription,
    PaymentOrder,
    WalletTransaction,
    ProviderJoinRequest,
  ];
}

async function run() {
  await connectDatabase();
  for (const model of indexedModels()) {
    await model.createIndexes();
    console.log(`Indexes ensured: ${model.collection.collectionName}`);
  }
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
  indexedModels,
  run,
};
