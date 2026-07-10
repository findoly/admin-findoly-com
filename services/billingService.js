const { Invoice } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const { addDateRange } = require('../utils/queryFilters');
const audit = require('./auditService');
const { findOneByPublicId, updateOneByPublicId } = require('../repositories/publicIdRepository');

async function listInvoices(filters = {}) {
  return Invoice.find(buildInvoiceListQuery(filters)).sort({ createdAt: -1 }).lean();
}

async function paginateInvoices(filters = {}) {
  return paginateModel(Invoice, buildInvoiceListQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { createdAt: -1 }
  });
}

function buildInvoiceListQuery(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  addDateRange(query, 'issueDate', filters, { dateOnly: true });
  if (filters.search || filters.q) {
    const regex = new RegExp(escapeRegExp(filters.search || filters.q), 'i');
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

async function getInvoice(id) {
  return findOneByPublicId(Invoice, id);
}

async function createInvoice(input, actor = 'admin') {
  const items = parseItems(input.items);
  const subtotal = items.reduce((sum, item) => sum + Number(item.qty || 1) * Number(item.rate || 0), 0);
  const discount = Number(input.discount || 0);
  const tax = Number(input.tax || 0);
  const total = Math.max(0, subtotal - discount + tax);
  const record = await Invoice.create({
    id: createId('inv'),
    invoiceNo: input.invoiceNo || `INV-${Date.now()}`,
    enquiryId: input.enquiryId || '',
    customerName: input.customerName || '',
    providerName: input.providerName || '',
    status: input.status || 'draft',
    issueDate: input.issueDate || nowIso().slice(0, 10),
    dueDate: input.dueDate || '',
    items,
    subtotal,
    discount,
    tax,
    total,
    notes: input.notes || '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await audit.log('created', 'invoice', record.id, { invoiceNo: record.invoiceNo, total }, actor);
  return record.toObject();
}

async function updateInvoice(id, input, actor = 'admin') {
  const update = { ...input, updatedAt: nowIso() };
  if (input.items) {
    const items = parseItems(input.items);
    const subtotal = items.reduce((sum, item) => sum + Number(item.qty || 1) * Number(item.rate || 0), 0);
    const discount = Number(input.discount || 0);
    const tax = Number(input.tax || 0);
    update.items = items;
    update.subtotal = subtotal;
    update.discount = discount;
    update.tax = tax;
    update.total = Math.max(0, subtotal - discount + tax);
  }
  const updated = await updateOneByPublicId(Invoice, id, { $set: update });
  await audit.log('updated', 'invoice', id, input, actor);
  return updated;
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [{ description: 'Service charge', qty: 1, rate: 0 }];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [description, qty = '1', rate = '0'] = line.split('|').map((part) => part.trim());
          return { description, qty: Number(qty), rate: Number(rate) };
        });
    }
  }
  return [{ description: 'Service charge', qty: 1, rate: 0 }];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { listInvoices, paginateInvoices, getInvoice, createInvoice, updateInvoice, parseItems };
