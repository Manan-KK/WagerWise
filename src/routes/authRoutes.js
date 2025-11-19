const express = require('express');

const authController = require('../controllers/authController');

const router = express.Router();

router.get('/', authController.redirectRoot);
router.get('/register', authController.renderRegister);
router.post('/register', authController.handleRegister);
router.get('/login', authController.renderLogin);
router.post('/login', authController.handleLogin);
router.get('/logout', authController.handleLogout);

module.exports = router;
