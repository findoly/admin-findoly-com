const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      followUpId: { type: String, unique: true, sparse: true, index: true },

enquiryId: { type: String, default: '', index: true },
customerName: { type: String, default: '' },
title: { type: String, required: true },
dueAt: { type: String, default: '', index: true },
owner: { type: String, default: 'admin' },
channel: { type: String, default: 'call' },
status: { type: String, default: 'open', index: true },
notes: { type: String, default: '' }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'followups' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'followUpId', 'follow');
      next();
    });


    module.exports = mongoose.model('FollowUp', schema, 'followups');
