const Provider = require('../../models/Provider');
const Enquiry = require('../../models/Enquiry');
const LeadDistribution = require('../../models/LeadDistribution');
const WalletTransaction = require('../../models/WalletTransaction');
const { normalizeMobile } = require('../../utils/mobile');
const { getPagination, pageResult } = require('../../utils/pagination');
const enquiryService = require('../enquiry/enquiry-service');

function idQuery(providerId) { return { $or: [{ providerId }, { id: providerId }, { _id: providerId }] }; }

function normalize(input = {}, current = {}) {
  const categorySlugs = Array.isArray(input.categorySlugs) ? input.categorySlugs : String(input.categorySlugs ?? current.categorySlugs ?? '').split(',');
  const skills = Array.isArray(input.skills) ? input.skills : String(input.skills ?? current.skills ?? '').split(',');
  const serviceAreas = Array.isArray(input.serviceAreas) ? input.serviceAreas : String(input.serviceAreas ?? current.serviceAreas ?? '').split(',');
  const mobile = String(input.mobile ?? current.mobile ?? '').trim();
  return {
    name: String(input.name ?? current.name ?? '').trim(),
    businessName: String(input.businessName ?? current.businessName ?? '').trim(),
    mobile,
    normalizedMobile: normalizeMobile(input.normalizedMobile || mobile),
    email: String(input.email ?? current.email ?? '').trim().toLowerCase(),
    status: String(input.status ?? current.status ?? 'active'),
    onboardingStage: String(input.onboardingStage ?? current.onboardingStage ?? 'new'),
    categorySlugs: categorySlugs.map(v => String(v).trim()).filter(Boolean),
    skills: skills.map(v => String(v).trim()).filter(Boolean),
    city: String(input.city ?? current.city ?? '').trim(),
    state: String(input.state ?? current.state ?? '').trim(),
    serviceAreas: serviceAreas.map(v => String(v).trim()).filter(Boolean),
    availability: String(input.availability ?? current.availability ?? 'available_today'),
    rating: Number(input.rating ?? current.rating ?? 0),
    notes: String(input.notes ?? current.notes ?? ''),
    documentsVerified: input.documentsVerified !== undefined ? Boolean(input.documentsVerified) : Boolean(current.documentsVerified),
    portalAccessEnabled: input.portalAccessEnabled !== undefined ? Boolean(input.portalAccessEnabled) : current.portalAccessEnabled !== false,
    updatedAt: new Date()
  };
}

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlugs = filters.categorySlug;
  if (filters.city) query.city = new RegExp(String(filters.city), 'i');
  if (filters.q) {
    const q = new RegExp(String(filters.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ providerId: q }, { id: q }, { name: q }, { businessName: q }, { mobile: q }, { email: q }, { city: q }];
  }
  const [data,total] = await Promise.all([
    Provider.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Provider.countDocuments(query)
  ]);
  return pageResult(data.map(p => ({ ...p, providerId: p.providerId || p.id || String(p._id) })), total, page, limit);
}

async function get(providerId) {
  const provider = await Provider.findOne(idQuery(providerId)).lean();
  if (!provider) throw Object.assign(new Error('Provider not found'), { status: 404 });
  const id = provider.providerId || provider.id || String(provider._id);
  const [distributions, transactions] = await Promise.all([
    LeadDistribution.find({ providerId: id }).sort({ distributedAt: -1 }).limit(50).lean(),
    WalletTransaction.find({ providerId: id }).sort({ createdAt: -1 }).limit(50).lean()
  ]);
  return { ...provider, providerId: id, distributions, transactions };
}

async function create(input) {
  const data = normalize(input);
  if (!data.name) throw Object.assign(new Error('Provider name is required'), { status: 400 });
  const provider = await Provider.create(data);
  await syncApprovedLeads(provider);
  return get(provider.providerId);
}

async function update(providerId, input) {
  const current = await Provider.findOne(idQuery(providerId)).lean();
  if (!current) throw Object.assign(new Error('Provider not found'), { status: 404 });
  const data = normalize(input, current);
  await Provider.updateOne(idQuery(providerId), { $set: data });
  const provider = await Provider.findOne(idQuery(providerId));
  await syncApprovedLeads(provider);
  return get(provider.providerId);
}

async function syncApprovedLeads(providerDocument) {
  const provider = providerDocument.toObject ? providerDocument.toObject() : providerDocument;
  const providerId = provider.providerId || provider.id || String(provider._id);
  const eligible = provider.status === 'active' && provider.portalAccessEnabled !== false;
  if (!eligible) {
    await LeadDistribution.updateMany({ providerId, contactUnlocked: { $ne: true } }, { $set: { status: 'withdrawn', updatedAt: new Date() } });
    return;
  }
  const leads = await Enquiry.find({ status: { $in: ['approved', 'distributed'] }, categorySlug: { $in: provider.categorySlugs || [] } });
  for (const lead of leads) await enquiryService.distribute(lead, 'provider-sync');
  await LeadDistribution.updateMany({ providerId, categorySlug: { $nin: provider.categorySlugs || [] }, contactUnlocked: { $ne: true } }, { $set: { status: 'withdrawn', updatedAt: new Date() } });
}

module.exports = { normalize, list, get, create, update, syncApprovedLeads };
