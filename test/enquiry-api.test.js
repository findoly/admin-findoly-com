require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { connectDb, disconnectDb } = require('../src/db/mongoose');
const { AuditLog, Enquiry } = require('../src/models');

const configuredUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI || '';
const hasMongoUri = configuredUri.startsWith('mongodb') && !configuredUri.includes('<db_user>') && !configuredUri.includes('<cluster-name>');
const runMongoIntegration = hasMongoUri && process.env.RUN_MONGO_INTEGRATION === 'true';

test('POST /api/enquiries stores dynamic fields, form type and source info in MongoDB', { skip: !runMongoIntegration }, async () => {
  process.env.MONGODB_URI = configuredUri;
  await connectDb();

  const externalEnquiryId = `test-${Date.now()}`;
  await Enquiry.deleteMany({ 'source.externalEnquiryId': externalEnquiryId });
  await AuditLog.deleteMany({ entityId: externalEnquiryId });

  const payload = {
    source: {
      website: 'woodoly.com',
      channel: 'landing-page',
      campaign: 'woodoly-launch',
      formId: 'painting-quote',
      landingPage: 'https://woodoly.com/painting/gurugram',
      referrer: 'https://google.com',
      externalEnquiryId,
      utm: {
        source: 'google',
        medium: 'cpc',
        campaign: 'gurugram-painting'
      },
      metadata: {
        sourceIp: '127.0.0.1',
        browser: 'test-runner'
      }
    },
    categorySlug: 'wall-painting',
    formType: 'painting-quote',
    serviceType: '2BHK repainting',
    priority: 'high',
    customer: {
      name: 'Integration Test Customer',
      mobile: '9999999999',
      email: 'integration@example.com'
    },
    address: {
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001'
    },
    fields: {
      propertyType: 'Apartment',
      rooms: 3,
      wallCondition: 'Dampness near balcony',
      photos: ['https://example.com/wall.jpg']
    },
    notes: 'Created by automated integration test.'
  };

  const response = await request(app)
    .post('/api/enquiries')
    .send(payload)
    .expect(201);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.sourceWebsite, 'woodoly.com');
  assert.equal(response.body.data.formType, 'painting-quote');
  assert.equal(response.body.data.source.channel, 'landing-page');
  assert.equal(response.body.data.source.utm.campaign, 'gurugram-painting');
  assert.equal(response.body.data.customer.mobile, '9999999999');
  assert.equal(response.body.data.categorySlug, 'wall-painting');
  assert.equal(response.body.data.fields.propertyType, 'Apartment');
  assert.equal(response.body.data.fields.rooms, 3);

  const saved = await Enquiry.findOne({ id: response.body.data.id }).lean();
  assert.ok(saved);
  assert.equal(saved.source.externalEnquiryId, externalEnquiryId);
  assert.deepEqual(saved.fields.photos, ['https://example.com/wall.jpg']);

  await Enquiry.deleteOne({ id: response.body.data.id });
  await disconnectDb();
});

test('normalises website-specific formData as dynamic fields without requiring fixed columns', async () => {
  const { normaliseEnquiry } = require('../src/services/enquiryService');
  const enquiry = normaliseEnquiry({
    id: 'enq_unit_test',
    sourceWebsite: 'woodoly.com',
    sourceChannel: 'partner-api',
    categorySlug: 'furniture-repair',
    formType: 'wardrobe-repair',
    mobile: '9888888888',
    formData: {
      workType: 'Wardrobe repair',
      material: 'Plywood',
      measurements: '6x4 ft'
    }
  });

  assert.equal(enquiry.sourceWebsite, 'woodoly.com');
  assert.equal(enquiry.source.channel, 'partner-api');
  assert.equal(enquiry.customer.mobile, '9888888888');
  assert.equal(enquiry.categorySlug, 'furniture-repair');
  assert.equal(enquiry.formType, 'wardrobe-repair');
  assert.equal(enquiry.fields.workType, 'Wardrobe repair');
  assert.equal(enquiry.fields.measurements, '6x4 ft');
});

test('field completion reports missing required dynamic fields but does not block saving', async () => {
  const catalogService = require('../src/services/catalogService');
  const enquiry = {
    fields: {
      workType: 'Wardrobe repair',
      furnitureItem: 'Sliding wardrobe'
    }
  };
  const template = {
    fields: [
      { name: 'workType', label: 'Work type', required: true, type: 'select' },
      { name: 'furnitureItem', label: 'Furniture item', required: true, type: 'text' },
      { name: 'issueDescription', label: 'Issue description', required: true, type: 'textarea' },
      { name: 'photos', label: 'Photo/file URL', required: false, type: 'file_url' }
    ]
  };

  const completion = catalogService.getFieldCompletion(enquiry, template);
  assert.equal(completion.requiredCount, 3);
  assert.equal(completion.completedRequiredCount, 2);
  assert.equal(completion.missingRequired.length, 1);
  assert.equal(completion.missingRequired[0].name, 'issueDescription');
});
