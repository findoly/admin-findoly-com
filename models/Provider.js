const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      providerId: { type: String, unique: true, sparse: true, index: true },

name: { type: String, required: true, trim: true },
businessName: { type: String, default: '', trim: true },
mobile: { type: String, default: '', trim: true },
normalizedMobile: { type: String, default: '', trim: true, index: true },
email: { type: String, default: '', trim: true, lowercase: true },
status: { type: String, default: 'active', index: true },
onboardingStage: { type: String, default: 'new', index: true },
categorySlugs: { type: [String], default: [], index: true },
skills: { type: [String], default: [] },
city: { type: String, default: '', index: true },
state: { type: String, default: '' },
serviceAreas: { type: [String], default: [] },
availability: { type: String, default: 'available_today' },
rating: { type: Number, default: 0 },
notes: { type: String, default: '' },
documentsVerified: { type: Boolean, default: false },
portalAccessEnabled: { type: Boolean, default: true, index: true },
walletBalancePaise: { type: Number, default: 0, min: 0 },
walletCurrency: { type: String, default: 'INR' },
walletUpdatedAt: { type: Date, default: null },
lastLoginAt: { type: Date, default: null }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'providers' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'providerId', 'provider');
      next();
    });
    schema.index({ categorySlugs: 1, status: 1, portalAccessEnabled: 1 });

    module.exports = mongoose.model('Provider', schema, 'providers');
