const { db } = require('../config/db');

const upsertRecipe = (recipe) => {
  return db.one(
    `INSERT INTO recipes (
      spoonacular_id,
      title,
      description,
      servings,
      source_url,
      image_url,
      ready_in_minutes,
      price_per_serving,
      summary,
      raw_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (spoonacular_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      servings = EXCLUDED.servings,
      source_url = EXCLUDED.source_url,
      image_url = EXCLUDED.image_url,
      ready_in_minutes = EXCLUDED.ready_in_minutes,
      price_per_serving = EXCLUDED.price_per_serving,
      summary = EXCLUDED.summary,
      raw_data = EXCLUDED.raw_data,
      updated_at = NOW()
    RETURNING recipe_id`,
    [
      recipe.spoonacularId,
      recipe.title,
      recipe.description,
      recipe.servings,
      recipe.sourceUrl,
      recipe.imageUrl,
      recipe.readyInMinutes,
      recipe.pricePerServing,
      recipe.summary,
      recipe.rawData,
    ],
  );
};

const findRawRecipesBySpoonacularIds = (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return Promise.resolve([]);
  }
  return db.any(
    'SELECT spoonacular_id, raw_data FROM recipes WHERE spoonacular_id IN ($1:csv)',
    [ids],
  );
};

const getRecipeRecordId = (spoonacularId) => {
  if (!spoonacularId) {
    return Promise.resolve(null);
  }
  return db.oneOrNone(
    'SELECT recipe_id FROM recipes WHERE spoonacular_id = $1',
    [spoonacularId],
  );
};

const buildSearchClauses = (filters = {}) => {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  const pushCondition = (sql, value) => {
    conditions.push(sql.replace(/__IDX__/g, `$${paramIndex}`));
    values.push(value);
    paramIndex += 1;
  };

  if (filters.query) {
    pushCondition(
      '(LOWER(title) LIKE __IDX__ OR LOWER(summary) LIKE __IDX__)',
      `%${filters.query.toLowerCase()}%`,
    );
  }

  if (filters.diet) {
    pushCondition(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(raw_data->'diets', '[]'::jsonb)) diet
        WHERE LOWER(diet) = LOWER(__IDX__)
      )`,
      filters.diet,
    );
  }

  if (typeof filters.maxReadyTime === 'number' && !Number.isNaN(filters.maxReadyTime)) {
    pushCondition(
      'ready_in_minutes IS NOT NULL AND ready_in_minutes <= __IDX__',
      filters.maxReadyTime,
    );
  }

  if (typeof filters.minPrice === 'number' && !Number.isNaN(filters.minPrice)) {
    pushCondition(
      'price_per_serving IS NOT NULL AND price_per_serving >= __IDX__',
      filters.minPrice,
    );
  }

  if (typeof filters.maxPrice === 'number' && !Number.isNaN(filters.maxPrice)) {
    pushCondition(
      'price_per_serving IS NOT NULL AND price_per_serving <= __IDX__',
      filters.maxPrice,
    );
  }

  if (typeof filters.minCalories === 'number' && !Number.isNaN(filters.minCalories)) {
    pushCondition(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(raw_data->'nutrition'->'nutrients', '[]'::jsonb)
        ) nutrient
        WHERE nutrient->>'name' = 'Calories'
          AND (nutrient->>'amount')::numeric >= __IDX__
      )`,
      filters.minCalories,
    );
  }

  if (typeof filters.maxCalories === 'number' && !Number.isNaN(filters.maxCalories)) {
    pushCondition(
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(raw_data->'nutrition'->'nutrients', '[]'::jsonb)
        ) nutrient
        WHERE nutrient->>'name' = 'Calories'
          AND (nutrient->>'amount')::numeric <= __IDX__
      )`,
      filters.maxCalories,
    );
  }

  if (Array.isArray(filters.ingredients) && filters.ingredients.length > 0) {
    filters.ingredients.forEach((ingredient) => {
      const value = `%${ingredient.toLowerCase()}%`;
      pushCondition(
        `EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(raw_data->'extendedIngredients', '[]'::jsonb)) ing
          WHERE (
            COALESCE(LOWER(ing->>'name'), '') LIKE __IDX__
            OR COALESCE(LOWER(ing->>'original'), '') LIKE __IDX__
            OR COALESCE(LOWER(ing->>'originalString'), '') LIKE __IDX__
          )
        )`,
        value,
      );
    });
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return {
    whereClause,
    values,
    nextIndex: paramIndex,
  };
};

const searchStoredRecipes = (filters = {}, limit = 20) => {
  const { whereClause, values, nextIndex } = buildSearchClauses(filters);
  const sql = `
    SELECT
      recipe_id,
      spoonacular_id,
      title,
      ready_in_minutes,
      price_per_serving,
      summary,
      raw_data,
      updated_at
    FROM recipes
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT $${nextIndex}
  `;

  return db.any(sql, [...values, limit]);
};

module.exports = {
  upsertRecipe,
  findRawRecipesBySpoonacularIds,
  getRecipeRecordId,
  searchStoredRecipes,
};
