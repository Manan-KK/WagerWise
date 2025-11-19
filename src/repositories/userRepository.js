const { db } = require('../config/db');

const createUser = (user) => {
  return db.none(
    'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)',
    [user.username, user.email, user.password],
  );
};

const findByUsernameOrEmail = (username, email) => {
  return db.oneOrNone(
    'SELECT username, email FROM users WHERE username = $1 OR email = $2',
    [username, email],
  );
};

const findByCredential = (field, value) => {
  if (!['username', 'email'].includes(field)) {
    throw new Error('Unsupported credential field');
  }
  return db.oneOrNone(
    `SELECT id, username, email, password FROM users WHERE ${field} = $1`,
    [value],
  );
};

const findById = (userId) => {
  return db.one(
    'SELECT * FROM users WHERE id = $1',
    [userId],
  );
};

const updateUsername = (userId, username) => {
  return db.none(
    'UPDATE users SET username = $1 WHERE id = $2',
    [username, userId],
  );
};

const updatePassword = (userId, passwordHash) => {
  return db.none(
    'UPDATE users SET password = $1 WHERE id = $2',
    [passwordHash, userId],
  );
};

module.exports = {
  createUser,
  findByUsernameOrEmail,
  findByCredential,
  findById,
  updateUsername,
  updatePassword,
};
