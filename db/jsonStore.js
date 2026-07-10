const path = require('path');
const fs = require('fs-extra');

const runtimeDir = path.join(__dirname, '..', '..', 'data', 'runtime');
const seedDir = path.join(__dirname, '..', '..', 'data', 'seed');

const collections = [
  'categories',
  'templates',
  'providers',
  'enquiries',
  'followUps',
  'invoices',
  'communications',
  'auditLogs'
];

async function ensureRuntimeData() {
  await fs.ensureDir(runtimeDir);
  for (const collection of collections) {
    const target = path.join(runtimeDir, `${collection}.json`);
    const source = path.join(seedDir, `${collection}.json`);
    if (!(await fs.pathExists(target))) {
      if (await fs.pathExists(source)) {
        await fs.copy(source, target);
      } else {
        await fs.writeJson(target, [], { spaces: 2 });
      }
    }
  }
}

function fileFor(collection) {
  if (!collections.includes(collection)) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  return path.join(runtimeDir, `${collection}.json`);
}

async function read(collection) {
  await ensureRuntimeData();
  return fs.readJson(fileFor(collection));
}

async function write(collection, data) {
  await ensureRuntimeData();
  await fs.writeJson(fileFor(collection), data, { spaces: 2 });
  return data;
}

async function update(collection, updater) {
  const current = await read(collection);
  const next = await updater(current);
  await write(collection, next);
  return next;
}

module.exports = {
  ensureRuntimeData,
  read,
  write,
  update,
  runtimeDir,
  collections
};
