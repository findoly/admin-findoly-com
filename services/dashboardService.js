const enquiryService = require('./enquiryService');
const providerService = require('./providerService');
const followUpService = require('./followUpService');
const billingService = require('./billingService');
const catalogService = require('./catalogService');
const { Enquiry, FollowUp, Provider, Invoice } = require('../models');
const { enquiryQueues } = require('../utils/status');

async function getDashboard() {
  const [enquiries, providers, followUps, invoices, categories] = await Promise.all([
    enquiryService.listEnquiries(),
    providerService.listProviders(),
    followUpService.listFollowUps(),
    billingService.listInvoices(),
    catalogService.listCategories()
  ]);

  const byStatus = countBy(enquiries, 'status');
  const queueCounts = buildQueueCounts(byStatus);
  const byCategory = countBy(enquiries, 'categorySlug');
  const bySource = countBy(enquiries, 'sourceWebsite');
  const openFollowUps = followUps.filter((item) => item.status === 'open');
  const revenue = invoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);

  const newBookingEnquiries = enquiries.filter((enquiry) => enquiry.status === 'new').slice(0, 12);

  return {
    counts: {
      enquiries: enquiries.length,
      newEnquiries: byStatus.new || 0,
      approved: byStatus.approved || 0,
      completed: byStatus.completed || 0,
      providers: providers.length,
      openFollowUps: openFollowUps.length,
      invoices: invoices.length,
      paidRevenue: revenue,
      categories: categories.length
    },
    recentEnquiries: enquiries.slice(0, 8),
    newBookingEnquiries,
    openFollowUps: openFollowUps.slice(0, 8),
    queueCounts,
    byStatus,
    byCategory,
    bySource
  };
}

function buildQueueCounts(byStatus = {}) {
  return enquiryQueues.reduce((acc, queue) => {
    acc[queue.key] = queue.statuses.reduce((sum, status) => sum + Number(byStatus[status] || 0), 0);
    return acc;
  }, {});
}

async function getNavigationCounts() {
  const defaults = {
    queues: enquiryQueues.reduce((acc, queue) => ({ ...acc, [queue.key]: 0 }), {}),
    enquiries: 0,
    providers: 0,
    openFollowUps: 0,
    invoices: 0
  };

  try {
    const statuses = ['new', 'verification_pending', 'verified', 'approved', 'distributed', 'in_progress', 'completed', 'rejected', 'closed', 'contacted', 'assigned', 'scheduled', 'cancelled', 'lost'];
    const [statusCounts, providerCount, openFollowUps, invoiceCount] = await Promise.all([
      Promise.all(statuses.map(async (status) => [status, await Enquiry.countDocuments({ status })])),
      Provider.countDocuments({}),
      FollowUp.countDocuments({ status: 'open' }),
      Invoice.countDocuments({})
    ]);

    const byStatus = statusCounts.reduce((acc, [status, count]) => {
      if (count) acc[status] = count;
      return acc;
    }, {});

    return {
      queues: buildQueueCounts(byStatus),
      enquiries: Object.values(byStatus).reduce((sum, count) => sum + Number(count || 0), 0),
      providers: providerCount,
      openFollowUps,
      invoices: invoiceCount
    };
  } catch (error) {
    return defaults;
  }
}

function countBy(records, key) {
  return records.reduce((acc, record) => {
    const value = record[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

module.exports = { getDashboard, getNavigationCounts, buildQueueCounts, countBy };
