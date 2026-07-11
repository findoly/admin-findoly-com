const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      formTemplateId: { type: String, unique: true, sparse: true, index: true },

name: { type: String, required: true },
slug: { type: String, default: '' },
categorySlug: { type: String, required: true, index: true },
formType: { type: String, default: 'default' },
sourceWebsite: { type: String, default: 'any' },
description: { type: String, default: '' },
fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
active: { type: Boolean, default: true }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'formtemplates' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'formTemplateId', 'form');
      next();
    });


    module.exports = mongoose.model('FormTemplate', schema, 'formtemplates');
