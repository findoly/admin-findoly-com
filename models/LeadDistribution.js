const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      leadDistributionId: { type: String, unique: true, sparse: true, index: true },

requirementId: { type: String, required: true, index: true },
providerId: { type: String, required: true, index: true },
categorySlug: { type: String, required: true, index: true },
status: { type: String, default: 'offered', index: true },
leadPricePaise: { type: Number, required: true, min: 0 },
currency: { type: String, default: 'INR' },
contactUnlocked: { type: Boolean, default: false, index: true },
leadTitle: { type: String, default: '' },
serviceType: { type: String, default: '' },
category: { type: String, default: '' },
city: { type: String, default: '' },
state: { type: String, default: '' },
pincode: { type: String, default: '' },
preferredDate: { type: String, default: '' },
preferredSlot: { type: String, default: '' },
priority: { type: String, default: 'normal' },
sourceWebsite: { type: String, default: '' },
customerName: { type: String, default: '' },
customerMobile: { type: String, default: '' },
customerEmail: { type: String, default: '' },
customerAddress: { type: String, default: '' },
providerName: { type: String, default: '' },
providerBusinessName: { type: String, default: '' },
providerMobile: { type: String, default: '' },
additionalDetails: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
distributedBy: { type: String, default: 'system' },
distributedAt: { type: Date, default: Date.now, index: true },
unlockedAt: { type: Date, default: null },
expiresAt: { type: Date, default: null },
walletTransactionId: { type: String, default: '' },
leadPreview: { type: mongoose.Schema.Types.Mixed, default: undefined },
contactSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
providerSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'leaddistributions' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'leadDistributionId', 'dist');
      next();
    });
    schema.index({ requirementId: 1, providerId: 1 }, { unique: true });

    module.exports = mongoose.model('LeadDistribution', schema, 'leaddistributions');
