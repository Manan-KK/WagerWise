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

module.exports = {
  upsertRecipe,
  findRawRecipesBySpoonacularIds,
  getRecipeRecordId,
};
