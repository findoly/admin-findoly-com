const { Communication, Enquiry, FollowUp, Invoice, Provider } = require('../models');
const { paginateModel } = require('../utils/pagination');
const { addDateRange } = require('../utils/queryFilters');

const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 25;

async function searchAll(filters = {}) {
  const q = String(filters.q || filters.search || '').trim();
  const entity = String(filters.entity || 'all');
  const limit = Math.min(Number(filters.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, 100);

  const tasks = [];
  if (entity === 'all' || entity === 'enquiries') tasks.push(['enquiries', searchEnquiries(q, filters, limit)]);
  if (entity === 'all' || entity === 'providers') tasks.push(['providers', searchProviders(q, filters, limit)]);
  if (entity === 'all' || entity === 'followUps') tasks.push(['followUps', searchFollowUps(q, filters, limit)]);
  if (entity === 'all' || entity === 'communications') tasks.push(['communications', searchCommunications(q, filters, limit)]);
  if (entity === 'all' || entity === 'invoices') tasks.push(['invoices', searchInvoices(q, filters, limit)]);

  const resolved = await Promise.all(tasks.map(async ([key, promise]) => [key, await promise]));
  const results = {
    enquiries: [],
    providers: [],
    followUps: [],
    communications: [],
    invoices: []
  };
  for (const [key, value] of resolved) results[key] = value;
  results.total = Object.values(results).reduce((count, value) => Array.isArray(value) ? count + value.length : count, 0);
  return results;
}

async function searchEnquiries(q, filters = {}, limit = DEFAULT_LIMIT) {
  return Enquiry.find(buildEnquiryQuery(q, filters)).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
}

async function searchProviders(q, filters = {}, limit = DEFAULT_LIMIT) {
  return Provider.find(buildProviderQuery(q, filters)).sort({ updatedAt: -1, name: 1 }).limit(limit).lean();
}

async function searchFollowUps(q, filters = {}, limit = DEFAULT_LIMIT) {
  return FollowUp.find(buildFollowUpQuery(q, filters)).sort({ updatedAt: -1, dueAt: 1 }).limit(limit).lean();
}

async function searchCommunications(q, filters = {}, limit = DEFAULT_LIMIT) {
  return Communication.find(buildCommunicationQuery(q, filters)).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
}

async function searchInvoices(q, filters = {}, limit = DEFAULT_LIMIT) {
  return Invoice.find(buildInvoiceQuery(q, filters)).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).lean();
}

async function pagedEnquiries(filters = {}) {
  return paginateModel(Enquiry, buildEnquiryQuery(searchTerm(filters), filters), {
    page: filters.page,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
    sort: { updatedAt: -1, createdAt: -1 }
  });
}

async function pagedProviders(filters = {}) {
  return paginateModel(Provider, buildProviderQuery(searchTerm(filters), filters), {
    page: filters.page,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
    sort: { updatedAt: -1, name: 1 }
  });
}

async function pagedInvoices(filters = {}) {
  return paginateModel(Invoice, buildInvoiceQuery(searchTerm(filters), filters), {
    page: filters.page,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
    sort: { updatedAt: -1, createdAt: -1 }
  });
}

async function pagedFollowUps(filters = {}) {
  return paginateModel(FollowUp, buildFollowUpQuery(searchTerm(filters), filters), {
    page: filters.page,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
    sort: { updatedAt: -1, dueAt: 1 }
  });
}

async function pagedCommunications(filters = {}) {
  return paginateModel(Communication, buildCommunicationQuery(searchTerm(filters), filters), {
    page: filters.page,
    pageSize: filters.pageSize || DEFAULT_PAGE_SIZE,
    sort: { updatedAt: -1, createdAt: -1 }
  });
}

