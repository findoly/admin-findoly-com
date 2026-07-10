const express = require('express');
const controller = require('../controllers/enquiryController');
const router = express.Router();

router.get('/', controller.index);
router.get('/queue/:queueKey', controller.queue);
router.get('/new', controller.showCreate);
router.post('/', controller.create);
router.get('/:id/edit', controller.showEdit);
router.get('/:id', controller.show);
router.post('/:id', controller.update);
router.post('/:id/fields', controller.updateFields);
router.post('/:id/notes', controller.note);

module.exports = router;
