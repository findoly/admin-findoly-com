const { Category, FormTemplate } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const audit = require('./auditService');

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'radio',
  'checkbox',
  'date',
  'datetime-local',
  'email',
  'tel',
  'url',
  'file_url'
];

async function listCategories(filters = {}) {
  const query = {};
  if (filters.active !== undefined) query.active = filters.active === true || filters.active === 'true';
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;
  if (filters.formType) query.formType = filters.formType;
  if (filters.slug) query.slug = filters.slug;
  return Category.find(query).sort({ sourceWebsite: 1, name: 1, formType: 1 }).lean();
}

async function getCategory(slugOrId, sourceWebsite = '', formType = '') {
  const formFilter = formType ? { formType: slugify(formType) } : {};
  if (!sourceWebsite) {
    return Category.findOne({
      $or: [
        { id: slugOrId },
        { slug: slugOrId, ...formFilter }
      ]
    }).lean();
  }
  return Category.findOne({
    $or: [
      { id: slugOrId },
      { slug: slugOrId, sourceWebsite, ...formFilter },
      { slug: slugOrId, sourceWebsite: 'any', ...formFilter }
    ]
  }).sort({ sourceWebsite: sourceWebsite === 'any' ? 1 : -1 }).lean();
}

async function createCategory(input, actor = 'admin') {
  const slug = slugify(input.slug || input.name);
  const sourceWebsite = cleanSourceWebsite(input.sourceWebsite || input.website || 'any');
  const formType = slugify(input.formType || input.defaultFormType || 'default') || 'default';
  const existing = await Category.exists({ slug, sourceWebsite, formType });
  if (existing) {
    const error = new Error('Category already exists for this website and form type');
    error.status = 400;
    throw error;
  }
  const record = await Category.create({
    id: createId('cat'),
    name: input.name,
    slug,
    sourceWebsite,
    formType,
    description: input.description || '',
    active: input.active !== 'false',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const fields = parseFields(input.fields);
  let template = null;
  if (fields.length) {
    template = await createTemplate({
      name: input.templateName || `${input.name} ${humanize(formType)} form`,
      slug: input.templateSlug || `${slug}-${formType}`,
      sourceWebsite,
      categorySlug: slug,
      formType,
      description: input.templateDescription || input.description || '',
      fields,
      active: input.active !== 'false'
    }, actor, { skipDuplicateCheck: true });
  }

  await audit.log('created', 'category', record.id, {
    name: record.name,
    sourceWebsite,
    formType,
    templateId: template?.id || ''
  }, actor);
  return { ...record.toObject(), template };
}

async function listTemplates(filters = {}) {
  const query = {};
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.formType) query.formType = filters.formType;
  if (filters.active !== undefined) query.active = filters.active === true || filters.active === 'true';
  if (filters.sourceWebsite) query.$or = [{ sourceWebsite: filters.sourceWebsite }, { sourceWebsite: 'any' }];
  return FormTemplate.find(query).sort({ sourceWebsite: 1, categorySlug: 1, formType: 1, name: 1 }).lean();
}

async function getTemplate(idOrSlug) {
  return FormTemplate.findOne({ $or: [{ id: idOrSlug }, { slug: idOrSlug }, { categorySlug: idOrSlug }] }).lean();
}

async function createTemplate(input, actor = 'admin', options = {}) {
  const fields = parseFields(input.fields);
  const sourceWebsite = cleanSourceWebsite(input.sourceWebsite || input.source?.website || 'any');
  const formType = slugify(input.formType || input.source?.formType || input.formId || 'default') || 'default';
  const categorySlug = slugify(input.categorySlug || input.category || input.categoryName || 'general-services');
  const name = input.name || `${humanize(categorySlug)} ${humanize(formType)} form`;
  if (!options.skipDuplicateCheck) {
    const existing = await FormTemplate.exists({ sourceWebsite, categorySlug, formType, active: { $ne: false } });
    if (existing) {
      const error = new Error('An active form template already exists for this website/category/form type');
      error.status = 400;
      throw error;
    }
  }
  const record = await FormTemplate.create({
    id: createId('tpl'),
    name,
    slug: slugify(input.slug || name),
    categorySlug,
    formType,
    sourceWebsite,
    source: buildSourceInfo({ ...input, sourceWebsite, formType }),
    description: input.description || '',
    fields,
    active: input.active !== 'false',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await audit.log('created', 'template', record.id, { name: record.name, sourceWebsite, categorySlug, formType }, actor);
  return record.toObject();
}

async function findTemplateFor(input = {}) {
  if (input.templateId) {
    const selected = await FormTemplate.findOne({ id: input.templateId, active: { $ne: false } }).lean();
    if (selected) return selected;
  }

  const sourceWebsite = cleanSourceWebsite(input.sourceWebsite || input.source?.website || input.website || 'any');
  const categorySlug = slugify(input.categorySlug || input.category || '');
  const formType = slugify(input.formType || input.source?.formType || input.formId || input.source?.formId || 'default') || 'default';
  if (!categorySlug) return null;

  const candidates = await FormTemplate.find({
    active: { $ne: false },
    categorySlug,
    sourceWebsite: { $in: [sourceWebsite, 'any'] }
  }).lean();

  return candidates
    .map((template) => ({ template, score: templateMatchScore(template, { sourceWebsite, categorySlug, formType }) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.template || null;
}

function templateMatchScore(template, target) {
  let score = 0;
  if (template.categorySlug === target.categorySlug) score += 20;
  if (template.sourceWebsite === target.sourceWebsite) score += 20;
  if (template.sourceWebsite === 'any') score += 8;
  if (template.formType === target.formType) score += 20;
  if (template.formType === 'default') score += 5;
  return score;
}

async function getFormSchema(input = {}) {
  const sourceWebsite = cleanSourceWebsite(input.sourceWebsite || input.website || input.source?.website || 'any');
  const categorySlug = slugify(input.categorySlug || input.category || '');
  const formType = slugify(input.formType || input.source?.formType || input.formId || input.source?.formId || 'default') || 'default';
  const [category, template] = await Promise.all([
    categorySlug ? getCategory(categorySlug, sourceWebsite, formType) : null,
    findTemplateFor({ sourceWebsite, categorySlug, formType, templateId: input.templateId })
  ]);
  return {
    sourceWebsite,
    categorySlug,
    formType,
    category,
    template,
    fields: template?.fields || [],
    submitEndpoint: '/api/enquiries',
    payloadExample: {
      sourceWebsite,
      categorySlug,
      formType,
      serviceType: category?.name || humanize(categorySlug),
      customer: { name: 'Customer name', mobile: '9999999999', email: '' },
      formData: Object.fromEntries((template?.fields || []).map((field) => [field.name, field.defaultValue || '']))
    }
  };
}

async function listSourceWebsites() {
  const [categorySites, templateSites] = await Promise.all([
    Category.distinct('sourceWebsite'),
    FormTemplate.distinct('sourceWebsite')
  ]);
  return [...new Set([...categorySites, ...templateSites, 'manual-admin'].filter(Boolean))].sort();
}

function parseFields(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normaliseTemplateField).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(normaliseTemplateField).filter(Boolean);
    } catch (error) {
      return value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, label, type = 'text', required = 'false', options = '', group = 'Details', placeholder = ''] = line.split('|').map((part) => part.trim());
          return normaliseTemplateField({
            name,
            label: label || name,
            type,
            required: required === 'true' || required === 'yes' || required === 'required',
            options,
            group,
            placeholder
          });
        })
        .filter(Boolean);
    }
  }
  return [];
}

