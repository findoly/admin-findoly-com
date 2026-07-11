const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      paymentOrderId: { type: String, unique: true, sparse: true, index: true },

providerId: { type: String, required: true, index: true },
gateway: { type: String, default: 'razorpay' },
gatewayOrderId: { type: String, required: true, unique: true, index: true },
gatewayPaymentId: { type: String, default: '', index: true },
amountPaise: { type: Number, required: true, min: 100 },
currency: { type: String, default: 'INR' },
status: { type: String, default: 'created', index: true },
signatureVerified: { type: Boolean, default: false },
walletCredited: { type: Boolean, default: false },
walletTransactionId: { type: String, default: '' },
receipt: { type: String, default: '' },
notes: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
paidAt: { type: Date, default: null },
creditedAt: { type: Date, default: null }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'paymentorders' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'paymentOrderId', 'pay_order');
      next();
    });
    schema.index({ providerId: 1, createdAt: -1 });

    module.exports = mongoose.model('PaymentOrder', schema, 'paymentorders');
