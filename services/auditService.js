const { AuditLog } = require('../models');
const { createId } = require('../utils/ids');
const { nowIso } = require('../utils/dates');

async function log(action, entityType, entityId, details = {}, actor = 'system') {
  const record = await AuditLog.create({
    id: createId('audit'),
    action,
    entityType,
    entityId,
    details,
    actor,
    createdAt: nowIso()
  });
  await trimAuditLogs(1000);
  return record.toObject();
}

async function list(limit = 100) {
  return AuditLog.find({}).sort({ createdAt: -1 }).limit(Number(limit || 100)).lean({ virtuals: false });
}

async function trimAuditLogs(maxRows) {
  const extra = await AuditLog.find({}).sort({ createdAt: -1 }).skip(maxRows).select('id').lean();
  if (extra.length) await AuditLog.deleteMany({ id: { $in: extra.map((row) => row.id) } });
}

module.exports = { log, list };
