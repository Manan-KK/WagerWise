const { searchRecipes, searchRecipesByIngredients } = require('../services/spoonacularService');
const {
  getDetailedRecipes,
  buildGroceryList,
  sortRecipesByPreferences,
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
    const {
      query,
      diet,
      intolerances,
      ingredients,
      maxReadyTime,
      minCalories,
      maxCalories,
      minPrice,
      maxPrice,
      number = 10,
    } = req.body;

    const params = {
      number: Math.min(parseInt(number, 10) || 10, 100),
      addRecipeInformation: true,
      addRecipeNutrition: true,
      addRecipePrice: true,
    };

    if (query) params.query = query;
    if (diet && diet !== 'none') params.diet = diet;
    if (intolerances) params.intolerances = intolerances;
    if (maxReadyTime) params.maxReadyTime = parseInt(maxReadyTime, 10);
    if (minCalories) params.minCalories = parseInt(minCalories, 10);
    if (maxCalories) params.maxCalories = parseInt(maxCalories, 10);
    if (minPrice) params.minPrice = parseFloat(minPrice);
    if (maxPrice) params.maxPrice = parseFloat(maxPrice);

    if (ingredients) {
      const ingredientQuery = new URLSearchParams({
        ingredients,
        number: params.number,
      });
      return res.redirect(`/discover/ingredients?${ingredientQuery.toString()}`);
    }

    const response = await searchRecipes(params);
    const searchResults = response.data.results || [];
    const recipeIds = searchResults.map((recipe) => recipe.id).filter((id) => !!id);
    const limitedRecipeIds = recipeIds.slice(0, 20);
    let detailedRecipes = await getDetailedRecipes(limitedRecipeIds);

    const preferences = await getUserPreferences(req.session.user.id);
    detailedRecipes = sortRecipesByPreferences(detailedRecipes, preferences);

    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);

    return res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes,
      searchParams: req.body,
      message:
        detailedRecipes.length > 0
          ? `Found ${detailedRecipes.length} recipes!`
          : 'No recipes found. Try adjusting your search criteria.',
      error: detailedRecipes.length === 0,
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
    const params = {
      ingredients,
      number: Math.min(parseInt(req.query.number, 10) || 10, 100),
      ranking: 1,
      ignorePantry: true,
    };

    const response = await searchRecipesByIngredients(params);
    const recipes = response.data || [];
    const recipeIds = recipes.map((recipe) => recipe.id).filter((id) => !!id);
    let detailedRecipes = await getDetailedRecipes(recipeIds.slice(0, 20));

    const preferences = await getUserPreferences(req.session.user.id);
    detailedRecipes = sortRecipesByPreferences(detailedRecipes, preferences);

    const favoriteRecipeIds = await getUserFavoriteIds(req.session.user.id);

    return res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes,
      searchParams: { ingredients },
      message:
        detailedRecipes.length > 0
          ? `Found ${detailedRecipes.length} recipes!`
          : 'No recipes found. Try different ingredients.',
      error: detailedRecipes.length === 0,
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
