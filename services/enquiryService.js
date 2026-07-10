const { Enquiry } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const { addDateRange } = require('../utils/queryFilters');
const audit = require('./auditService');
const catalogService = require('./catalogService');
const { findOneByPublicId, updateOneByPublicId } = require('../repositories/publicIdRepository');

async function listEnquiries(filters = {}) {
  const items = await Enquiry.find(buildEnquiryListQuery(filters)).sort({ createdAt: -1 }).lean();
  return items.map(withRequirementAliases);
}

async function paginateEnquiries(filters = {}) {
  const result = await paginateModel(Enquiry, buildEnquiryListQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { createdAt: -1 }
  });
  return { ...result, items: result.items.map(withRequirementAliases) };
}

function buildEnquiryListQuery(filters = {}) {
  const query = {};
  if (Array.isArray(filters.statuses) && filters.statuses.length) query.status = { $in: filters.statuses };
  else if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.formType) query.formType = filters.formType;
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;
  if (filters.sourceChannel) query['source.channel'] = filters.sourceChannel;
  if (filters.mobile) query['customer.mobile'] = filters.mobile;
  addDateRange(query, 'createdAt', filters);
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
      { 'address.city': regex }
    ];
  }
  return query;
}

async function getEnquiry(id) {
  const enquiry = await findOneByPublicId(Enquiry, id);
  return withRequirementAliases(enquiry);
}

