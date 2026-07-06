const { Enquiry } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const audit = require('./auditService');
const providerService = require('./providerService');
const catalogService = require('./catalogService');

async function listEnquiries(filters = {}) {
  return Enquiry.find(buildEnquiryListQuery(filters)).sort({ createdAt: -1 }).lean();
}

async function paginateEnquiries(filters = {}) {
  return paginateModel(Enquiry, buildEnquiryListQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { createdAt: -1 }
  });
}

function buildEnquiryListQuery(filters = {}) {
  const query = {};
  if (Array.isArray(filters.statuses) && filters.statuses.length) query.status = { $in: filters.statuses };
  else if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.formType) query.formType = filters.formType;
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;
  if (filters.sourceChannel) query['source.channel'] = filters.sourceChannel;
  if (filters.assignedProviderId) query.assignedProviderId = filters.assignedProviderId;
  if (filters.mobile) query['customer.mobile'] = filters.mobile;
  if (filters.search || filters.q) {
    const regex = new RegExp(escapeRegExp(filters.search || filters.q), 'i');
    query.$or = [
      { id: regex },
      { serviceType: regex },
      { formType: regex },
      { notes: regex },
      { sourceWebsite: regex },
      { 'source.website': regex },
      { 'source.channel': regex },
      { 'source.campaign': regex },
      { 'source.formId': regex },
      { 'source.externalEnquiryId': regex },
      { 'customer.name': regex },
      { 'customer.mobile': regex },
      { 'customer.email': regex },
      { 'address.city': regex },
      { assignedProviderName: regex }
    ];
  }
  return query;
}

async function getEnquiry(id) {
  return Enquiry.findOne({ id }).lean();
}

