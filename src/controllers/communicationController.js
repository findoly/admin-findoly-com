const communicationService = require('../services/communicationService');
const enquiryService = require('../services/enquiryService');
const providerService = require('../services/providerService');
const { formatDate } = require('../utils/dates');
const { humanize, communicationStatuses } = require('../utils/status');
const { buildPagination } = require('../utils/pagination');

async function index(req, res, next) {
  try {
    const result = await communicationService.paginateCommunications(req.query);
    res.render('communications/index', {
      title: 'Communications',
      subtitle: 'List and history',
      communications: result.items,
      pagination: buildPagination('/communications', req.query, result),
      filters: req.query,
      statuses: communicationStatuses,
      formatDate,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function newPage(req, res, next) {
  try {
    const [enquiries, providers] = await Promise.all([
      enquiryService.listEnquiries({}),
      providerService.listProviders({})
    ]);
    res.render('communications/new', {
      title: 'Log Communication',
      subtitle: 'New log entry',
      communication: {},
      enquiries,
      providers,
      statuses: communicationStatuses,
      formatDate,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const record = await communicationService.createCommunication(req.body, req.admin.email);
    if (req.body.enquiryId) {
      await enquiryService.addCommunication(req.body.enquiryId, req.body, req.admin.email);
    }
    res.redirect(`/communications/${record.id}?flash=Communication logged`);
  } catch (error) {
    next(error);
  }
}

async function show(req, res, next) {
  try {
    const communication = await communicationService.getCommunication(req.params.id);
    if (!communication) return res.status(404).render('errors/404', { title: 'Communication not found' });
    const [enquiry, provider] = await Promise.all([
      communication.enquiryId ? enquiryService.getEnquiry(communication.enquiryId) : null,
      communication.providerId ? providerService.getProvider(communication.providerId) : null
    ]);
    res.render('communications/show', {
      title: 'Communication Detail',
      subtitle: humanize(communication.channel),
      communication,
      enquiry,
      provider,
      statuses: communicationStatuses,
      formatDate,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function edit(req, res, next) {
  try {
    const [communication, enquiries, providers] = await Promise.all([
      communicationService.getCommunication(req.params.id),
      enquiryService.listEnquiries({}),
      providerService.listProviders({})
    ]);
    if (!communication) return res.status(404).render('errors/404', { title: 'Communication not found' });
    res.render('communications/edit', {
      title: 'Edit Communication',
      subtitle: communication.recipientName || communication.id,
      communication,
      enquiries,
      providers,
      statuses: communicationStatuses,
      formatDate,
      humanize
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await communicationService.updateCommunication(req.params.id, req.body, req.admin.email);
    res.redirect(`/communications/${req.params.id}?flash=Communication updated`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, newPage, create, show, edit, update };
