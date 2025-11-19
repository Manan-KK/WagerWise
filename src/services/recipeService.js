const {
  getRecipeInformation,
  getRecipePriceBreakdown,
} = require('./spoonacularService');
const recipeRepository = require('../repositories/recipeRepository');
const { stripHtmlTags } = require('../utils/strings');

const normalizeApiRecipe = (recipeData = {}) => {
  if (!recipeData || typeof recipeData !== 'object') {
    return null;
  }

  const sanitizedSummary = stripHtmlTags(recipeData.summary);
  let normalizedPrice = null;

  if (recipeData.pricePerServing !== undefined && recipeData.pricePerServing !== null) {
    const numericPrice = Number(recipeData.pricePerServing);
    if (!Number.isNaN(numericPrice)) {
      normalizedPrice = Number((numericPrice / 100).toFixed(2));
    }
  }

  return {
    ...recipeData,
    id: recipeData.id || recipeData.spoonacular_id,
    summary: sanitizedSummary,
    pricePerServing: normalizedPrice,
  };
};

const recipeHasIngredientCost = (recipe) => {
  if (!recipe || !Array.isArray(recipe.extendedIngredients)) {
    return false;
  }

  return recipe.extendedIngredients.some((ingredient) => {
    const costValue = ingredient?.estimatedCost?.value;
    return typeof costValue === 'number' && !Number.isNaN(costValue);
  });
};

const applyPriceBreakdownToRecipe = (recipe, priceData) => {
  if (!recipe || !priceData) {
    return recipe;
  }

  if (Array.isArray(recipe.extendedIngredients) && Array.isArray(priceData.ingredients)) {
    const priceMap = new Map();
    priceData.ingredients.forEach((item) => {
      const key = (item.name || '').trim().toLowerCase();
      if (!key) {
        return;
      }
      const numericPrice = Number(item.price);
      if (Number.isNaN(numericPrice)) {
        return;
      }

      priceMap.set(key, {
        price: numericPrice,
        amount: item.amount,
        image: item.image,
      });
    });

    recipe.extendedIngredients = recipe.extendedIngredients.map((ingredient) => {
      if (!ingredient) {
        return ingredient;
      }

      const key = (ingredient.name || ingredient.original || '').trim().toLowerCase();
      const breakdown = priceMap.get(key);

      if (breakdown) {
        ingredient.estimatedCost = {
          value: breakdown.price,
          unit: 'US Cents',
          amount: breakdown.amount,
          image: breakdown.image,
        };
      }

      return ingredient;
    });
  }

  if (typeof priceData.totalCost === 'number') {
    recipe.totalIngredientCost = priceData.totalCost;
  }

  if (typeof priceData.totalCostPerServing === 'number') {
    recipe.totalCostPerServing = priceData.totalCostPerServing;
  }

  recipe.priceBreakdown = priceData;
  return recipe;
};

const saveRecipeToDatabase = async (recipe) => {
  if (!recipe || !recipe.id) {
    return null;
  }

  const payload = {
    spoonacularId: recipe.id,
    title: recipe.title || 'Untitled Recipe',
    description: recipe.summary || recipe.description || null,
    servings: recipe.servings || null,
    sourceUrl: recipe.sourceUrl || null,
    imageUrl: recipe.image || null,
    readyInMinutes: recipe.readyInMinutes || null,
    pricePerServing: typeof recipe.pricePerServing === 'number' ? recipe.pricePerServing : null,
    summary: recipe.summary || null,
    rawData: JSON.stringify(recipe),
  };

  try {
    await recipeRepository.upsertRecipe(payload);
  } catch (error) {
    console.error(`Error saving recipe ${recipe.id} to database:`, error.message || error);
  }

  return recipe;
};

