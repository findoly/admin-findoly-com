const mongoose = require('mongoose');
const { toClientObject } = require('./common');

const auditLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  actor: { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now, index: true }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

module.exports = mongoose.model('AuditLog', auditLogSchema);
