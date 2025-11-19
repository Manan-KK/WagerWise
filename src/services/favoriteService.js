const favoriteRepository = require('../repositories/favoriteRepository');

const parseRawRecipeData = (rawValue) => {
  if (!rawValue) {
    return {};
  }

  if (typeof rawValue === 'object') {
    return { ...rawValue };
  }

  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      console.error('Failed to parse stored recipe data:', error.message);
    }
  }

  return {};
};

const formatFavoriteRecipe = (row = {}) => {
  const rawData = parseRawRecipeData(row.raw_data);
  const formatted = {
    ...rawData,
    id: rawData.id || row.spoonacular_id,
    title: rawData.title || row.title,
    summary: rawData.summary || row.summary,
    servings: rawData.servings || row.servings,
    readyInMinutes: rawData.readyInMinutes || row.ready_in_minutes,
    pricePerServing:
      typeof rawData.pricePerServing === 'number'
        ? rawData.pricePerServing
        : typeof row.price_per_serving === 'number'
          ? Number(row.price_per_serving)
          : null,
    image: rawData.image || row.image_url,
    sourceUrl: rawData.sourceUrl || row.source_url,
    totalIngredientCost: rawData.totalIngredientCost,
    totalCostPerServing: rawData.totalCostPerServing,
    favoritedAt: row.favorited_at,
  };

  if (!formatted.extendedIngredients && rawData.extendedIngredients) {
    formatted.extendedIngredients = rawData.extendedIngredients;
  }

  return formatted;
};

const getUserFavoriteIds = async (userId) => {
  if (!userId) {
    return [];
  }

  try {
    const rows = await favoriteRepository.getFavoriteSpoonacularIds(userId);
    return rows
      .map((row) => Number(row.spoonacular_id))
      .filter((id) => !Number.isNaN(id));
  } catch (error) {
    console.error('Error fetching favorite ids:', error);
    return [];
  }
};

const getUserFavorites = async (userId) => {
  if (!userId) {
    return [];
  }

  try {
    const rows = await favoriteRepository.getFavoritesWithRecipes(userId);
    return rows.map(formatFavoriteRecipe);
  } catch (error) {
    console.error('Error fetching user favorites:', error);
    return [];
  }
};

const addFavorite = (userId, recipeId, spoonacularId) => {
  return favoriteRepository.addFavorite(userId, recipeId, spoonacularId);
};

const removeFavorite = (userId, spoonacularId) => {
  return favoriteRepository.removeFavorite(userId, spoonacularId);
};

module.exports = {
  getUserFavoriteIds,
  getUserFavorites,
  addFavorite,
  removeFavorite,
};
