const mongoose = require('mongoose');
const { toClientObject } = require('./common');

const invoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  qty: { type: Number, default: 1 },
  rate: { type: Number, default: 0 }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  invoiceNo: { type: String, required: true, unique: true, index: true },
  enquiryId: { type: String, default: '', index: true },
  customerName: { type: String, default: '' },
  providerName: { type: String, default: '' },
  status: { type: String, default: 'draft', index: true },
  issueDate: { type: String, default: '' },
  dueDate: { type: String, default: '' },
  items: { type: [invoiceItemSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

module.exports = mongoose.model('Invoice', invoiceSchema);
