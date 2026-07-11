const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      categoryId: { type: String, unique: true, sparse: true, index: true },

name: { type: String, required: true, trim: true },
slug: { type: String, required: true, trim: true, index: true },
sourceWebsite: { type: String, default: 'any' },
formType: { type: String, default: 'default' },
description: { type: String, default: '' },
active: { type: Boolean, default: true }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'categories' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'categoryId', 'cat');
      next();
    });
    schema.index({ slug: 1, sourceWebsite: 1 }, { unique: true });

    module.exports = mongoose.model('Category', schema, 'categories');
