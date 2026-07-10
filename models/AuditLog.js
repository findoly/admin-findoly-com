const mongoose = require('mongoose');
const { toClientObject, uuidPrimaryKey, attachUuidPrimaryKey } = require('./common');

const auditLogSchema = new mongoose.Schema({
  ...uuidPrimaryKey('audit'),
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  actor: { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now, index: true }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

attachUuidPrimaryKey(auditLogSchema, 'audit');

module.exports = mongoose.model('AuditLog', auditLogSchema);
