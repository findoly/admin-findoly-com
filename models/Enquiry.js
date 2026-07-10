const mongoose = require('mongoose');
const {
  addressSchema,
  communicationLogSchema,
  customerSchema,
  sourceInfoSchema,
  templateFieldSchema,
  timelineSchema,
  toClientObject,
  uuidPrimaryKey,
  attachUuidPrimaryKey
} = require('./common');

const categoryMappingSchema = new mongoose.Schema({
  slug: { type: String, default: '', index: true },
  name: { type: String, default: '' },
  formType: { type: String, default: 'default' },
  sourceWebsite: { type: String, default: 'manual-admin' }
}, { _id: false });


const enquirySchema = new mongoose.Schema({
  ...uuidPrimaryKey('req'),

  // Fixed requirement fields: these stay the same for every category, like core product fields in WordPress/WooCommerce.
  recordType: { type: String, default: 'requirement', index: true },
  sourceWebsite: { type: String, default: 'manual-admin', index: true },
  source: { type: sourceInfoSchema, default: () => ({}) },
  categorySlug: { type: String, required: true, index: true },
  category: { type: categoryMappingSchema, default: () => ({}) },
  formType: { type: String, default: 'default', index: true },
  templateId: { type: String, default: '', index: true },
  serviceType: { type: String, default: 'General service requirement' },
  requirementTitle: { type: String, default: '' },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  status: {
    type: String,
    enum: ['new', 'verification_pending', 'verified', 'approved', 'distributed', 'in_progress', 'completed', 'rejected', 'closed', 'contacted', 'assigned', 'scheduled', 'cancelled', 'lost'],
    default: 'new',
    index: true
  },
  customer: { type: customerSchema, default: () => ({}) },
  address: { type: addressSchema, default: () => ({}) },
  preferredDate: { type: String, default: '' },
  preferredSlot: { type: String, default: '' },
  quotedAmount: { type: Number, default: 0 },
  finalAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },

  // Flexible category-specific requirement data, like WordPress post meta/product attributes.
  // Use additionalDetails going forward. `fields` stays as a backward-compatible mirror for old integrations.
  additionalDetails: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  fieldDefinitions: { type: [templateFieldSchema], default: [] },
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
enquirySchema.index({ recordType: 1, status: 1, createdAt: -1 });
enquirySchema.index({ 'category.slug': 1, status: 1, createdAt: -1 });

attachUuidPrimaryKey(enquirySchema, 'req');

module.exports = mongoose.model('Enquiry', enquirySchema);
