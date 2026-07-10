const enquiryService = require('../services/enquiryService');
const catalogService = require('../services/catalogService');
const followUpService = require('../services/followUpService');
const communicationService = require('../services/communicationService');
const { enquiryStatuses, enquiryQueues, getEnquiryQueue, priorities, humanize } = require('../utils/status');
const { formatDate, dateOnly } = require('../utils/dates');
const { buildPagination } = require('../utils/pagination');

async function index(req, res, next) {
  try {
    const [result, categories, sourceWebsites] = await Promise.all([
      enquiryService.paginateEnquiries(req.query),
      catalogService.listCategories(),
      catalogService.listSourceWebsites()
    ]);
    res.render('enquiries/index', {
      title: 'Requirements',
      enquiries: result.items,
      pagination: buildPagination('/enquiries', req.query, result),
      categories,
      sourceWebsites,
      filters: req.query,
      statuses: enquiryStatuses,
      priorities,
      queueDefinition: null,
      enquiryQueues,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function queue(req, res, next) {
  try {
    const queueDefinition = getEnquiryQueue(req.params.queueKey);
    if (!queueDefinition) return res.status(404).render('errors/404', { title: 'Queue not found' });

    const filters = {
      ...req.query,
      status: '',
      statuses: queueDefinition.statuses
    };

    const [result, categories, sourceWebsites] = await Promise.all([
      enquiryService.paginateEnquiries(filters),
      catalogService.listCategories(),
      catalogService.listSourceWebsites()
    ]);

    res.render('enquiries/index', {
      title: queueDefinition.label,
      subtitle: queueDefinition.description,
      enquiries: result.items,
      pagination: buildPagination(`/enquiries/queue/${queueDefinition.key}`, req.query, result),
      categories,
      sourceWebsites,
      filters: req.query,
      statuses: enquiryStatuses,
      priorities,
      queueDefinition,
      enquiryQueues,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function showCreate(req, res, next) {
  try {
    const [categoryRecords, templates, sourceWebsites] = await Promise.all([
      catalogService.listCategories({ active: true }),
      catalogService.listTemplates({ active: true }),
      catalogService.listSourceWebsites()
    ]);
    const categories = categoryRecords.filter((category, index, records) =>
      index === records.findIndex((item) => item.slug === category.slug)
    );
    res.render('enquiries/create', {
      title: 'Create Lead',
      categories,
      templates,
      sourceWebsites,
      priorities,
      humanize
    });
  } catch (error) {
    next(error);
  }
}


async function showEdit(req, res, next) {
  try {
    const enquiry = await enquiryService.getEnquiry(req.params.id);
    if (!enquiry) return res.status(404).render('errors/404', { title: 'Requirement not found' });

    const [categories, templates, sourceWebsites, templateCompletion] = await Promise.all([
      catalogService.listCategories({ active: true }),
      catalogService.listTemplates({ active: true }),
      catalogService.listSourceWebsites(),
      enquiryService.getTemplateCompletion(enquiry)
    ]);

    res.render('enquiries/edit', {
      title: `Edit ${enquiry.id}`,
      subtitle: 'Requirement verification and form data',
      enquiry,
      categories,
      templates,
      sourceWebsites,
      template: templateCompletion.template,
      fieldCompletion: templateCompletion.completion,
      statuses: enquiryStatuses,
      priorities,
      humanize,
      dateOnly,
      fieldValue
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const additionalDetails = { ...parseJsonObject(req.body.additionalDetailsJson), ...collectDynamicFields(req.body) };
    const metadata = parseJsonObject(req.body.metadataJson);
    const enquiry = await enquiryService.createEnquiry({ ...req.body, additionalDetails, metadata, fields: additionalDetails }, req.admin.email);
    res.redirect(`/enquiries/${enquiry.id}?flash=Lead created`);
  } catch (error) {
    next(error);
  }
}

async function show(req, res, next) {
  try {
    const enquiry = await enquiryService.getEnquiry(req.params.id);
    if (!enquiry) return res.status(404).render('errors/404', { title: 'Requirement not found' });
    const [followUps, communications, categories, templateCompletion] = await Promise.all([
      followUpService.listFollowUps({ enquiryId: enquiry.id }),
      communicationService.listCommunications({ enquiryId: enquiry.id }),
      catalogService.listCategories(),
      enquiryService.getTemplateCompletion(enquiry)
    ]);
    res.render('enquiries/show', {
      title: `Requirement ${enquiry.id}`,
      enquiry,
      followUps,
      communications,
      categories,
      template: templateCompletion.template,
      fieldCompletion: templateCompletion.completion,
      statuses: enquiryStatuses,
      priorities,
      humanize,
      formatDate,
      dateOnly,
      fieldValue
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const hasDynamicFieldInput = Object.keys(req.body || {}).some((key) => key.startsWith('field__')) || req.body.dynamicFieldKeys || req.body.additionalDetailsJson !== undefined;
    const input = { ...req.body };
    if (hasDynamicFieldInput) {
      const dynamicDetails = collectDynamicFields(req.body, true);
      input.additionalDetails = { ...parseJsonObject(req.body.additionalDetailsJson), ...dynamicDetails };
      input.fields = input.additionalDetails;
    }
    if (req.body.metadataJson !== undefined) input.metadata = parseJsonObject(req.body.metadataJson);
    await enquiryService.updateEnquiry(req.params.id, input, req.admin.email);
    const backTo = req.body.redirectTo === 'edit' ? `/enquiries/${req.params.id}/edit` : `/enquiries/${req.params.id}`;
    res.redirect(`${backTo}?flash=Requirement updated`);
  } catch (error) {
    next(error);
  }
}

async function updateFields(req, res, next) {
  try {
    const fields = { ...parseJsonObject(req.body.additionalDetailsJson), ...collectDynamicFields(req.body, true) };
    await enquiryService.updateDynamicFields(req.params.id, fields, req.admin.email);
    res.redirect(`/enquiries/${req.params.id}?flash=Requirement fields updated`);
  } catch (error) {
    next(error);
  }
}

async function note(req, res, next) {
  try {
    await enquiryService.addNote(req.params.id, req.body.note, req.admin.email);
    res.redirect(`/enquiries/${req.params.id}?flash=Note added`);
  } catch (error) {
    next(error);
  }
}

function collectDynamicFields(body, includeMissing = false) {
  const fields = {};
  const declaredKeys = String(body.dynamicFieldKeys || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (includeMissing) {
    for (const key of declaredKeys) fields[key] = '';
  }

  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('field__')) {
      fields[key.replace('field__', '')] = value;
    }
  }
  return fields;
}


function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function fieldValue(fields, key) {
  const value = fields?.[key];
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null) return '';
  return String(value);
}

module.exports = { index, queue, showCreate, showEdit, create, show, update, updateFields, note };