function normaliseTemplateField(field) {
  const name = slugify(field.name || field.key || field.label);
  if (!name) return null;
  const type = FIELD_TYPES.includes(String(field.type || '').trim()) ? String(field.type).trim() : 'text';
  return {
    name,
    label: field.label || field.name || field.key,
    type,
    required: field.required === true || field.required === 'true' || field.required === 'yes' || field.required === 'required',
    options: normaliseOptions(field.options),
    placeholder: field.placeholder || '',
    helpText: field.helpText || field.help || '',
    group: field.group || 'Details',
    defaultValue: field.defaultValue ?? '',
    validation: typeof field.validation === 'object' && field.validation ? field.validation : {}
  };
}

function normaliseOptions(options) {
  if (Array.isArray(options)) return options.map((item) => String(item).trim()).filter(Boolean);
  if (typeof options === 'string') return options.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function getFieldCompletion(enquiry, template) {
  const fields = enquiry?.fields || {};
  const templateFields = template?.fields || [];
  const requiredFields = templateFields.filter((field) => field.required);
  const missingRequired = requiredFields.filter((field) => isMissing(fields[field.name]));
  const extraFields = Object.keys(fields)
    .filter((key) => !templateFields.some((field) => field.name === key))
    .map((key) => ({ name: key, label: humanize(key), type: 'text', required: false, group: 'Extra source data' }));
  return {
    totalTemplateFields: templateFields.length,
    requiredCount: requiredFields.length,
    missingRequired,
    completedRequiredCount: requiredFields.length - missingRequired.length,
    completionPercent: requiredFields.length ? Math.round(((requiredFields.length - missingRequired.length) / requiredFields.length) * 100) : 100,
    editableFields: [...templateFields, ...extraFields]
  };
}

function isMissing(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function buildSourceInfo(input = {}) {
  const source = input.source || input.sourceInfo || {};
  const utm = source.utm || input.utm || {};
  return {
    website: cleanSourceWebsite(source.website || input.sourceWebsite || input.website || 'any'),
    channel: source.channel || input.sourceChannel || input.channel || '',
    sourceType: source.sourceType || input.sourceType || '',
    sourceName: source.sourceName || input.sourceName || '',
    campaign: source.campaign || input.campaign || input.utm_campaign || '',
    formId: source.formId || input.formId || '',
    landingPage: source.landingPage || input.landingPage || '',
    referrer: source.referrer || input.referrer || '',
    externalEnquiryId: source.externalEnquiryId || input.externalEnquiryId || '',
    utm: {
      source: utm.source || input.utm_source || '',
      medium: utm.medium || input.utm_medium || '',
      campaign: utm.campaign || input.utm_campaign || '',
      term: utm.term || input.utm_term || '',
      content: utm.content || input.utm_content || ''
    },
    metadata: source.metadata || input.sourceMetadata || {}
  };
}

function cleanSourceWebsite(value) {
  return String(value || 'any').trim().toLowerCase() || 'any';
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function humanize(value) {
  return String(value || '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  FIELD_TYPES,
  listCategories,
  getCategory,
  createCategory,
  listTemplates,
  getTemplate,
  createTemplate,
  findTemplateFor,
  getFormSchema,
  listSourceWebsites,
  parseFields,
  normaliseTemplateField,
  getFieldCompletion,
  buildSourceInfo,
  cleanSourceWebsite,
  slugify,
  humanize
};
