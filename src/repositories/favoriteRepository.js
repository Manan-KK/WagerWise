const { db } = require('../config/db');

const getFavoriteSpoonacularIds = (userId) => {
  if (!userId) {
    return Promise.resolve([]);
  }
  return db.any(
    'SELECT spoonacular_id FROM user_favorite_recipes WHERE user_id = $1',
    [userId],
  );
};

const getFavoritesWithRecipes = (userId) => {
  return db.any(
    `SELECT 
      f.created_at AS favorited_at,
      r.spoonacular_id,
      r.title,
      r.description,
      r.servings,
      r.source_url,
      r.image_url,
      r.ready_in_minutes,
      r.price_per_serving,
      r.summary,
      r.raw_data
     FROM user_favorite_recipes f
     JOIN recipes r ON r.recipe_id = f.recipe_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId],
  );
};

const addFavorite = (userId, recipeId, spoonacularId) => {
  return db.none(
    `INSERT INTO user_favorite_recipes (user_id, recipe_id, spoonacular_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, spoonacular_id) DO NOTHING`,
    [userId, recipeId, spoonacularId],
  );
};

const removeFavorite = (userId, spoonacularId) => {
  return db.none(
    'DELETE FROM user_favorite_recipes WHERE user_id = $1 AND spoonacular_id = $2',
    [userId, spoonacularId],
  );
};

module.exports = {
  getFavoriteSpoonacularIds,
  getFavoritesWithRecipes,
  addFavorite,
  removeFavorite,
};
