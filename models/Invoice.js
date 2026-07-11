const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      invoiceId: { type: String, unique: true, sparse: true, index: true },

invoiceNo: { type: String, required: true, unique: true, index: true },
enquiryId: { type: String, default: '', index: true },
customerName: { type: String, default: '' },
providerName: { type: String, default: '' },
status: { type: String, default: 'draft', index: true },
issueDate: { type: String, default: '' },
dueDate: { type: String, default: '' },
items: { type: [mongoose.Schema.Types.Mixed], default: [] },
subtotal: { type: Number, default: 0 },
discount: { type: Number, default: 0 },
tax: { type: Number, default: 0 },
total: { type: Number, default: 0 },
notes: { type: String, default: '' }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'invoices' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'invoiceId', 'inv');
      next();
    });


    module.exports = mongoose.model('Invoice', schema, 'invoices');
