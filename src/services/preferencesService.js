const preferencesRepository = require('../repositories/preferencesRepository');

const DEFAULT_PRIORITY_FACTORS = { price: 1, time: 1, calories: 1, health: 1 };
const DEFAULT_PREFERENCES = {
  sort_by: 'relevance',
  sort_order: 'asc',
  priority_factors: DEFAULT_PRIORITY_FACTORS,
};

const getUserPreferences = async (userId) => {
  try {
    const prefs = await preferencesRepository.getPreferences(userId);
    if (!prefs) {
      return { ...DEFAULT_PREFERENCES };
    }

    return {
      sort_by: prefs.sort_by || DEFAULT_PREFERENCES.sort_by,
      sort_order: prefs.sort_order || DEFAULT_PREFERENCES.sort_order,
      priority_factors: prefs.priority_factors || DEFAULT_PRIORITY_FACTORS,
    };
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return { ...DEFAULT_PREFERENCES };
  }
};

const saveUserPreferences = async (userId, preferences) => {
  try {
    await preferencesRepository.savePreferences(userId, preferences);
    return true;
  } catch (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }
};

module.exports = {
  DEFAULT_PREFERENCES,
  getUserPreferences,
  saveUserPreferences,
};
