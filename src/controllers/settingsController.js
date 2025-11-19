const bcrypt = require('bcryptjs');

const userRepository = require('../repositories/userRepository');
const { getUserPreferences, saveUserPreferences } = require('../services/preferencesService');

const renderSettingsPage = async (req, res, options = {}) => {
  const preferences = await getUserPreferences(req.session.user.id);
  res.render('pages/settings', {
    user: req.session.user,
    preferences,
    ...options,
  });
};

const updateUsername = async (req, res) => {
  const userId = req.session.user.id;
  const newUsername = (req.body.username || '').trim();

  if (!newUsername) {
    return renderSettingsPage(req, res, {
      message: 'Please enter a new username.',
      error: true,
    });
  }

  try {
    await userRepository.updateUsername(userId, newUsername);
    req.session.user.username = newUsername;
    return renderSettingsPage(req, res, {
      message: 'Username updated successfully!',
      error: false,
    });
  } catch (error) {
    console.error('Error updating username:', error);
    return renderSettingsPage(req, res, {
      message: 'Failed to update username. Please try again.',
      error: true,
    });
  }
};

const updatePassword = async (req, res) => {
  const userId = req.session.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return renderSettingsPage(req, res, {
      message: 'All password fields are required.',
      error: true,
    });
  }

  if (newPassword !== confirmPassword) {
    return renderSettingsPage(req, res, {
      message: 'New passwords do not match.',
      error: true,
    });
  }

  if (newPassword.length < 6) {
    return renderSettingsPage(req, res, {
      message: 'Password must be at least 6 characters long.',
      error: true,
    });
  }

  try {
    const user = await userRepository.findById(userId);
    const match = await bcrypt.compare(currentPassword, user.password);

    if (!match) {
      return renderSettingsPage(req, res, {
        message: 'Current password is incorrect.',
        error: true,
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await userRepository.updatePassword(userId, hash);

    return renderSettingsPage(req, res, {
      message: 'Password updated successfully!',
      error: false,
    });
  } catch (error) {
    console.error('Error updating password:', error);
    return renderSettingsPage(req, res, {
      message: 'Failed to update password. Please try again.',
      error: true,
    });
  }
};

const updatePreferences = async (req, res) => {
  const userId = req.session.user.id;
  const {
    sort_by,
    sort_order,
    price_priority,
    time_priority,
    calories_priority,
    health_priority,
  } = req.body;

  const preferences = {
    sort_by: sort_by || 'relevance',
    sort_order: sort_order || 'asc',
    priority_factors: {
      price: parseFloat(price_priority) || 1,
      time: parseFloat(time_priority) || 1,
      calories: parseFloat(calories_priority) || 1,
      health: parseFloat(health_priority) || 1,
    },
  };

  const success = await saveUserPreferences(userId, preferences);

  if (success) {
    return renderSettingsPage(req, res, {
      message: 'Meal sorting preferences updated successfully!',
      error: false,
    });
  }

  return renderSettingsPage(req, res, {
    message: 'Failed to update preferences. Please try again.',
    error: true,
  });
};

module.exports = {
  showSettingsPage: renderSettingsPage,
  updateUsername,
  updatePassword,
  updatePreferences,
};