async function createEnquiry(input, actor = 'system') {
  const id = createId('req');
  const enquiryInput = normaliseEnquiry({
    ...input,
    id,
    status: input.status || 'new',
    timeline: [timelineItem('created', `Requirement received from ${getSourceWebsite(input)}`, actor)],
    communicationLog: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const template = await catalogService.findTemplateFor(enquiryInput);
  if (template) {
    applyFormDefinition(enquiryInput, template);
  }

  validateEnquiry(enquiryInput);

  const enquiry = await Enquiry.create(enquiryInput);
  await audit.log('created', 'requirement', id, {
    sourceWebsite: enquiry.sourceWebsite,
    source: enquiry.source,
    categorySlug: enquiry.categorySlug,
    formType: enquiry.formType,
    templateId: enquiry.templateId,
    additionalDetailKeys: Object.keys(enquiry.additionalDetails || enquiry.fields || {})
  }, actor);
  return enquiry.toObject();
}

async function updateEnquiry(id, input, actor = 'admin') {
  const current = await findOneByPublicId(Enquiry, id);
  if (!current) {
    const error = new Error('Requirement not found');
    error.status = 404;
    throw error;
  }

  const hasFieldPatch = input.additionalDetails !== undefined || input.requirementDetails !== undefined || input.fields !== undefined || input.formData !== undefined || input.dynamicFields !== undefined;
  const fieldPatch = hasFieldPatch ? parseAdditionalDetails(input.additionalDetails ?? input.requirementDetails ?? input.fields ?? input.formData ?? input.dynamicFields) : {};
  const mergedInput = {
    ...current,
    ...input,
    updatedAt: nowIso()
  };

  if (hasFieldPatch) {
    const currentDetails = current.additionalDetails || current.fields || {};
    mergedInput.additionalDetails = { ...currentDetails, ...fieldPatch };
    mergedInput.fields = mergedInput.additionalDetails;
  }

  const merged = normaliseEnquiry(mergedInput);
  if (!merged.templateId || input.categorySlug || input.formType || input.sourceWebsite || input.formId) {
    const template = await catalogService.findTemplateFor(merged);
    if (template) {
      applyFormDefinition(merged, template);
    }
  }

  const timeline = [...(current.timeline || [])];
  if (input.status && input.status !== current.status) {
    timeline.push(timelineItem('status_changed', `Status changed from ${current.status} to ${input.status}`, actor));
  }
  timeline.push(timelineItem('updated', 'Requirement details updated', actor));
  merged.timeline = timeline;

  const updated = await updateOneByPublicId(Enquiry, id, { $set: merged });
  await audit.log('updated', 'requirement', id, {
    ...input,
    additionalDetailKeys: hasFieldPatch ? Object.keys(fieldPatch) : []
  }, actor);
  return updated;
}

async function updateDynamicFields(enquiryId, fieldsInput, actor = 'admin') {
  const current = await findOneByPublicId(Enquiry, enquiryId);
  if (!current) {
    const error = new Error('Requirement not found');
    error.status = 404;
    throw error;
  }

  const incoming = parseAdditionalDetails(fieldsInput);
  const mergedFields = { ...(current.additionalDetails || current.fields || {}), ...incoming };
  const updated = await updateOneByPublicId(Enquiry, enquiryId,
    {
      $set: { additionalDetails: mergedFields, fields: mergedFields, updatedAt: nowIso() },
      $push: { timeline: timelineItem('requirement_fields_updated', 'Requirement form fields updated', actor) }
    },
  );

  await audit.log('requirement_fields_updated', 'requirement', enquiryId, { additionalDetailKeys: Object.keys(incoming) }, actor);
  return updated;
}

async function getTemplateCompletion(enquiry) {
  const template = await catalogService.findTemplateFor(enquiry);
  return {
    template,
    completion: catalogService.getFieldCompletion(enquiry, template)
  };
}

async function addNote(enquiryId, note, actor = 'admin') {
  const updated = await updateOneByPublicId(Enquiry, enquiryId,
    {
      $set: { updatedAt: nowIso() },
      $push: { timeline: timelineItem('note', note, actor) }
    },
  );
  if (!updated) {
    const error = new Error('Requirement not found');
    error.status = 404;
    throw error;
  }
  await audit.log('note_added', 'enquiry', enquiryId, { note }, actor);
  return updated;
}

async function addCommunication(enquiryId, communication, actor = 'admin') {
  const item = { id: createId('comm'), ...communication, actor, createdAt: nowIso() };
  const updated = await updateOneByPublicId(Enquiry, enquiryId,
    {
      $set: { updatedAt: nowIso() },
      $push: {
        communicationLog: { $each: [item], $position: 0 },
        timeline: timelineItem('communication', `${communication.channel}: ${communication.message}`, actor)
      }
    },
  );
  return updated;
}

function normaliseEnquiry(input) {
  const source = normaliseSource(input);
  const customer = normaliseCustomer(input);
  const formType = catalogService.slugify(input.formType || input.source?.formType || input.formId || input.source?.formId || 'default') || 'default';
  const categorySlug = catalogService.slugify(input.categorySlug || input.category?.slug || input.category || 'general-services');
  const additionalDetails = parseAdditionalDetails(input.additionalDetails ?? input.requirementDetails ?? input.fields ?? input.formData ?? input.dynamicFields);
  const metadata = parseAdditionalDetails(input.metadata ?? input.meta ?? input.requirementMeta ?? {});
  return {
    id: input.id,
    recordType: input.recordType || 'requirement',
    sourceWebsite: source.website,
    source,
    categorySlug,
    category: {
      slug: categorySlug,
      name: input.categoryName || input.category?.name || input.serviceType || input.service || catalogService.humanize(categorySlug),
      formType,
      sourceWebsite: source.website
    },
    formType,
    templateId: input.templateId || '',
    serviceType: input.serviceType || input.service || input.requirementTitle || 'General service requirement',
    requirementTitle: input.requirementTitle || input.title || input.serviceType || input.service || '',
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
    quotedAmount: Number(input.quotedAmount || 0),
    finalAmount: Number(input.finalAmount || 0),
    notes: input.notes || '',
    additionalDetails,
    metadata,
    fieldDefinitions: Array.isArray(input.fieldDefinitions) ? input.fieldDefinitions : [],
    fields: additionalDetails,
    timeline: input.timeline || [],
    communicationLog: input.communicationLog || [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt || nowIso()
  };
}


function applyFormDefinition(enquiry, template) {
  enquiry.templateId = enquiry.templateId || template.id;
  enquiry.formType = template.formType || enquiry.formType || 'default';
  enquiry.categorySlug = template.categorySlug || enquiry.categorySlug;
  enquiry.fieldDefinitions = Array.isArray(template.fields) ? template.fields : [];
  enquiry.category = {
    ...(enquiry.category || {}),
    slug: enquiry.categorySlug,
    formType: enquiry.formType,
    sourceWebsite: enquiry.sourceWebsite,
    name: enquiry.category?.name || catalogService.humanize(enquiry.categorySlug)
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
  source.metadata = parseAdditionalDetails(source.metadata || input.sourceMetadata || {});
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
  if (!enquiry.additionalDetails || typeof enquiry.additionalDetails !== 'object' || Array.isArray(enquiry.additionalDetails)) {
    throwValidation('additionalDetails/formData must be an object for dynamic category-specific requirement data');
  }
}

function throwValidation(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function parseAdditionalDetails(fields) {
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


function withRequirementAliases(enquiry) {
  if (!enquiry) return enquiry;
  const additionalDetails = enquiry.additionalDetails && typeof enquiry.additionalDetails === 'object' && !Array.isArray(enquiry.additionalDetails)
    ? enquiry.additionalDetails
    : (enquiry.fields && typeof enquiry.fields === 'object' && !Array.isArray(enquiry.fields) ? enquiry.fields : {});
  const categorySlug = enquiry.categorySlug || enquiry.category?.slug || 'general-services';
  return {
    ...enquiry,
    recordType: enquiry.recordType || 'requirement',
    additionalDetails,
    fields: additionalDetails,
    metadata: enquiry.metadata && typeof enquiry.metadata === 'object' && !Array.isArray(enquiry.metadata) ? enquiry.metadata : {},
    category: enquiry.category || {
      slug: categorySlug,
      name: enquiry.serviceType || catalogService.humanize(categorySlug),
      formType: enquiry.formType || 'default',
      sourceWebsite: enquiry.sourceWebsite || 'manual-admin'
    },
    fieldDefinitions: Array.isArray(enquiry.fieldDefinitions) ? enquiry.fieldDefinitions : []
  };
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
  addNote,
  addCommunication,
  normaliseEnquiry,
  validateEnquiry,
  parseFields: parseAdditionalDetails,
  parseAdditionalDetails,
  timelineItem
};
