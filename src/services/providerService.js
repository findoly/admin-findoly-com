const { Provider } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const audit = require('./auditService');

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
  return Provider.findOne({ id }).lean();
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
  const updated = await Provider.findOneAndUpdate(
    { id },
    { $set: normaliseProvider({ ...input, id, updatedAt: nowIso() }, true) },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  await audit.log('updated', 'provider', id, { name: updated.name }, actor);
  return updated;
}

async function recommendProviders(enquiry) {
  const providers = await listProviders({ status: 'active' });
  const city = enquiry.address?.city?.toLowerCase();
  return providers
    .map((provider) => {
      let score = 0;
      if (provider.categorySlugs?.includes(enquiry.categorySlug)) score += 50;
      if (city && provider.serviceAreas?.map((a) => a.toLowerCase()).includes(city)) score += 25;
      if (provider.city?.toLowerCase() === city) score += 15;
      score += Number(provider.rating || 0) * 2;
      if (provider.availability === 'available_today') score += 10;
      return { ...provider, matchScore: score };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

function normaliseProvider(input, partial = false) {
  const record = {
    id: input.id,
    name: input.name,
    businessName: input.businessName || '',
    mobile: input.mobile || '',
    email: input.email || '',
    status: input.status || 'active',
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
  recommendProviders,
  normaliseProvider,
  listFrom
};
