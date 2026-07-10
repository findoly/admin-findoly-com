const billingService = require('../services/billingService');
const enquiryService = require('../services/enquiryService');
const { invoiceStatuses, humanize } = require('../utils/status');
const { formatDate } = require('../utils/dates');
const { buildPagination } = require('../utils/pagination');

async function index(req, res, next) {
  try {
    const result = await billingService.paginateInvoices(req.query);
    res.render('billing/index', {
      title: 'Billing',
      subtitle: 'Invoice list',
      invoices: result.items,
      pagination: buildPagination('/billing', req.query, result),
      statuses: invoiceStatuses,
      filters: req.query,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function newPage(req, res, next) {
  try {
    const enquiries = await enquiryService.listEnquiries({});
    res.render('billing/new', {
      title: 'Create Invoice',
      subtitle: 'New billing record',
      invoice: {},
      enquiries,
      statuses: invoiceStatuses,
      humanize,
      formatDate
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const invoice = await billingService.createInvoice(req.body, req.admin.email);
    res.redirect(`/billing/${invoice.id}?flash=Invoice created`);
  } catch (error) {
    next(error);
  }
}

async function show(req, res, next) {
  try {
    const invoice = await billingService.getInvoice(req.params.id);
    if (!invoice) return res.status(404).render('errors/404', { title: 'Invoice not found' });
    const enquiry = invoice.enquiryId ? await enquiryService.getEnquiry(invoice.enquiryId) : null;
    res.render('billing/show', { title: invoice.invoiceNo, subtitle: 'Invoice detail', invoice, enquiry, statuses: invoiceStatuses, humanize, formatDate });
  } catch (error) {
    next(error);
  }
}

async function edit(req, res, next) {
  try {
    const [invoice, enquiries] = await Promise.all([
      billingService.getInvoice(req.params.id),
      enquiryService.listEnquiries({})
    ]);
    if (!invoice) return res.status(404).render('errors/404', { title: 'Invoice not found' });
    res.render('billing/edit', { title: 'Edit Invoice', subtitle: invoice.invoiceNo, invoice, enquiries, statuses: invoiceStatuses, humanize, formatDate });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    await billingService.updateInvoice(req.params.id, req.body, req.admin.email);
    res.redirect(`/billing/${req.params.id}?flash=Invoice updated`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, newPage, create, show, edit, update };
