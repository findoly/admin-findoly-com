const express = require('express');
const controller = require('../controllers/billingController');
const router = express.Router();

router.get('/', controller.index);
router.get('/new', controller.newPage);
router.post('/', controller.create);
router.get('/:id', controller.show);
router.get('/:id/edit', controller.edit);
router.post('/:id', controller.update);

module.exports = router;
