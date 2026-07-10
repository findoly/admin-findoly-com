const searchService = require('../services/searchService');
const catalogService = require('../services/catalogService');
const { enquiryStatuses, providerStatuses, invoiceStatuses, followUpStatuses, communicationStatuses, priorities, humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');
const { buildPagination } = require('../utils/pagination');

async function index(req, res) {
  const q = req.query.q ? `?q=${encodeURIComponent(req.query.q)}` : '';
  return res.redirect(`/search/enquiries${q}`);
}

async function enquiries(req, res, next) {
  try {
    const [result, categories, sourceWebsites] = await Promise.all([
      searchService.pagedEnquiries(req.query),
      catalogService.listCategories(),
      catalogService.listSourceWebsites()
    ]);
    res.render('search/enquiries', {
      title: 'Requirement Search',
      subtitle: 'Search requirement records',
      records: result.items,
      pagination: buildPagination('/search/enquiries', req.query, result),
      categories,
      sourceWebsites,
      filters: req.query,
      statuses: enquiryStatuses,
      priorities,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function providers(req, res, next) {
  try {
    const [result, categories] = await Promise.all([
      searchService.pagedProviders(req.query),
      catalogService.listCategories()
    ]);
    res.render('search/providers', {
      title: 'Provider Search',
      subtitle: 'Search provider directory',
      records: result.items,
      pagination: buildPagination('/search/providers', req.query, result),
      categories,
      filters: req.query,
      statuses: providerStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function invoices(req, res, next) {
  try {
    const result = await searchService.pagedInvoices(req.query);
    res.render('search/invoices', {
      title: 'Invoice Search',
      subtitle: 'Search invoices and billing records',
      records: result.items,
      pagination: buildPagination('/search/invoices', req.query, result),
      filters: req.query,
      statuses: invoiceStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function followUps(req, res, next) {
  try {
    const result = await searchService.pagedFollowUps(req.query);
    res.render('search/followUps', {
      title: 'Follow-up Search',
      subtitle: 'Search follow-up tasks',
      records: result.items,
      pagination: buildPagination('/search/follow-ups', req.query, result),
      filters: req.query,
      statuses: followUpStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function communications(req, res, next) {
  try {
    const result = await searchService.pagedCommunications(req.query);
    res.render('search/communications', {
      title: 'Communication Search',
      subtitle: 'Search messages and communication logs',
      records: result.items,
      pagination: buildPagination('/search/communications', req.query, result),
      filters: req.query,
      statuses: communicationStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index, enquiries, providers, invoices, followUps, communications };
