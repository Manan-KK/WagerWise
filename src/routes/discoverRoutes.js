const express = require('express');

const discoverController = require('../controllers/discoverController');

const router = express.Router();

router.get('/discover', discoverController.renderDiscoverLanding);
router.post('/discover/search', discoverController.handleRecipeSearch);
router.get('/discover/ingredients', discoverController.handleIngredientSearch);
router.post('/discover/grocery-list', discoverController.handleGroceryList);

module.exports = router;
