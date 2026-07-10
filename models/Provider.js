const mongoose = require('mongoose');
const { toClientObject, uuidPrimaryKey, attachUuidPrimaryKey } = require('./common');

const providerSchema = new mongoose.Schema({
  ...uuidPrimaryKey('provider'),
  name: { type: String, required: true, trim: true },
  businessName: { type: String, default: '' },
  mobile: { type: String, default: '' },
  email: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive', 'pending', 'verification_pending', 'blocked'], default: 'active', index: true },
  onboardingStage: { type: String, enum: ['new', 'documents_pending', 'training_pending', 'ready', 'paused'], default: 'new', index: true },
  categorySlugs: { type: [String], default: [], index: true },
  skills: { type: [String], default: [] },
  city: { type: String, default: '', index: true },
  state: { type: String, default: '' },
  serviceAreas: { type: [String], default: [] },
  availability: { type: String, default: 'available_today' },
  rating: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  documentsVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { toJSON: { transform: toClientObject }, toObject: { transform: toClientObject } });

providerSchema.index({ name: 'text', businessName: 'text', mobile: 'text', email: 'text', city: 'text', skills: 'text' });

attachUuidPrimaryKey(providerSchema, 'provider');

module.exports = mongoose.model('Provider', providerSchema);
