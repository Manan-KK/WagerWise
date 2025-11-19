const express = require('express');

const favoriteController = require('../controllers/favoriteController');

const router = express.Router();

router.get('/favorites', favoriteController.listFavorites);
router.post('/favorites/add', favoriteController.addFavoriteHandler);
router.post('/favorites/remove', favoriteController.removeFavoriteHandler);

module.exports = router;