function buildEnquiryQuery(q, filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.sourceWebsite) query.sourceWebsite = filters.sourceWebsite;
  if (filters.categorySlug) query.categorySlug = filters.categorySlug;
  if (filters.formType) query.formType = filters.formType;
  if (filters.sourceChannel) query['source.channel'] = filters.sourceChannel;
  if (filters.mobile) query['customer.mobile'] = filters.mobile;
  addDateRange(query, 'createdAt', filters);
  if (q) {
    const regex = regexFor(q);
    query.$or = [
      { id: regex },
      { serviceType: regex },
      { formType: regex },
      { categorySlug: regex },
      { priority: regex },
      { status: regex },
      { notes: regex },
      { sourceWebsite: regex },
      { 'source.website': regex },
      { 'source.channel': regex },
      { 'source.campaign': regex },
      { 'source.formId': regex },
      { 'source.externalEnquiryId': regex },
      { 'source.utm.source': regex },
      { 'source.utm.medium': regex },
      { 'source.utm.campaign': regex },
      { 'customer.name': regex },
      { 'customer.mobile': regex },
      { 'customer.email': regex },
      { 'address.line1': regex },
      { 'address.city': regex },
      { 'address.state': regex },
      { 'address.pincode': regex },
    ];
  }
  return query;
}

function buildProviderQuery(q, filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.categorySlug) query.categorySlugs = filters.categorySlug;
  if (filters.city) query.city = regexFor(filters.city);
  addDateRange(query, 'createdAt', filters);
  if (q) {
    const regex = regexFor(q);
    query.$or = [
      { id: regex },
      { name: regex },
      { businessName: regex },
      { mobile: regex },
      { email: regex },
      { status: regex },
      { categorySlugs: regex },
      { skills: regex },
      { city: regex },
      { state: regex },
      { serviceAreas: regex },
      { availability: regex },
      { notes: regex }
    ];
  }
  return query;
}

function buildFollowUpQuery(q, filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.owner) query.owner = regexFor(filters.owner);
  addDateRange(query, 'dueAt', filters, { fromKeys: ['dueFrom', 'dateFrom', 'fromDate', 'from'], toKeys: ['dueTo', 'dateTo', 'toDate', 'to'] });
  if (q) {
    const regex = regexFor(q);
    query.$or = [
      { id: regex },
      { enquiryId: regex },
      { customerName: regex },
      { title: regex },
      { owner: regex },
      { channel: regex },
      { status: regex },
      { notes: regex }
    ];
  }
  return query;
}

function buildCommunicationQuery(q, filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.channel) query.channel = filters.channel;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.providerId) query.providerId = filters.providerId;
  addDateRange(query, 'createdAt', filters);
  if (q) {
    const regex = regexFor(q);
    query.$or = [
      { id: regex },
      { enquiryId: regex },
      { providerId: regex },
      { recipientName: regex },
      { recipientContact: regex },
      { channel: regex },
      { direction: regex },
      { message: regex },
      { status: regex }
    ];
  }
  return query;
}

function buildInvoiceQuery(q, filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  addDateRange(query, 'issueDate', filters, { dateOnly: true });
  if (q) {
    const regex = regexFor(q);
    query.$or = [
      { id: regex },
      { invoiceNo: regex },
      { enquiryId: regex },
      { customerName: regex },
      { providerName: regex },
      { status: regex },
      { notes: regex },
      { 'items.description': regex }
    ];
  }
  return query;
}

function searchTerm(filters = {}) {
  return String(filters.q || filters.search || '').trim();
}

function regexFor(value) {
  return new RegExp(escapeRegExp(value), 'i');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  searchAll,
  searchEnquiries,
  searchProviders,
  searchFollowUps,
  searchCommunications,
  searchInvoices,
  pagedEnquiries,
  pagedProviders,
  pagedInvoices,
  pagedFollowUps,
  pagedCommunications,
  buildEnquiryQuery,
  buildProviderQuery,
  buildInvoiceQuery,
  buildFollowUpQuery,
  buildCommunicationQuery
};
