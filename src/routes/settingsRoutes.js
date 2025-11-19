const express = require('express');

const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.get('/settings', settingsController.showSettingsPage);
router.post('/settings/username', settingsController.updateUsername);
router.post('/settings/password', settingsController.updatePassword);
router.post('/settings/preferences', settingsController.updatePreferences);

module.exports = router;
