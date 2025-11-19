const {
  getUserFavorites,
  getUserFavoriteIds,
  addFavorite,
  removeFavorite,
} = require('../services/favoriteService');
const { ensureRecipeRecord } = require('../services/recipeService');
const { getSafeRedirectPath } = require('../utils/navigation');

const listFavorites = async (req, res) => {
  try {
    const favorites = await getUserFavorites(req.session.user.id);
    res.render('pages/favorites', {
      user: req.session.user,
      favorites,
      favoriteRecipeIds: favorites.map((recipe) => recipe.id),
      error: false,
      message: favorites.length === 0 ? 'Save recipes to build your personal cookbook!' : null,
    });
  } catch (error) {
    console.error('Error rendering favorites page:', error);
    res.render('pages/favorites', {
      user: req.session.user,
      favorites: [],
      favoriteRecipeIds: [],
      error: true,
      message: 'Unable to load your favorite recipes right now. Please try again.',
    });
  }
};

const addFavoriteHandler = async (req, res) => {
  const userId = req.session.user.id;
  const recipeId = parseInt(req.body.recipeId, 10);
  const redirectPath = getSafeRedirectPath(req, '/discover');

  if (!recipeId) {
    return res.redirect(redirectPath);
  }

  try {
    const recipeRecordId = await ensureRecipeRecord(recipeId);
    if (!recipeRecordId) {
      return res.redirect(redirectPath);
    }

    await addFavorite(userId, recipeRecordId, recipeId);
  } catch (error) {
    console.error('Error saving favorite recipe:', error);
  }

  return res.redirect(redirectPath);
};

const removeFavoriteHandler = async (req, res) => {
  const userId = req.session.user.id;
  const recipeId = parseInt(req.body.recipeId, 10);
  const redirectPath = getSafeRedirectPath(req, '/favorites');

  if (!recipeId) {
    return res.redirect(redirectPath);
  }

  try {
    await removeFavorite(userId, recipeId);
  } catch (error) {
    console.error('Error removing favorite recipe:', error);
  }

  return res.redirect(redirectPath);
};

module.exports = {
  listFavorites,
  addFavoriteHandler,
  removeFavoriteHandler,
};
