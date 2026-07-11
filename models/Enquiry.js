const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      enquiryId: { type: String, unique: true, sparse: true, index: true },

recordType: { type: String, default: 'requirement', index: true },
name: { type: String, default: '', trim: true },
mobile: { type: String, default: '', trim: true, index: true },
email: { type: String, default: '', trim: true, lowercase: true },
addressLine: { type: String, default: '', trim: true },
city: { type: String, default: '', trim: true, index: true },
state: { type: String, default: '', trim: true },
pincode: { type: String, default: '', trim: true },
category: { type: String, default: '', trim: true },
categorySlug: { type: String, required: true, trim: true, index: true },
serviceType: { type: String, default: '', trim: true },
requirementTitle: { type: String, default: '', trim: true },
priority: { type: String, default: 'normal', index: true },
status: { type: String, default: 'new', index: true },
preferredDate: { type: String, default: '' },
preferredSlot: { type: String, default: '' },
leadPricePaise: { type: Number, default: 10000, min: 0, index: true },
currency: { type: String, default: 'INR' },
sourceWebsite: { type: String, default: 'manual-admin', index: true },
sourceChannel: { type: String, default: 'admin' },
sourceType: { type: String, default: 'manual' },
sourceName: { type: String, default: '' },
campaign: { type: String, default: '' },
externalEnquiryId: { type: String, default: '', index: true },
notes: { type: String, default: '' },
additionalDetails: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
timeline: { type: [mongoose.Schema.Types.Mixed], default: [] },
communicationLog: { type: [mongoose.Schema.Types.Mixed], default: [] },
distributionCount: { type: Number, default: 0 },
unlockedCount: { type: Number, default: 0 },
distributedAt: { type: Date, default: null },
customer: { type: mongoose.Schema.Types.Mixed, default: undefined },
address: { type: mongoose.Schema.Types.Mixed, default: undefined },
source: { type: mongoose.Schema.Types.Mixed, default: undefined },
fields: { type: mongoose.Schema.Types.Mixed, default: undefined }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'enquiries' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'enquiryId', 'req');
      next();
    });
    schema.index({ status: 1, categorySlug: 1, createdAt: -1 });

    module.exports = mongoose.model('Enquiry', schema, 'enquiries');
