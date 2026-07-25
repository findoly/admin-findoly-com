#!/usr/bin/env node
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../db/connection");
const Category = require("../models/Category");
const ServiceType = require("../models/ServiceType");
const Enquiry = require("../models/Enquiry");
const LeadDistribution = require("../models/LeadDistribution");
const ProviderSubscription = require("../models/ProviderSubscription");

async function run() {
  await connectDatabase();
  const models = [Category, ServiceType, Enquiry, LeadDistribution, ProviderSubscription];
  for (const model of models) {
    await model.createIndexes();
    console.log(`Indexes ensured: ${model.collection.collectionName}`);
  }
}

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
