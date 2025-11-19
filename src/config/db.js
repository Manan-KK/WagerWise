const pgpLib = require('pg-promise');

const resolveDbHost = () => {
  if (process.env.POSTGRES_HOST) {
    return process.env.POSTGRES_HOST;
  }

  if (process.env.NODE_ENV === 'test') {
    return '127.0.0.1';
  }

  return 'db';
};

const pgp = pgpLib();

const dbConfig = {
  host: resolveDbHost(),
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

db.connect()
  .then((obj) => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch((error) => {
    console.log('ERROR:', error.message || error);
  });

module.exports = {
  db,
  pgp,
  resolveDbHost,
};
