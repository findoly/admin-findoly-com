const mongoose = require('mongoose');
const { sourceInfoSchema, templateFieldSchema, toClientObject } = require('./common');

const formTemplateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  slug: { type: String, default: '', index: true },
  categorySlug: { type: String, required: true, index: true },
  formType: { type: String, default: 'default', index: true },
  sourceWebsite: { type: String, default: 'any', index: true },
  source: { type: sourceInfoSchema, default: () => ({}) },
  description: { type: String, default: '' },
  fields: { type: [templateFieldSchema], default: [] },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

formTemplateSchema.index({ sourceWebsite: 1, categorySlug: 1, formType: 1, active: 1 });
formTemplateSchema.index({ sourceWebsite: 1, categorySlug: 1, formType: 1 }, { unique: false });
formTemplateSchema.index({ sourceWebsite: 1, slug: 1 });

module.exports = mongoose.model('FormTemplate', formTemplateSchema);
