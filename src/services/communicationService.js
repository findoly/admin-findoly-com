const { Communication } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const audit = require('./auditService');

function buildCommunicationQuery(filters = {}) {
  const query = {};
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.providerId) query.providerId = filters.providerId;
  if (filters.channel) query.channel = filters.channel;
  if (filters.status) query.status = filters.status;
  if (filters.direction) query.direction = filters.direction;
  if (filters.q || filters.search) {
    const regex = regexFor(filters.q || filters.search);
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

async function listCommunications(filters = {}) {
  return Communication.find(buildCommunicationQuery(filters)).sort({ createdAt: -1 }).lean();
}

async function paginateCommunications(filters = {}) {
  return paginateModel(Communication, buildCommunicationQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { updatedAt: -1, createdAt: -1 }
  });
}

async function getCommunication(id) {
  return Communication.findOne({ id }).lean();
}

async function createCommunication(input, actor = 'admin') {
  const recordInput = {
    id: createId('comm'),
    enquiryId: input.enquiryId || '',
    providerId: input.providerId || '',
    recipientName: input.recipientName || '',
    recipientContact: input.recipientContact || '',
    channel: input.channel || 'call',
    direction: input.direction || 'outbound',
    message: input.message || '',
    status: input.status || 'logged',
    externalResponse: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const webhookResult = await forwardToWebhook(recordInput).catch((error) => ({ ok: false, error: error.message }));
  recordInput.externalResponse = webhookResult;
  recordInput.status = webhookResult?.ok === false ? 'logged_local_external_failed' : recordInput.status;

  const record = await Communication.create(recordInput);
  await audit.log('created', 'communication', record.id, { channel: record.channel, enquiryId: record.enquiryId }, actor);
  return record.toObject();
}

async function updateCommunication(id, input, actor = 'admin') {
  const update = {
    enquiryId: input.enquiryId || '',
    providerId: input.providerId || '',
    recipientName: input.recipientName || '',
    recipientContact: input.recipientContact || '',
    channel: input.channel || 'call',
    direction: input.direction || 'outbound',
    message: input.message || '',
    status: input.status || 'logged',
    updatedAt: nowIso()
  };
  const updated = await Communication.findOneAndUpdate({ id }, { $set: update }, { new: true, runValidators: true }).lean();
  await audit.log('updated', 'communication', id, input, actor);
  return updated;
}

async function forwardToWebhook(record) {
  const url = process.env.COMMUNICATION_WEBHOOK_URL;
  if (!url) return { skipped: true, reason: 'COMMUNICATION_WEBHOOK_URL not configured' };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.COMMUNICATION_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${process.env.COMMUNICATION_WEBHOOK_TOKEN}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: 'communication.created', communication: record })
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await safeText(response)
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}

function regexFor(value) {
  return new RegExp(escapeRegExp(value), 'i');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listCommunications,
  paginateCommunications,
  getCommunication,
  createCommunication,
  updateCommunication,
  buildCommunicationQuery
};
