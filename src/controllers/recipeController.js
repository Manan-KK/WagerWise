const { getDetailedRecipes } = require('../services/recipeService');
const { getUserFavoriteIds } = require('../services/favoriteService');

const mapInstructions = (recipe = {}) => {
  const instructionBlocks = Array.isArray(recipe.analyzedInstructions)
    ? recipe.analyzedInstructions
    : [];

  const extractedSteps = instructionBlocks
    .flatMap((block) => Array.isArray(block?.steps) ? block.steps : [])
    .map((step, index) => ({
      number: step.number || index + 1,
      description: typeof step.step === 'string' ? step.step.trim() : '',
    }))
    .filter((step) => step.description.length > 0);

  if (extractedSteps.length > 0) {
    return extractedSteps;
  }

  if (typeof recipe.instructions === 'string' && recipe.instructions.trim().length > 0) {
    return recipe.instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => ({ number: index + 1, description: line }));
  }

  return [];
};

const renderNotFound = (req, res) => {
  return res.status(404).render('pages/recipe-detail', {
    user: req.session.user,
    recipe: null,
    instructions: [],
    isFavorite: false,
    error: 'Recipe not found. It may have been removed.',
  });
};

const viewRecipeDetail = async (req, res) => {
  const recipeId = parseInt(req.params.recipeId, 10);
  if (Number.isNaN(recipeId)) {
    return renderNotFound(req, res);
  }

  try {
    const recipes = await getDetailedRecipes([recipeId]);
    const recipe = recipes[0];

    if (!recipe) {
      return renderNotFound(req, res);
    }

    const favoriteIds = await getUserFavoriteIds(req.session.user.id);
    const instructions = mapInstructions(recipe);

    return res.render('pages/recipe-detail', {
      user: req.session.user,
      recipe,
      instructions,
      isFavorite: favoriteIds.includes(recipeId),
      error: null,
    });
  } catch (error) {
    console.error(`Error rendering recipe ${req.params.recipeId}:`, error);
    return res.status(500).render('pages/recipe-detail', {
      user: req.session.user,
      recipe: null,
      instructions: [],
      isFavorite: false,
      error: 'Unable to load this recipe right now. Please try again later.',
    });
  }
};

module.exports = {
  viewRecipeDetail,
};
