const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      communicationId: { type: String, unique: true, sparse: true, index: true },

enquiryId: { type: String, default: '', index: true },
providerId: { type: String, default: '', index: true },
recipientName: { type: String, default: '' },
recipientContact: { type: String, default: '' },
channel: { type: String, default: 'call', index: true },
direction: { type: String, default: 'outbound' },
message: { type: String, default: '' },
status: { type: String, default: 'logged' },
externalResponse: { type: mongoose.Schema.Types.Mixed, default: null }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'communications' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'communicationId', 'comm');
      next();
    });


    module.exports = mongoose.model('Communication', schema, 'communications');
