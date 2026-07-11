const test=require('node:test');const assert=require('node:assert/strict');process.env.SKIP_DB='true';const app=require('../app');
test('CRM has separate frontend and API routes',()=>{assert.equal(typeof app,'function');assert.ok(require('../routes/frontend'));assert.ok(require('../routes/main'));});
test('models use named collection IDs',()=>{assert.ok(require('../models/Enquiry').schema.path('enquiryId'));assert.ok(require('../models/Provider').schema.path('providerId'));});
