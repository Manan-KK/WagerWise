const {
  getRecipeInformation,
  getRecipePriceBreakdown,
  searchRecipes: searchRecipesFromApi,
  searchRecipesByIngredients: searchRecipesByIngredientsFromApi,
} = require('./spoonacularService');
const recipeRepository = require('../repositories/recipeRepository');
const { stripHtmlTags } = require('../utils/strings');

const parseInteger = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseFloatValue = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const toCommaSeparatedArray = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => `${entry}`.trim()).filter((entry) => entry.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const normalizeDiet = (diet) => {
  if (!diet) {
    return undefined;
  }

  const normalized = diet.toLowerCase().replace(/[-_]+/g, ' ').trim();
  if (normalized === 'none' || normalized.length === 0) {
    return undefined;
  }

  return normalized;
};

const normalizeSearchFilters = (rawFilters = {}) => {
  const normalized = {
    number: Math.min(parseInteger(rawFilters.number) || 10, 100),
    query: (rawFilters.query || '').trim() || undefined,
    diet: normalizeDiet(rawFilters.diet),
    maxReadyTime: parseInteger(rawFilters.maxReadyTime),
    minCalories: parseInteger(rawFilters.minCalories),
    maxCalories: parseInteger(rawFilters.maxCalories),
    minPrice: parseFloatValue(rawFilters.minPrice),
    maxPrice: parseFloatValue(rawFilters.maxPrice),
    intolerances: toCommaSeparatedArray(rawFilters.intolerances).map((entry) => entry.toLowerCase()),
  };

  if (
    normalized.minPrice !== undefined
    && normalized.maxPrice !== undefined
    && normalized.minPrice > normalized.maxPrice
  ) {
    [normalized.minPrice, normalized.maxPrice] = [normalized.maxPrice, normalized.minPrice];
  }

  if (
    normalized.minCalories !== undefined
    && normalized.maxCalories !== undefined
    && normalized.minCalories > normalized.maxCalories
  ) {
    [normalized.minCalories, normalized.maxCalories] = [normalized.maxCalories, normalized.minCalories];
  }

  if (normalized.number < 1) {
    normalized.number = 1;
  }

  return normalized;
};

const normalizeIngredientSearchFilters = (rawFilters = {}) => {
  const baseFilters = normalizeSearchFilters(rawFilters);
  return {
    ...baseFilters,
    ingredients: toCommaSeparatedArray(rawFilters.ingredients || rawFilters.ingredientsList).map((entry) => entry.toLowerCase()),
    ranking: parseInteger(rawFilters.ranking) || undefined,
    ignorePantry:
      typeof rawFilters.ignorePantry === 'string'
        ? rawFilters.ignorePantry !== 'false'
        : rawFilters.ignorePantry !== false,
  };
};

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

const parseStoredRecipeRow = (row = {}) => {
  if (!row || !row.raw_data) {
    return null;
  }

  let rawData = row.raw_data;
  if (typeof rawData === 'string') {
    try {
      rawData = JSON.parse(rawData);
    } catch (error) {
      console.error('Failed to parse stored recipe JSON:', error.message);
      return null;
    }
  }

  const normalized = normalizeApiRecipe(rawData);
  if (!normalized) {
    return null;
  }

  if (!normalized.id) {
    normalized.id = row.spoonacular_id || row.recipe_id;
  }
  if ((normalized.pricePerServing === undefined || normalized.pricePerServing === null) && row.price_per_serving !== undefined) {
    normalized.pricePerServing = row.price_per_serving !== null ? Number(row.price_per_serving) : null;
  }
  if (!normalized.readyInMinutes && row.ready_in_minutes) {
    normalized.readyInMinutes = row.ready_in_minutes;
  }
  if (!normalized.summary && row.summary) {
    normalized.summary = row.summary;
  }

  return normalized;
};

const getCaloriesFromRecipe = (recipe) => {
  if (!recipe?.nutrition?.nutrients) {
    return null;
  }

  const caloriesEntry = recipe.nutrition.nutrients.find((nutrient) => nutrient?.name === 'Calories');
  if (!caloriesEntry) {
    return null;
  }

  const calories = Number(caloriesEntry.amount);
  return Number.isNaN(calories) ? null : calories;
};

const matchesDietPreference = (recipe, diet) => {
  if (!diet) {
    return true;
  }

  const normalizedDiet = diet.toLowerCase();
  if (!recipe) {
    return false;
  }

  const recipeDiets = Array.isArray(recipe.diets)
    ? recipe.diets.map((entry) => entry.toLowerCase())
    : [];

  if (recipeDiets.includes(normalizedDiet)) {
    return true;
  }

  switch (normalizedDiet) {
    case 'vegetarian':
      return recipe.vegetarian === true;
    case 'vegan':
      return recipe.vegan === true;
    case 'gluten free':
      return recipe.glutenFree === true;
    case 'dairy free':
      return recipe.dairyFree === true;
    case 'low fodmap':
      return recipe.lowFodmap === true;
    case 'whole30':
      return recipe.whole30 === true || recipeDiets.includes('whole30');
    case 'paleo':
      return recipeDiets.includes('paleolithic');
    case 'primal':
      return recipeDiets.includes('primal');
    case 'ketogenic':
      return recipe.ketogenic === true;
    default:
      return recipeDiets.includes(normalizedDiet);
  }
};

const matchesIntolerancePreference = (recipe, intoleranceList = []) => {
  if (!Array.isArray(intoleranceList) || intoleranceList.length === 0) {
    return true;
  }

  const recipeDiets = Array.isArray(recipe?.diets)
    ? recipe.diets.map((entry) => entry.toLowerCase())
    : [];

  return intoleranceList.every((rawIntolerance) => {
    const intolerance = rawIntolerance.trim().toLowerCase();
    if (!intolerance) {
      return true;
    }

    const booleanField = `${intolerance.replace(/\s+/g, '')}Free`;
    if (typeof recipe?.[booleanField] === 'boolean') {
      return recipe[booleanField];
    }

    if (recipeDiets.includes(`${intolerance} free`)) {
      return true;
    }

    // Without explicit metadata, we cannot confidently exclude the recipe.
    return true;
  });
};

const filterRecipesByConstraints = (recipes = [], filters = {}) => {
  return recipes.filter((recipe) => {
    if (!matchesDietPreference(recipe, filters.diet)) {
      return false;
    }

    if (!matchesIntolerancePreference(recipe, filters.intolerances)) {
      return false;
    }

    if (typeof filters.maxReadyTime === 'number') {
      if (typeof recipe.readyInMinutes !== 'number' || recipe.readyInMinutes > filters.maxReadyTime) {
        return false;
      }
    }

    if (typeof filters.minPrice === 'number') {
      if (typeof recipe.pricePerServing !== 'number' || recipe.pricePerServing < filters.minPrice) {
        return false;
      }
    }

    if (typeof filters.maxPrice === 'number') {
      if (typeof recipe.pricePerServing !== 'number' || recipe.pricePerServing > filters.maxPrice) {
        return false;
      }
    }

    const calories = getCaloriesFromRecipe(recipe);
    if (typeof filters.minCalories === 'number' && (calories === null || calories < filters.minCalories)) {
      return false;
    }

    if (typeof filters.maxCalories === 'number' && (calories === null || calories > filters.maxCalories)) {
      return false;
    }

    return true;
  });
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

const loadRecipesFromDatabase = async (filters = {}, limit = 20) => {
  try {
    const rows = await recipeRepository.searchStoredRecipes(filters, limit);
    return rows.map(parseStoredRecipeRow).filter((recipe) => Boolean(recipe));
  } catch (error) {
    console.error('Error searching recipes from local cache:', error.message || error);
    return [];
  }
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

const fetchRecipesFromApiWithDetails = async (filters, desiredCount) => {
  const requestSize = Math.min(Math.max(desiredCount, filters?.number || 10, 10), 100);
  const params = {
    number: requestSize,
    addRecipeInformation: true,
    addRecipeNutrition: true,
    fillIngredients: true,
  };

  if (filters?.query) {
    params.query = filters.query;
  }
  if (filters?.diet) {
    params.diet = filters.diet;
  }
  if (Array.isArray(filters?.intolerances) && filters.intolerances.length > 0) {
    params.intolerances = filters.intolerances.join(',');
  }
  if (typeof filters?.maxReadyTime === 'number') {
    params.maxReadyTime = filters.maxReadyTime;
  }
  if (typeof filters?.minCalories === 'number') {
    params.minCalories = filters.minCalories;
  }
  if (typeof filters?.maxCalories === 'number') {
    params.maxCalories = filters.maxCalories;
  }

  try {
    const response = await searchRecipesFromApi(params);
    const apiResults = response.data?.results || [];
    if (!Array.isArray(apiResults) || apiResults.length === 0) {
      return [];
    }

    await Promise.all(
      apiResults.map(async (recipe) => {
        const normalized = normalizeApiRecipe(recipe);
        if (normalized) {
          await saveRecipeToDatabase(normalized);
        }
      }),
    );

    const ids = apiResults
      .map((recipe) => recipe.id)
      .filter((id) => Number.isInteger(id));

    if (ids.length === 0) {
      return [];
    }

    return getDetailedRecipes(ids);
  } catch (error) {
    console.error('Error fetching recipes from Spoonacular:', error.response?.data || error.message);
    return [];
  }
};

const fetchRecipesByIngredientsFromApi = async (filters, desiredCount, seenIds = new Set()) => {
  const requestSize = Math.min(Math.max(desiredCount, filters?.number || 10, 5), 100);
  const params = {
    ingredients: (filters?.ingredients || []).join(','),
    number: requestSize,
    ranking: typeof filters?.ranking === 'number' ? filters.ranking : 1,
    ignorePantry: filters?.ignorePantry !== false,
  };

  if (!params.ingredients) {
    return [];
  }

  try {
    const response = await searchRecipesByIngredientsFromApi(params);
    const apiResults = Array.isArray(response.data) ? response.data : [];
    const ids = apiResults
      .map((recipe) => recipe.id)
      .filter((id) => Number.isInteger(id) && !seenIds.has(id));

    if (ids.length === 0) {
      return [];
    }

    return getDetailedRecipes(ids);
  } catch (error) {
    console.error('Error fetching recipes by ingredients:', error.response?.data || error.message);
    return [];
  }
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

const searchRecipesWithFallback = async (rawFilters = {}) => {
  const filters = normalizeSearchFilters(rawFilters);
  const localFetchLimit = Math.min(filters.number * 3, 90);
  const localRecipes = await loadRecipesFromDatabase(filters, localFetchLimit);
  const filteredLocal = filterRecipesByConstraints(localRecipes, filters);

  const results = [];
  const seenIds = new Set();

  filteredLocal.forEach((recipe) => {
    if (recipe && recipe.id && !seenIds.has(recipe.id)) {
      seenIds.add(recipe.id);
      results.push(recipe);
    }
  });

  if (results.length < filters.number) {
    const needed = filters.number - results.length;
    const apiRecipes = await fetchRecipesFromApiWithDetails(filters, Math.max(needed * 2, needed));
    const filteredApi = filterRecipesByConstraints(apiRecipes, filters);

    filteredApi.forEach((recipe) => {
      if (recipe && recipe.id && !seenIds.has(recipe.id)) {
        seenIds.add(recipe.id);
        results.push(recipe);
      }
    });
  }

  return results.slice(0, filters.number);
};

const searchRecipesByIngredientsWithFallback = async (rawFilters = {}) => {
  const filters = normalizeIngredientSearchFilters(rawFilters);
  if (!filters.ingredients || filters.ingredients.length === 0) {
    return [];
  }

  const localFilters = {
    ...filters,
    ingredients: filters.ingredients,
  };

  const localFetchLimit = Math.min(filters.number * 3, 90);
  const localRecipes = await loadRecipesFromDatabase(localFilters, localFetchLimit);
  const filteredLocal = filterRecipesByConstraints(localRecipes, filters);

  const results = [];
  const seenIds = new Set();

  filteredLocal.forEach((recipe) => {
    if (recipe && recipe.id && !seenIds.has(recipe.id)) {
      seenIds.add(recipe.id);
      results.push(recipe);
    }
  });

  if (results.length < filters.number) {
    const needed = filters.number - results.length;
    const apiRecipes = await fetchRecipesByIngredientsFromApi(filters, Math.max(needed * 2, needed), seenIds);
    const filteredApi = filterRecipesByConstraints(apiRecipes, filters);
    filteredApi.forEach((recipe) => {
      if (recipe && recipe.id && !seenIds.has(recipe.id)) {
        seenIds.add(recipe.id);
        results.push(recipe);
      }
    });
  }

  return results.slice(0, filters.number);
};

module.exports = {
  normalizeApiRecipe,
  applyPriceBreakdownToRecipe,
  saveRecipeToDatabase,
  getDetailedRecipes,
  ensureRecipeRecord,
  buildGroceryList,
  sortRecipesByPreferences,
  searchRecipesWithFallback,
  searchRecipesByIngredientsWithFallback,
};
