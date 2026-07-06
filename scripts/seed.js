require('dotenv').config();

const fs = require('fs-extra');
const path = require('path');
const { connectDb, disconnectDb } = require('../src/db/mongoose');
const {
  AuditLog,
  Category,
  Communication,
  Enquiry,
  FollowUp,
  FormTemplate,
  Invoice,
  Provider
} = require('../src/models');
const { buildSourceInfo } = require('../src/services/catalogService');

const seedDir = path.join(__dirname, '..', 'data', 'seed');

const collections = [
  { name: 'categories', model: Category },
  { name: 'templates', model: FormTemplate },
  { name: 'providers', model: Provider },
  { name: 'enquiries', model: Enquiry },
  { name: 'followUps', model: FollowUp },
  { name: 'communications', model: Communication },
  { name: 'invoices', model: Invoice },
  { name: 'auditLogs', model: AuditLog }
];

async function main() {
  await connectDb();

  for (const { model } of collections.slice().reverse()) {
    await model.deleteMany({});
  }

  // Sync indexes after clearing data so older local test databases can drop legacy indexes
  // such as a global unique category slug. The new design allows the same slug per website.
  for (const { model } of collections) {
    await model.syncIndexes().catch((error) => {
      console.warn(`Index sync skipped for ${model.modelName}: ${error.message}`);
    });
  }

  for (const { name, model } of collections) {
    const records = await readSeed(name);
    if (!records.length) continue;
    await model.insertMany(records.map((record) => normaliseSeedRecord(name, record)), { ordered: false });
    console.log(`Seeded ${records.length} ${name}`);
  }

  console.log(`MongoDB seed complete for database: ${require('mongoose').connection.name}`);
}

async function readSeed(name) {
  const file = path.join(seedDir, `${name}.json`);
  if (!(await fs.pathExists(file))) return [];
  return fs.readJson(file);
}

function normaliseSeedRecord(name, record) {
  if (name === 'enquiries') {
    const source = record.source || buildSourceInfo(record);
    return { ...record, sourceWebsite: source.website || record.sourceWebsite, source };
  }
  if (name === 'categories') {
    return { ...record, sourceWebsite: record.sourceWebsite || 'any', formType: record.formType || 'default' };
  }
  if (name === 'templates') {
    const source = record.source || buildSourceInfo(record);
    return {
      ...record,
      sourceWebsite: source.website || record.sourceWebsite || 'any',
      formType: record.formType || 'default',
      source
    };
  }
  return record;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