const getCachedRecipesMap = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  try {
    const rows = await recipeRepository.findRawRecipesBySpoonacularIds(ids);
    return rows.reduce((acc, row) => {
      if (row.raw_data) {
        const recipe = {
          ...row.raw_data,
          id: row.raw_data.id || row.spoonacular_id,
        };
        acc.set(row.spoonacular_id, recipe);
      }
      return acc;
    }, new Map());
  } catch (error) {
    console.error('Error loading cached recipes:', error.message || error);
    return new Map();
  }
};

const ensureRecipeHasCostData = async (recipe) => {
  if (!recipe || recipeHasIngredientCost(recipe)) {
    return recipe;
  }

  try {
    const priceDataResponse = await getRecipePriceBreakdown(recipe.id);
    const priceData = priceDataResponse?.data;
    if (priceData) {
      const enriched = applyPriceBreakdownToRecipe(recipe, priceData);
      await saveRecipeToDatabase(enriched);
      return enriched;
    }
  } catch (error) {
    console.error(`Error enriching recipe ${recipe?.id} with cost data:`, error.response?.data || error.message);
  }

  return recipe;
};

const fetchRecipeFromApi = async (recipeId) => {
  try {
    const response = await getRecipeInformation(recipeId, { includeNutrition: true });
    let normalizedRecipe = normalizeApiRecipe(response.data);
    if (normalizedRecipe) {
      try {
        const priceResponse = await getRecipePriceBreakdown(recipeId);
        const priceData = priceResponse?.data;
        if (priceData) {
          normalizedRecipe = applyPriceBreakdownToRecipe(normalizedRecipe, priceData);
        }
      } catch (priceError) {
        console.error(`Error fetching price breakdown for recipe ${recipeId}:`, priceError.response?.data || priceError.message);
      }
    }
    if (normalizedRecipe) {
      await saveRecipeToDatabase(normalizedRecipe);
    }
    return normalizedRecipe;
  } catch (error) {
    console.error(`Error fetching recipe ${recipeId}:`, error.response?.data || error.message);
    return null;
  }
};

const getDetailedRecipes = async (recipeIds = []) => {
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    return [];
  }

  const cachedRecipes = await getCachedRecipesMap(recipeIds);
  const missingIds = recipeIds.filter((id) => !cachedRecipes.has(id));

  if (missingIds.length > 0) {
    const fetchedRecipes = await Promise.all(missingIds.map(fetchRecipeFromApi));
    fetchedRecipes.forEach((recipe) => {
      if (recipe && recipe.id) {
        cachedRecipes.set(recipe.id, recipe);
      }
    });
  }

  const orderedRecipes = recipeIds
    .map((id) => cachedRecipes.get(id))
    .filter((recipe) => Boolean(recipe));

  const enrichedRecipes = await Promise.all(
    orderedRecipes.map(async (recipe) => {
      try {
        return await ensureRecipeHasCostData(recipe);
      } catch (error) {
        console.error(`Error ensuring cost data for recipe ${recipe?.id}:`, error.response?.data || error.message);
        return recipe;
      }
    }),
  );

  return enrichedRecipes.filter((recipe) => Boolean(recipe));
};

const ensureRecipeRecord = async (recipeId) => {
  if (!recipeId) {
    return null;
  }

  let recipeRecord = await recipeRepository.getRecipeRecordId(recipeId);
  if (recipeRecord) {
    return recipeRecord.recipe_id;
  }

  await fetchRecipeFromApi(recipeId);
  recipeRecord = await recipeRepository.getRecipeRecordId(recipeId);

  return recipeRecord ? recipeRecord.recipe_id : null;
};

