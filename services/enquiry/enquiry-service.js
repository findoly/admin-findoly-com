const Enquiry = require('../../models/Enquiry');
const Provider = require('../../models/Provider');
const LeadDistribution = require('../../models/LeadDistribution');
const { createId } = require('../../utils/id');
const { getPagination, pageResult } = require('../../utils/pagination');

function value(input, flatKey, nestedObject, nestedKey, fallback = '') {
  if (input[flatKey] !== undefined) return input[flatKey];
  if (input[nestedObject] && input[nestedObject][nestedKey] !== undefined) return input[nestedObject][nestedKey];
  return fallback;
}

function normalizeInput(input = {}, current = {}) {
  const categoryObject = input.category && typeof input.category === 'object' ? input.category : {};
  const sourceObject = input.source && typeof input.source === 'object' ? input.source : {};
  const additionalDetails = input.additionalDetails || input.fields || input.formData || input.dynamicFields || current.additionalDetails || {};
  const categorySlug = String(input.categorySlug || categoryObject.slug || current.categorySlug || '').trim();
  const categoryName = String(
    (typeof input.category === 'string' ? input.category : categoryObject.name) || (typeof current.category === 'string' ? current.category : current.category?.name) || categorySlug
  ).trim();

  const doc = {
    name: String(value(input, 'name', 'customer', 'name', current.name || current.customer?.name || '')).trim(),
    mobile: String(value(input, 'mobile', 'customer', 'mobile', current.mobile || current.customer?.mobile || '')).trim(),
    email: String(value(input, 'email', 'customer', 'email', current.email || current.customer?.email || '')).trim().toLowerCase(),
    addressLine: String(value(input, 'addressLine', 'address', 'line1', current.addressLine || current.address?.line1 || '')).trim(),
    city: String(value(input, 'city', 'address', 'city', current.city || current.address?.city || '')).trim(),
    state: String(value(input, 'state', 'address', 'state', current.state || current.address?.state || '')).trim(),
    pincode: String(value(input, 'pincode', 'address', 'pincode', current.pincode || current.address?.pincode || '')).trim(),
    category: categoryName,
    categorySlug,
    serviceType: String(input.serviceType ?? current.serviceType ?? '').trim(),
    requirementTitle: String(input.requirementTitle ?? input.title ?? current.requirementTitle ?? '').trim(),
    priority: String(input.priority ?? current.priority ?? 'normal'),
    status: String(input.status ?? current.status ?? 'new'),
    preferredDate: String(input.preferredDate ?? current.preferredDate ?? ''),
    preferredSlot: String(input.preferredSlot ?? current.preferredSlot ?? ''),
    leadPricePaise: Math.max(0, Number(input.leadPricePaise ?? current.leadPricePaise ?? 10000)),
    currency: 'INR',
    sourceWebsite: String(input.sourceWebsite || sourceObject.website || current.sourceWebsite || current.source?.website || 'manual-admin'),
    sourceChannel: String(input.sourceChannel || sourceObject.channel || current.sourceChannel || current.source?.channel || 'admin'),
    sourceType: String(input.sourceType || sourceObject.sourceType || current.sourceType || current.source?.sourceType || 'manual'),
    sourceName: String(input.sourceName || sourceObject.sourceName || current.sourceName || current.source?.sourceName || ''),
    campaign: String(input.campaign || sourceObject.campaign || current.campaign || current.source?.campaign || ''),
    externalEnquiryId: String(input.externalEnquiryId || sourceObject.externalEnquiryId || current.externalEnquiryId || current.source?.externalEnquiryId || ''),
    notes: String(input.notes ?? current.notes ?? ''),
    additionalDetails,
    metadata: input.metadata || current.metadata || {},
    // Legacy mirrors remain so existing integrations do not break.
    customer: {
      name: String(value(input, 'name', 'customer', 'name', current.name || current.customer?.name || '')).trim(),
      mobile: String(value(input, 'mobile', 'customer', 'mobile', current.mobile || current.customer?.mobile || '')).trim(),
      email: String(value(input, 'email', 'customer', 'email', current.email || current.customer?.email || '')).trim().toLowerCase()
    },
    address: {
      line1: String(value(input, 'addressLine', 'address', 'line1', current.addressLine || current.address?.line1 || '')).trim(),
      city: String(value(input, 'city', 'address', 'city', current.city || current.address?.city || '')).trim(),
      state: String(value(input, 'state', 'address', 'state', current.state || current.address?.state || '')).trim(),
      pincode: String(value(input, 'pincode', 'address', 'pincode', current.pincode || current.address?.pincode || '')).trim()
    },
    source: {
      ...(current.source || {}), ...(sourceObject || {}),
      website: String(input.sourceWebsite || sourceObject.website || current.sourceWebsite || current.source?.website || 'manual-admin'),
      channel: String(input.sourceChannel || sourceObject.channel || current.sourceChannel || current.source?.channel || 'admin'),
      sourceType: String(input.sourceType || sourceObject.sourceType || current.sourceType || current.source?.sourceType || 'manual'),
      sourceName: String(input.sourceName || sourceObject.sourceName || current.sourceName || current.source?.sourceName || ''),
      campaign: String(input.campaign || sourceObject.campaign || current.campaign || current.source?.campaign || ''),
      externalEnquiryId: String(input.externalEnquiryId || sourceObject.externalEnquiryId || current.externalEnquiryId || current.source?.externalEnquiryId || '')
    },
    fields: additionalDetails,
    updatedAt: new Date()
  };

  return doc;
}

