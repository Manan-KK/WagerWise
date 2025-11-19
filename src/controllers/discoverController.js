const {
  getDetailedRecipes,
  buildGroceryList,
  sortRecipesByPreferences,
  searchRecipesWithFallback,
  searchRecipesByIngredientsWithFallback,
} = require('../services/recipeService');
const { getUserPreferences } = require('../services/preferencesService');
const { getUserFavoriteIds } = require('../services/favoriteService');

const renderDiscoverLanding = async (req, res) => {
  const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
  res.render('pages/discover', {
    user: req.session.user,
    results: null,
    searchParams: null,
    favoriteRecipeIds,
  });
};

const handleRecipeSearch = async (req, res) => {
  try {
    const { ingredients, number = 10 } = req.body;
    const limit = Math.min(parseInt(number, 10) || 10, 100);

    if (ingredients) {
      const ingredientQuery = new URLSearchParams({
        ingredients,
        number: limit,
      });
      return res.redirect(`/discover/ingredients?${ingredientQuery.toString()}`);
    }

    const recipes = await searchRecipesWithFallback({ ...req.body, number: limit });
    const preferences = await getUserPreferences(req.session.user.id);
    const sortedRecipes = sortRecipesByPreferences(recipes, preferences);
    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);

    return res.render('pages/discover', {
      user: req.session.user,
      results: sortedRecipes,
      searchParams: req.body,
      message:
        sortedRecipes.length > 0
          ? `Found ${sortedRecipes.length} recipes!`
          : 'No recipes found. Try adjusting your search criteria.',
      error: sortedRecipes.length === 0,
      favoriteRecipeIds,
    });
  } catch (error) {
    console.error('Error searching recipes:', error.response?.data || error.message);
    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
    return res.render('pages/discover', {
      user: req.session.user,
      results: null,
      searchParams: req.body,
      message: 'Error searching recipes. Please try again.',
      error: true,
      favoriteRecipeIds,
    });
  }
};

const handleIngredientSearch = async (req, res) => {
  try {
    const { ingredients } = req.query;
    const limit = Math.min(parseInt(req.query.number, 10) || 10, 100);

    if (!ingredients) {
      const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        searchParams: req.query,
        message: 'Please provide at least one ingredient to search.',
        error: true,
        favoriteRecipeIds,
      });
    }

    const recipes = await searchRecipesByIngredientsWithFallback({
      ...req.query,
      ingredients,
      number: limit,
    });

    const preferences = await getUserPreferences(req.session.user.id);
    const sortedRecipes = sortRecipesByPreferences(recipes, preferences);

    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);

    return res.render('pages/discover', {
      user: req.session.user,
      results: sortedRecipes,
      searchParams: { ...req.query, ingredients },
      message:
        sortedRecipes.length > 0
          ? `Found ${sortedRecipes.length} recipes!`
          : 'No recipes found. Try different ingredients.',
      error: sortedRecipes.length === 0,
      favoriteRecipeIds,
    });
  } catch (error) {
    console.error('Error searching by ingredients:', error.response?.data || error.message);
    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
    return res.render('pages/discover', {
      user: req.session.user,
      results: null,
      searchParams: req.query,
      message: 'Error searching recipes. Please try again.',
      error: true,
      favoriteRecipeIds,
    });
  }
};

const handleGroceryList = async (req, res) => {
  try {
    const rawRecipeIds = req.body.recipeIds;
    const recipeIds = (Array.isArray(rawRecipeIds) ? rawRecipeIds : rawRecipeIds ? [rawRecipeIds] : [])
      .map((id) => parseInt(id, 10))
      .filter((id) => !Number.isNaN(id));

    if (recipeIds.length === 0) {
      const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        message: 'Please select at least one recipe.',
        error: true,
        favoriteRecipeIds,
      });
    }

    let recipes = await getDetailedRecipes(recipeIds);

    if (recipes.length === 0) {
      const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        message: 'Unable to load the selected recipes. Please try searching again.',
        error: true,
        favoriteRecipeIds,
      });
    }

    const preferences = await getUserPreferences(req.session.user.id);
    recipes = sortRecipesByPreferences(recipes, preferences);

    const { groceryList, groupedByAisle, totalEstimatedCost } = buildGroceryList(recipes);

    return res.render('pages/grocery-list', {
      user: req.session.user,
      recipes: recipes.filter((r) => r !== null),
      groceryList,
      groupedByAisle,
      totalEstimatedCost,
    });
  } catch (error) {
    console.error('Error generating grocery list:', error.response?.data || error.message);
    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);
    return res.render('pages/discover', {
      user: req.session.user,
      results: null,
      message: 'Error generating grocery list. Please try again.',
      error: true,
      favoriteRecipeIds,
    });
  }
};

module.exports = {
  renderDiscoverLanding,
  handleRecipeSearch,
  handleIngredientSearch,
  handleGroceryList,
};
