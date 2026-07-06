const mongoose = require('mongoose');
const { toClientObject } = require('./common');

const communicationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  enquiryId: { type: String, default: '', index: true },
  providerId: { type: String, default: '', index: true },
  recipientName: { type: String, default: '' },
  recipientContact: { type: String, default: '' },
  channel: { type: String, default: 'call', index: true },
  direction: { type: String, default: 'outbound' },
  message: { type: String, default: '' },
  status: { type: String, default: 'logged' },
  externalResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

module.exports = mongoose.model('Communication', communicationSchema);
