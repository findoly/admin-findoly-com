const express = require('express');
const controller = require('../controllers/catalogController');
const router = express.Router();
router.get('/categories', controller.categories);
router.post('/categories', controller.createCategory);
router.get('/templates', controller.templates);
router.post('/templates', controller.createTemplate);
router.get('/', (req, res) => res.redirect('/catalog/categories'));
module.exports = router;
