const mongoose = require('mongoose');
const {
  addressSchema,
  communicationLogSchema,
  customerSchema,
  sourceInfoSchema,
  timelineSchema,
  toClientObject
} = require('./common');

const enquirySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  sourceWebsite: { type: String, default: 'manual-admin', index: true },
  source: { type: sourceInfoSchema, default: () => ({}) },
  categorySlug: { type: String, required: true, index: true },
  formType: { type: String, default: 'default', index: true },
  templateId: { type: String, default: '', index: true },
  serviceType: { type: String, default: 'General service request' },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  status: {
    type: String,
    enum: ['new', 'contacted', 'assigned', 'scheduled', 'in_progress', 'completed', 'cancelled', 'lost'],
    default: 'new',
    index: true
  },
  customer: { type: customerSchema, default: () => ({}) },
  address: { type: addressSchema, default: () => ({}) },
  preferredDate: { type: String, default: '' },
  preferredSlot: { type: String, default: '' },
  assignedProviderId: { type: String, default: '', index: true },
  assignedProviderName: { type: String, default: '' },
  quotedAmount: { type: Number, default: 0 },
  finalAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  fields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  timeline: { type: [timelineSchema], default: [] },
  communicationLog: { type: [communicationLogSchema], default: [] },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

enquirySchema.index({ categorySlug: 1, formType: 1, status: 1, createdAt: -1 });
enquirySchema.index({ sourceWebsite: 1, categorySlug: 1, createdAt: -1 });
enquirySchema.index({ 'customer.mobile': 1 });
enquirySchema.index({ 'source.externalEnquiryId': 1 }, { sparse: true });

module.exports = mongoose.model('Enquiry', enquirySchema);
