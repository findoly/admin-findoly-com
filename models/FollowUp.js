const mongoose = require('mongoose');
const { toClientObject, uuidPrimaryKey, attachUuidPrimaryKey } = require('./common');

const followUpSchema = new mongoose.Schema({
  ...uuidPrimaryKey('follow'),
  enquiryId: { type: String, default: '', index: true },
  customerName: { type: String, default: '' },
  title: { type: String, required: true },
  dueAt: { type: String, default: '', index: true },
  owner: { type: String, default: 'admin' },
  channel: { type: String, default: 'call' },
  status: { type: String, default: 'open', index: true },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

attachUuidPrimaryKey(followUpSchema, 'follow');

module.exports = mongoose.model('FollowUp', followUpSchema);
