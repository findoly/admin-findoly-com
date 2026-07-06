const { FollowUp } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');
const { paginateModel } = require('../utils/pagination');
const audit = require('./auditService');

function buildFollowUpQuery(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  if (filters.enquiryId) query.enquiryId = filters.enquiryId;
  if (filters.owner) query.owner = regexFor(filters.owner);
  if (filters.channel) query.channel = filters.channel;
  if (filters.q || filters.search) {
    const regex = regexFor(filters.q || filters.search);
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

async function listFollowUps(filters = {}) {
  return FollowUp.find(buildFollowUpQuery(filters)).sort({ dueAt: 1, createdAt: 1 }).lean();
}

async function paginateFollowUps(filters = {}) {
  return paginateModel(FollowUp, buildFollowUpQuery(filters), {
    page: filters.page,
    pageSize: filters.pageSize || 25,
    sort: { updatedAt: -1, dueAt: 1, createdAt: -1 }
  });
}

async function getFollowUp(id) {
  return FollowUp.findOne({ id }).lean();
}

async function createFollowUp(input, actor = 'admin') {
  const record = await FollowUp.create({
    id: createId('fu'),
    enquiryId: input.enquiryId || '',
    customerName: input.customerName || '',
    title: input.title,
    dueAt: input.dueAt || '',
    owner: input.owner || actor,
    channel: input.channel || 'call',
    status: input.status || 'open',
    notes: input.notes || '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await audit.log('created', 'followUp', record.id, { title: record.title }, actor);
  return record.toObject();
}

async function updateFollowUp(id, input, actor = 'admin') {
  const update = {
    enquiryId: input.enquiryId || '',
    customerName: input.customerName || '',
    title: input.title,
    dueAt: input.dueAt || '',
    owner: input.owner || actor,
    channel: input.channel || 'call',
    status: input.status || 'open',
    notes: input.notes || '',
    updatedAt: nowIso()
  };

  Object.keys(update).forEach((key) => update[key] === undefined && delete update[key]);

  const updated = await FollowUp.findOneAndUpdate(
    { id },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  await audit.log('updated', 'followUp', id, input, actor);
  return updated;
}

async function updateFollowUpStatus(id, status, actor = 'admin') {
  const updated = await FollowUp.findOneAndUpdate(
    { id },
    { $set: { status, updatedAt: nowIso() } },
    { new: true, runValidators: true }
  ).lean();
  await audit.log('updated', 'followUp', id, { status }, actor);
  return updated;
}

function regexFor(value) {
  return new RegExp(escapeRegExp(value), 'i');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listFollowUps,
  paginateFollowUps,
  getFollowUp,
  createFollowUp,
  updateFollowUp,
  updateFollowUpStatus,
  buildFollowUpQuery
};