const buildGroceryList = (recipes = []) => {
  const ingredientMap = new Map();
  let totalEstimatedCost = 0;

  recipes.forEach((recipe) => {
    if (!recipe || !recipe.extendedIngredients) return;

    recipe.extendedIngredients.forEach((ingredient) => {
      const resolvedName = (ingredient.name || ingredient.original || '').trim();
      if (!resolvedName) {
        return;
      }

      const key = resolvedName.toLowerCase();
      const cost = ((ingredient.estimatedCost?.value) || 0) / 100;
      totalEstimatedCost += cost;

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key);
        existing.amount += ingredient.amount || 0;
        existing.recipes.push(recipe.title);
        if (cost > 0) {
          const previousCost = parseFloat(existing.estimatedCost) || 0;
          existing.estimatedCost = (previousCost + cost).toFixed(2);
        }
      } else {
        ingredientMap.set(key, {
          id: ingredient.id,
          name: ingredient.name || resolvedName,
          original: ingredient.original,
          amount: ingredient.amount || 0,
          unit: ingredient.unit || '',
          aisle: ingredient.aisle || 'Unknown',
          image: ingredient.image,
          estimatedCost: cost.toFixed(2),
          recipes: [recipe.title],
        });
      }
    });
  });

  const groceryList = Array.from(ingredientMap.values());
  groceryList.sort((a, b) => {
    if (a.aisle < b.aisle) return -1;
    if (a.aisle > b.aisle) return 1;
    return 0;
  });

  const groupedByAisle = {};
  groceryList.forEach((item) => {
    const aisle = item.aisle || 'Unknown';
    if (!groupedByAisle[aisle]) {
      groupedByAisle[aisle] = [];
    }
    groupedByAisle[aisle].push(item);
  });

  return {
    groceryList,
    groupedByAisle,
    totalEstimatedCost: totalEstimatedCost.toFixed(2),
  };
};

const sortRecipesByPreferences = (recipes, preferences) => {
  if (!recipes || recipes.length === 0) return recipes;
  if (!preferences) return recipes;

  const sorted = [...recipes];
  const sortBy = preferences.sort_by || 'relevance';
  const sortOrder = preferences.sort_order || 'asc';
  const isAscending = sortOrder === 'asc';

  const calculateScore = (recipe) => {
    const factors = preferences.priority_factors || { price: 1, time: 1, calories: 1, health: 1 };
    let score = 0;

    if (recipe.pricePerServing && factors.price) {
      score += (100 - (recipe.pricePerServing * 10)) * factors.price;
    }

    if (recipe.readyInMinutes && factors.time) {
      score += (100 - recipe.readyInMinutes) * factors.time;
    }

    if (recipe.nutrition?.nutrients) {
      const calories = recipe.nutrition.nutrients.find((n) => n.name === 'Calories');
      if (calories && factors.calories) {
        score += (calories.amount / 10) * factors.calories;
      }
    }

    if (recipe.healthScore && factors.health) {
      score += recipe.healthScore * factors.health;
    }

    return score;
  };

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'price': {
        const priceA = a.pricePerServing || Infinity;
        const priceB = b.pricePerServing || Infinity;
        comparison = priceA - priceB;
        break;
      }
      case 'time': {
        const timeA = a.readyInMinutes || Infinity;
        const timeB = b.readyInMinutes || Infinity;
        comparison = timeA - timeB;
        break;
      }
      case 'calories': {
        const calA = a.nutrition?.nutrients?.find((n) => n.name === 'Calories')?.amount || 0;
        const calB = b.nutrition?.nutrients?.find((n) => n.name === 'Calories')?.amount || 0;
        comparison = calA - calB;
        break;
      }
      case 'health': {
        const healthA = a.healthScore || 0;
        const healthB = b.healthScore || 0;
        comparison = healthB - healthA;
        break;
      }
      case 'popularity': {
        const popA = a.aggregateLikes || 0;
        const popB = b.aggregateLikes || 0;
        comparison = popB - popA;
        break;
      }
      case 'relevance':
      default:
        comparison = calculateScore(b) - calculateScore(a);
        break;
    }

    return isAscending ? comparison : -comparison;
  });

  return sorted;
};

module.exports = {
  normalizeApiRecipe,
  applyPriceBreakdownToRecipe,
  saveRecipeToDatabase,
  getDetailedRecipes,
  ensureRecipeRecord,
  buildGroceryList,
  sortRecipesByPreferences,
};
