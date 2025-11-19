const { spoonacularRequest } = require('../config/spoonacular');

const searchRecipes = (params = {}) => {
  return spoonacularRequest('/recipes/complexSearch', params);
};

const searchRecipesByIngredients = (params = {}) => {
  return spoonacularRequest('/recipes/findByIngredients', params);
};

const getRecipeInformation = (recipeId, params = {}) => {
  return spoonacularRequest(`/recipes/${recipeId}/information`, params);
};

const getRecipePriceBreakdown = (recipeId) => {
  return spoonacularRequest(`/recipes/${recipeId}/priceBreakdownWidget.json`);
};

module.exports = {
  searchRecipes,
  searchRecipesByIngredients,
  getRecipeInformation,
  getRecipePriceBreakdown,
};
