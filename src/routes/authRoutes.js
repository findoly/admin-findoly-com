const express = require('express');
const controller = require('../controllers/authController');

const router = express.Router();
router.get('/login', controller.showLogin);
router.post('/login', controller.login);
router.post('/logout', controller.logout);
router.get('/logout', controller.logout);

module.exports = router;