function idQuery(enquiryId) {
  return { $or: [{ enquiryId }, { id: enquiryId }, { _id: enquiryId }] };
}

async function create(input, actor = 'admin') {
  const data = normalizeInput(input);
  if (!data.categorySlug) throw Object.assign(new Error('Category is required'), { status: 400 });
  const now = new Date();
  data.timeline = [{ id: createId('time'), type: 'created', message: 'Lead created', actor, createdAt: now }];
  const enquiry = await Enquiry.create(data);
  if (['approved', 'distributed'].includes(enquiry.status)) await distribute(enquiry, actor);
  return get(enquiry.enquiryId);
}

async function list(filters = {}) {
  const { page, limit, skip } = getPagination(filters);
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.city) query.city = new RegExp(String(filters.city), 'i');
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(`${filters.startDate}T00:00:00.000+05:30`);
    if (filters.endDate) query.createdAt.$lte = new Date(`${filters.endDate}T23:59:59.999+05:30`);
  }
  if (filters.q) {
    const q = new RegExp(String(filters.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { enquiryId: q }, { id: q }, { requirementTitle: q }, { name: q }, { mobile: q },
      { category: q }, { categorySlug: q }, { city: q }, { externalEnquiryId: q },
      { 'customer.name': q }, { 'customer.mobile': q }
    ];
  }
  const [data, total] = await Promise.all([
    Enquiry.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Enquiry.countDocuments(query)
  ]);
  return pageResult(data.map(flattenLegacy), total, page, limit);
}

async function get(enquiryId) {
  const enquiry = await Enquiry.findOne(idQuery(enquiryId)).lean();
  if (!enquiry) throw Object.assign(new Error('Lead not found'), { status: 404 });
  const distributions = await LeadDistribution.find({ requirementId: enquiry.enquiryId || enquiry.id }).sort({ distributedAt: -1 }).lean();
  return { ...flattenLegacy(enquiry), distributions };
}

async function update(enquiryId, input, actor = 'admin') {
  const existing = await Enquiry.findOne(idQuery(enquiryId)).lean();
  if (!existing) throw Object.assign(new Error('Lead not found'), { status: 404 });
  const data = normalizeInput(input, existing);
  const timeline = Array.isArray(existing.timeline) ? existing.timeline : [];
  if (data.status !== existing.status) {
    timeline.push({ id: createId('time'), type: 'status_changed', message: `Status changed from ${existing.status} to ${data.status}`, actor, createdAt: new Date() });
  }
  data.timeline = timeline;
  await Enquiry.updateOne(idQuery(enquiryId), { $set: data });
  const updated = await Enquiry.findOne(idQuery(enquiryId));
  if (['approved', 'distributed'].includes(updated.status)) await distribute(updated, actor);
  else await LeadDistribution.updateMany({ requirementId: updated.enquiryId, contactUnlocked: { $ne: true } }, { $set: { status: 'withdrawn', updatedAt: new Date() } });
  return get(updated.enquiryId);
}

async function addNote(enquiryId, note, actor = 'admin') {
  const message = String(note || '').trim();
  if (!message) throw Object.assign(new Error('Note is required'), { status: 400 });
  const result = await Enquiry.updateOne(idQuery(enquiryId), {
    $set: { notes: message, updatedAt: new Date() },
    $push: { timeline: { id: createId('time'), type: 'note', message, actor, createdAt: new Date() } }
  });
  if (!result.matchedCount) throw Object.assign(new Error('Lead not found'), { status: 404 });
  return get(enquiryId);
}

