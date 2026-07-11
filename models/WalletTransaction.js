const mongoose = require('mongoose');
    const { syncNamedId } = require('../utils/id');

    const data = {
      _id: { type: String },
      id: { type: String, index: true },
      walletTransactionId: { type: String, unique: true, sparse: true, index: true },

providerId: { type: String, required: true, index: true },
type: { type: String, required: true, index: true },
amountPaise: { type: Number, required: true, min: 1 },
currency: { type: String, default: 'INR' },
balanceBeforePaise: { type: Number, required: true, min: 0 },
balanceAfterPaise: { type: Number, required: true, min: 0 },
status: { type: String, default: 'posted', index: true },
source: { type: String, required: true },
referenceId: { type: String, default: '', index: true },
idempotencyKey: { type: String, required: true, unique: true, index: true },
description: { type: String, default: '' },
metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }

    };

    const schema = new mongoose.Schema(data, { timestamps: true, strict: false, collection: 'wallettransactions' });
    schema.pre('validate', function syncId(next) {
      syncNamedId(this, 'walletTransactionId', 'wallet_txn');
      next();
    });
    schema.index({ providerId: 1, createdAt: -1 });

    module.exports = mongoose.model('WalletTransaction', schema, 'wallettransactions');
