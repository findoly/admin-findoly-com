const express = require('express');
const controller = require('../controllers/searchController');
const router = express.Router();

router.get('/', controller.index);
router.get('/enquiries', controller.enquiries);
router.get('/requirements', controller.enquiries);
router.get('/providers', controller.providers);
router.get('/invoices', controller.invoices);
router.get('/follow-ups', controller.followUps);
router.get('/communications', controller.communications);

module.exports = router;
