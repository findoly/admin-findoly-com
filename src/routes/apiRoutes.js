const express = require('express');
const controller = require('../controllers/apiController');
const router = express.Router();

router.get('/health', controller.health);
router.get('/catalog', controller.listCatalog);
router.get('/forms/schema', controller.getFormSchema);
router.get('/form-schema', controller.getFormSchema);
router.post('/enquiries', controller.createEnquiry);
router.get('/enquiries', controller.listEnquiries);
router.get('/enquiries/:id', controller.getEnquiry);
router.post('/enquiries/:id/assign', controller.assignProvider);
router.get('/providers', controller.listProviders);
router.get('/follow-ups', controller.listFollowUps);
router.get('/follow-ups/:id', controller.getFollowUp);
router.get('/communications', controller.listCommunications);
router.get('/communications/:id', controller.getCommunication);
router.get('/invoices', controller.listInvoices);
router.get('/invoices/:id', controller.getInvoice);
router.post('/webhooks/communication', controller.communicationWebhook);

module.exports = router;
