const path = require('path');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');

const { getHandlebarsInstance } = require('./lib/handlebars');

const authRoutes = require('./routes/authRoutes');
const authMiddleware = require('./middleware/auth');
const discoverRoutes = require('./routes/discoverRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const recipeRoutes = require('./routes/recipeRoutes');
const app = express();
const hbs = getHandlebarsInstance();

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '../views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'budgetbites_dev_secret',
  saveUninitialized: false,
  resave: false,
}));

app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

app.use('/', authRoutes);
app.use(authMiddleware);
app.use('/', discoverRoutes);
app.use('/', favoriteRoutes);
app.use('/', settingsRoutes);
app.use('/', dashboardRoutes);
app.use('/', recipeRoutes);

module.exports = app;
