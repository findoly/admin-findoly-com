const { Provider } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const { addDateRange } = require('../utils/queryFilters');
const audit = require('./auditService');
const { findOneByPublicId, updateOneByPublicId } = require('../repositories/publicIdRepository');

async function listProviders(filters = {}) {
  return Provider.find(buildProviderListQuery(filters)).sort({ name: 1 }).lean();
}

async function paginateProviders(filters = {}) {
  return paginateModel(Provider, buildProviderListQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { name: 1 }
  });
}

function buildProviderListQuery(filters = {}) {
  const query = {};
  if (filters.categorySlug) query.categorySlugs = filters.categorySlug;
  if (filters.status) query.status = filters.status;
  if (filters.city) query.city = new RegExp(escapeRegExp(filters.city), 'i');
  addDateRange(query, 'createdAt', filters);
  if (filters.search || filters.q) {
    const regex = new RegExp(escapeRegExp(filters.search || filters.q), 'i');
    query.$or = [
      { name: regex },
      { businessName: regex },
      { mobile: regex },
      { email: regex },
      { city: regex },
      { state: regex },
      { serviceAreas: regex },
      { categorySlugs: regex },
      { skills: regex }
    ];
  }
  return query;
}

async function getProvider(id) {
  return findOneByPublicId(Provider, id);
}

async function createProvider(input, actor = 'admin') {
  const provider = await Provider.create(normaliseProvider({
    ...input,
    id: createId('provider'),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  await audit.log('created', 'provider', provider.id, { name: provider.name }, actor);
  return provider.toObject();
}

async function updateProvider(id, input, actor = 'admin') {
  const updated = await updateOneByPublicId(
    Provider,
    id,
    { $set: normaliseProvider({ ...input, id, updatedAt: nowIso() }, true) }
  );
  if (!updated) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  await audit.log('updated', 'provider', id, { name: updated.name }, actor);
  return updated;
}

function normaliseProvider(input, partial = false) {
  const record = {
    id: input.id,
    name: input.name,
    businessName: input.businessName || '',
    mobile: input.mobile || '',
    email: input.email || '',
    status: input.status || 'active',
    onboardingStage: input.onboardingStage || 'new',
    categorySlugs: listFrom(input.categorySlugs || input.categorySlug),
    skills: listFrom(input.skills),
    city: input.city || '',
    state: input.state || '',
    serviceAreas: listFrom(input.serviceAreas || input.serviceArea),
    availability: input.availability || 'available_today',
    rating: Number(input.rating || 0),
    notes: input.notes || '',
    documentsVerified: input.documentsVerified === true || input.documentsVerified === 'true',
    updatedAt: input.updatedAt || nowIso()
  };
  if (!partial) record.createdAt = input.createdAt || nowIso();
  Object.keys(record).forEach((key) => {
    if (partial && input[key] === undefined && !['updatedAt'].includes(key)) delete record[key];
  });
  return record;
}

function listFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listProviders,
  paginateProviders,
  getProvider,
  createProvider,
  updateProvider,
  normaliseProvider,
  listFrom
};
