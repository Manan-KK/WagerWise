const express = require('express');

const recipeController = require('../controllers/recipeController');

const router = express.Router();

router.get('/recipes/:recipeId', recipeController.viewRecipeDetail);

module.exports = router;
