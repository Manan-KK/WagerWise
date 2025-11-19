const { getUserFavorites } = require('../services/favoriteService');
const { getUserPreferences } = require('../services/preferencesService');

const renderDashboard = async (req, res) => {
  try {
    const [favorites, preferences] = await Promise.all([
      getUserFavorites(req.session.user.id),
      getUserPreferences(req.session.user.id),
    ]);

    res.render('pages/dashboard', {
      user: req.session.user,
      favoriteCount: favorites.length,
      recentFavorites: favorites.slice(0, 3),
      preferences,
    });
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    res.render('pages/dashboard', {
      user: req.session.user,
      favoriteCount: 0,
      recentFavorites: [],
      preferences: null,
      error: true,
      message: 'Unable to load dashboard data at this time.',
    });
  }
};

module.exports = {
  renderDashboard,
};
