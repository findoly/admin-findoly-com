const mongoose = require('mongoose');
const { toClientObject, uuidPrimaryKey, attachUuidPrimaryKey } = require('./common');

const categorySchema = new mongoose.Schema({
  ...uuidPrimaryKey('cat'),
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, index: true, trim: true },
  sourceWebsite: { type: String, default: 'any', index: true, trim: true },
  formType: { type: String, default: 'default', index: true, trim: true },
  description: { type: String, default: '' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

categorySchema.index({ sourceWebsite: 1, slug: 1, formType: 1 }, { unique: true });
categorySchema.index({ sourceWebsite: 1, formType: 1, active: 1 });

attachUuidPrimaryKey(categorySchema, 'cat');

module.exports = mongoose.model('Category', categorySchema);
