const { db } = require('../config/db');

const getPreferences = (userId) => {
  return db.oneOrNone(
    'SELECT * FROM user_preferences WHERE user_id = $1',
    [userId],
  );
};

const savePreferences = (userId, preferences) => {
  return db.none(
    `INSERT INTO user_preferences (user_id, sort_by, sort_order, priority_factors, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       sort_by = EXCLUDED.sort_by,
       sort_order = EXCLUDED.sort_order,
       priority_factors = EXCLUDED.priority_factors,
       updated_at = NOW()`,
    [
      userId,
      preferences.sort_by || 'relevance',
      preferences.sort_order || 'asc',
      JSON.stringify(preferences.priority_factors || { price: 1, time: 1, calories: 1, health: 1 }),
    ],
  );
};

module.exports = {
  getPreferences,
  savePreferences,
};