async function createEnquiry(input, actor = 'system') {
  const id = createId('enq');
  const enquiryInput = normaliseEnquiry({
    ...input,
    id,
    status: input.status || 'new',
    timeline: [timelineItem('created', `Enquiry received from ${getSourceWebsite(input)}`, actor)],
    communicationLog: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const template = await catalogService.findTemplateFor(enquiryInput);
  if (template) {
    enquiryInput.templateId = enquiryInput.templateId || template.id;
    enquiryInput.formType = enquiryInput.formType || template.formType || 'default';
    enquiryInput.categorySlug = enquiryInput.categorySlug || template.categorySlug;
  }

  validateEnquiry(enquiryInput);

  const enquiry = await Enquiry.create(enquiryInput);
  await audit.log('created', 'enquiry', id, {
    sourceWebsite: enquiry.sourceWebsite,
    source: enquiry.source,
    categorySlug: enquiry.categorySlug,
    formType: enquiry.formType,
    templateId: enquiry.templateId,
    dynamicFieldKeys: Object.keys(enquiry.fields || {})
  }, actor);
  return enquiry.toObject();
}

async function updateEnquiry(id, input, actor = 'admin') {
  const current = await Enquiry.findOne({ id }).lean();
  if (!current) {
    const error = new Error('Enquiry not found');
    error.status = 404;
    throw error;
  }

  const hasFieldPatch = input.fields !== undefined || input.formData !== undefined || input.dynamicFields !== undefined;
  const fieldPatch = hasFieldPatch ? parseFields(input.fields || input.formData || input.dynamicFields) : {};
  const mergedInput = {
    ...current,
    ...input,
    updatedAt: nowIso()
  };

  if (hasFieldPatch) {
    mergedInput.fields = { ...(current.fields || {}), ...fieldPatch };
  }

  const merged = normaliseEnquiry(mergedInput);
  if (!merged.templateId || input.categorySlug || input.formType || input.sourceWebsite || input.formId) {
    const template = await catalogService.findTemplateFor(merged);
    if (template) {
      merged.templateId = template.id;
      merged.formType = template.formType || merged.formType || 'default';
      merged.categorySlug = template.categorySlug || merged.categorySlug;
    }
  }

  const timeline = [...(current.timeline || [])];
  if (input.status && input.status !== current.status) {
    timeline.push(timelineItem('status_changed', `Status changed from ${current.status} to ${input.status}`, actor));
  }
  timeline.push(timelineItem('updated', 'Enquiry details updated', actor));
  merged.timeline = timeline;

  const updated = await Enquiry.findOneAndUpdate({ id }, { $set: merged }, { new: true, runValidators: true }).lean();
  await audit.log('updated', 'enquiry', id, {
    ...input,
    dynamicFieldKeys: hasFieldPatch ? Object.keys(fieldPatch) : []
  }, actor);
  return updated;
}

async function updateDynamicFields(enquiryId, fieldsInput, actor = 'admin') {
  const current = await Enquiry.findOne({ id: enquiryId }).lean();
  if (!current) {
    const error = new Error('Enquiry not found');
    error.status = 404;
    throw error;
  }

  const incoming = parseFields(fieldsInput);
  const mergedFields = { ...(current.fields || {}), ...incoming };
  const updated = await Enquiry.findOneAndUpdate(
    { id: enquiryId },
    {
      $set: { fields: mergedFields, updatedAt: nowIso() },
      $push: { timeline: timelineItem('dynamic_fields_updated', 'Dynamic enquiry fields updated', actor) }
    },
    { new: true, runValidators: true }
  ).lean();

  await audit.log('dynamic_fields_updated', 'enquiry', enquiryId, { dynamicFieldKeys: Object.keys(incoming) }, actor);
  return updated;
}

async function getTemplateCompletion(enquiry) {
  const template = await catalogService.findTemplateFor(enquiry);
  return {
    template,
    completion: catalogService.getFieldCompletion(enquiry, template)
  };
}

async function assignProvider(enquiryId, providerId, actor = 'admin') {
  const provider = await providerService.getProvider(providerId);
  if (!provider) {
    const error = new Error('Provider not found');
    error.status = 404;
    throw error;
  }
  const enquiry = await Enquiry.findOne({ id: enquiryId }).lean();
  if (!enquiry) {
    const error = new Error('Enquiry not found');
    error.status = 404;
    throw error;
  }

  const updated = await Enquiry.findOneAndUpdate(
    { id: enquiryId },
    {
      $set: {
        assignedProviderId: provider.id,
        assignedProviderName: provider.name,
        status: 'assigned',
        updatedAt: nowIso()
      },
      $push: {
        timeline: timelineItem('assigned', `Assigned to ${provider.name}`, actor)
      }
    },
    { new: true, runValidators: true }
  ).lean();

  await audit.log('assigned', 'enquiry', enquiryId, { providerId, providerName: provider.name }, actor);
  return updated;
}

async function addNote(enquiryId, note, actor = 'admin') {
  const updated = await Enquiry.findOneAndUpdate(
    { id: enquiryId },
    {
      $set: { updatedAt: nowIso() },
      $push: { timeline: timelineItem('note', note, actor) }
    },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) {
    const error = new Error('Enquiry not found');
    error.status = 404;
    throw error;
  }
  await audit.log('note_added', 'enquiry', enquiryId, { note }, actor);
  return updated;
}

async function addCommunication(enquiryId, communication, actor = 'admin') {
  const item = { id: createId('comm'), ...communication, actor, createdAt: nowIso() };
  const updated = await Enquiry.findOneAndUpdate(
    { id: enquiryId },
    {
      $set: { updatedAt: nowIso() },
      $push: {
        communicationLog: { $each: [item], $position: 0 },
        timeline: timelineItem('communication', `${communication.channel}: ${communication.message}`, actor)
      }
    },
    { new: true, runValidators: true }
  ).lean();
  return updated;
}

function normaliseEnquiry(input) {
  const source = normaliseSource(input);
  const customer = normaliseCustomer(input);
  const formType = catalogService.slugify(input.formType || input.source?.formType || input.formId || input.source?.formId || 'default') || 'default';
  return {
    id: input.id,
    sourceWebsite: source.website,
    source,
    categorySlug: catalogService.slugify(input.categorySlug || input.category || 'general-services'),
    formType,
    templateId: input.templateId || '',
    serviceType: input.serviceType || input.service || 'General service request',
    priority: input.priority || 'normal',
    status: input.status || 'new',
    customer,
    address: {
      line1: input.address?.line1 || input.addressLine1 || '',
      city: input.address?.city || input.city || '',
      state: input.address?.state || input.state || '',
      pincode: input.address?.pincode || input.pincode || ''
    },
    preferredDate: input.preferredDate || '',
    preferredSlot: input.preferredSlot || '',
    assignedProviderId: input.assignedProviderId || '',
    assignedProviderName: input.assignedProviderName || '',
    quotedAmount: Number(input.quotedAmount || 0),
    finalAmount: Number(input.finalAmount || 0),
    notes: input.notes || '',
    fields: parseFields(input.fields || input.formData || input.dynamicFields),
    timeline: input.timeline || [],
    communicationLog: input.communicationLog || [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt || nowIso()
  };
}

function normaliseCustomer(input) {
  const customer = input.customer || {};
  return {
    name: customer.name || input.customerName || input.name || '',
    mobile: customer.mobile || customer.phone || input.mobile || input.phone || '',
    email: customer.email || input.email || ''
  };
}

function normaliseSource(input) {
  const source = catalogService.buildSourceInfo(input);
  source.website = catalogService.cleanSourceWebsite(input.sourceWebsite ?? input.website ?? source.website ?? input.source ?? 'manual-admin');
  source.channel = own(input, 'sourceChannel') ? input.sourceChannel : (source.channel || '');
  source.sourceType = own(input, 'sourceType') ? input.sourceType : (source.sourceType || '');
  source.sourceName = own(input, 'sourceName') ? input.sourceName : (source.sourceName || '');
  source.campaign = own(input, 'campaign') ? input.campaign : (own(input, 'utm_campaign') ? input.utm_campaign : (source.campaign || ''));
  source.formId = own(input, 'formId') ? input.formId : (source.formId || '');
  source.landingPage = own(input, 'landingPage') ? input.landingPage : (source.landingPage || '');
  source.referrer = own(input, 'referrer') ? input.referrer : (source.referrer || '');
  source.externalEnquiryId = own(input, 'externalEnquiryId') ? input.externalEnquiryId : (source.externalEnquiryId || '');
  source.utm = {
    source: own(input, 'utm_source') ? input.utm_source : (source.utm?.source || ''),
    medium: own(input, 'utm_medium') ? input.utm_medium : (source.utm?.medium || ''),
    campaign: own(input, 'utm_campaign') ? input.utm_campaign : (source.utm?.campaign || source.campaign || ''),
    term: own(input, 'utm_term') ? input.utm_term : (source.utm?.term || ''),
    content: own(input, 'utm_content') ? input.utm_content : (source.utm?.content || '')
  };
  source.metadata = parseFields(source.metadata || input.sourceMetadata || {});
  return source;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getSourceWebsite(input) {
  return input.source?.website || input.sourceInfo?.website || input.sourceWebsite || input.website || input.source || 'manual-admin';
}

function validateEnquiry(enquiry) {
  if (!enquiry.categorySlug) throwValidation('categorySlug is required');
  if (!enquiry.customer.mobile) throwValidation('customer.mobile/mobile is required');
  if (!enquiry.sourceWebsite) throwValidation('source.website/sourceWebsite is required');
  if (!enquiry.fields || typeof enquiry.fields !== 'object' || Array.isArray(enquiry.fields)) {
    throwValidation('fields/formData must be an object for dynamic enquiry data');
  }
}

function throwValidation(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function parseFields(fields) {
  if (!fields) return {};
  if (typeof fields === 'object' && !Array.isArray(fields)) return fields;
  if (typeof fields === 'string') {
    try {
      const parsed = JSON.parse(fields);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (error) {
      return {};
    }
  }
  return {};
}

function timelineItem(type, message, actor = 'system') {
  return {
    id: createId('time'),
    type,
    message,
    actor,
    createdAt: nowIso()
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listEnquiries,
  paginateEnquiries,
  getEnquiry,
  createEnquiry,
  updateEnquiry,
  updateDynamicFields,
  getTemplateCompletion,
  assignProvider,
  addNote,
  addCommunication,
  normaliseEnquiry,
  validateEnquiry,
  parseFields,
  timelineItem
};
