const mongoose = require('mongoose');
const { createId } = require('../utils/ids');

const { Schema } = mongoose;

const timelineSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  message: { type: String, default: '' },
  actor: { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const customerSchema = new Schema({
  name: { type: String, default: '' },
  mobile: { type: String, default: '' },
  email: { type: String, default: '' }
}, { _id: false });

const addressSchema = new Schema({
  line1: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' }
}, { _id: false });

const utmSchema = new Schema({
  source: { type: String, default: '' },
  medium: { type: String, default: '' },
  campaign: { type: String, default: '' },
  term: { type: String, default: '' },
  content: { type: String, default: '' }
}, { _id: false });

const sourceInfoSchema = new Schema({
  website: { type: String, default: 'manual-admin' },
  channel: { type: String, default: '' },
  sourceType: { type: String, default: '' },
  sourceName: { type: String, default: '' },
  campaign: { type: String, default: '' },
  formId: { type: String, default: '' },
  landingPage: { type: String, default: '' },
  referrer: { type: String, default: '' },
  externalEnquiryId: { type: String, default: '' },
  utm: { type: utmSchema, default: () => ({}) },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) }
}, { _id: false });

const communicationLogSchema = new Schema({
  id: { type: String, required: true },
  channel: { type: String, default: 'call' },
  direction: { type: String, default: 'outbound' },
  message: { type: String, default: '' },
  actor: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const templateFieldSchema = new Schema({
  name: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, default: 'text' },
  required: { type: Boolean, default: false },
  options: [{ type: String }],
  placeholder: { type: String, default: '' },
  helpText: { type: String, default: '' },
  group: { type: String, default: 'Details' },
  defaultValue: { type: Schema.Types.Mixed, default: '' },
  validation: { type: Schema.Types.Mixed, default: () => ({}) }
}, { _id: false });

function toClientObject(doc, ret) {
  // Public APIs and EJS views should use `id` only. Mongo `_id` stays internal and is a string UUID, not ObjectId.
  delete ret._id;
  delete ret.__v;
  return ret;
}

function uuidPrimaryKey(prefix) {
  return {
    _id: {
      type: String,
      default() {
        return this.id || createId(prefix);
      }
    },
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default() {
        return this._id || createId(prefix);
      }
    }
  };
}

function attachUuidPrimaryKey(schema, prefix) {
  schema.pre('validate', function syncUuidPrimaryKey(next) {
    if (!this.id && !this._id) {
      this.id = createId(prefix);
    }
    if (!this.id && this._id) {
      this.id = String(this._id);
    }
    if (!this._id && this.id) {
      this._id = this.id;
    }
    if (this.isNew && this.id && this._id !== this.id) {
      this._id = this.id;
    }
    next();
  });
}

module.exports = {
  timelineSchema,
  customerSchema,
  addressSchema,
  sourceInfoSchema,
  communicationLogSchema,
  templateFieldSchema,
  toClientObject,
  uuidPrimaryKey,
  attachUuidPrimaryKey
};