function flattenLegacy(doc) {
  return {
    ...doc,
    enquiryId: doc.enquiryId || doc.id || String(doc._id),
    name: doc.name || doc.customer?.name || '',
    mobile: doc.mobile || doc.customer?.mobile || '',
    email: doc.email || doc.customer?.email || '',
    addressLine: doc.addressLine || doc.address?.line1 || '',
    city: doc.city || doc.address?.city || '',
    state: doc.state || doc.address?.state || '',
    pincode: doc.pincode || doc.address?.pincode || '',
    category: typeof doc.category === 'string' ? doc.category : (doc.category?.name || doc.categorySlug || ''),
    sourceWebsite: doc.sourceWebsite || doc.source?.website || '',
    sourceChannel: doc.sourceChannel || doc.source?.channel || '',
    sourceType: doc.sourceType || doc.source?.sourceType || '',
    sourceName: doc.sourceName || doc.source?.sourceName || '',
    campaign: doc.campaign || doc.source?.campaign || '',
    externalEnquiryId: doc.externalEnquiryId || doc.source?.externalEnquiryId || '',
    additionalDetails: doc.additionalDetails || doc.fields || {}
  };
}

async function distribute(enquiryDocument, actor = 'system') {
  const enquiry = flattenLegacy(enquiryDocument.toObject ? enquiryDocument.toObject() : enquiryDocument);
  const requirementId = enquiry.enquiryId;
  const providers = await Provider.find({
    status: 'active', portalAccessEnabled: { $ne: false }, categorySlugs: enquiry.categorySlug
  }).lean();

  const providerIds = [];
  for (const provider of providers) {
    const providerId = provider.providerId || provider.id || String(provider._id);
    providerIds.push(providerId);
    const existing = await LeadDistribution.findOne({ requirementId, providerId });
    const data = {
      requirementId,
      providerId,
      categorySlug: enquiry.categorySlug,
      leadPricePaise: Number(enquiry.leadPricePaise || 0),
      currency: 'INR',
      leadTitle: enquiry.requirementTitle,
      serviceType: enquiry.serviceType,
      category: enquiry.category,
      city: enquiry.city,
      state: enquiry.state,
      pincode: enquiry.pincode,
      preferredDate: enquiry.preferredDate,
      preferredSlot: enquiry.preferredSlot,
      priority: enquiry.priority,
      sourceWebsite: enquiry.sourceWebsite,
      customerName: enquiry.name,
      customerMobile: enquiry.mobile,
      customerEmail: enquiry.email,
      customerAddress: enquiry.addressLine,
      providerName: provider.name,
      providerBusinessName: provider.businessName,
      providerMobile: provider.mobile,
      additionalDetails: enquiry.additionalDetails || {},
      leadPreview: {
        title: enquiry.requirementTitle, serviceType: enquiry.serviceType, categorySlug: enquiry.categorySlug,
        categoryName: enquiry.category, city: enquiry.city, state: enquiry.state, pincode: enquiry.pincode,
        preferredDate: enquiry.preferredDate, preferredSlot: enquiry.preferredSlot, priority: enquiry.priority,
        sourceWebsite: enquiry.sourceWebsite, additionalDetails: enquiry.additionalDetails || {}
      },
      contactSnapshot: {
        name: enquiry.name, mobile: enquiry.mobile, email: enquiry.email, addressLine1: enquiry.addressLine,
        city: enquiry.city, state: enquiry.state, pincode: enquiry.pincode
      },
      providerSnapshot: { name: provider.name, businessName: provider.businessName, mobile: provider.mobile, city: provider.city },
      updatedAt: new Date()
    };
    if (!existing) {
      await LeadDistribution.create({ ...data, status: 'offered', contactUnlocked: false, distributedBy: actor, distributedAt: new Date() });
    } else if (!existing.contactUnlocked) {
      await LeadDistribution.updateOne({ leadDistributionId: existing.leadDistributionId }, { $set: { ...data, status: 'offered' } });
    }
  }

  await LeadDistribution.updateMany({
    requirementId,
    contactUnlocked: { $ne: true },
    ...(providerIds.length ? { providerId: { $nin: providerIds } } : {})
  }, { $set: { status: 'withdrawn', updatedAt: new Date() } });

  const [distributionCount, unlockedCount] = await Promise.all([
    LeadDistribution.countDocuments({ requirementId, status: { $ne: 'withdrawn' } }),
    LeadDistribution.countDocuments({ requirementId, contactUnlocked: true })
  ]);
  await Enquiry.updateOne(idQuery(requirementId), { $set: { distributionCount, unlockedCount, distributedAt: new Date(), updatedAt: new Date() } });
  return { distributionCount, unlockedCount };
}

module.exports = { normalizeInput, flattenLegacy, create, list, get, update, addNote, distribute };
