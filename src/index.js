// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // For making HTTP requests to external APIs

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, '../views/layouts'),
  partialsDir: path.join(__dirname, '../views/partials'),
  defaultLayout: 'main',
});

// Register Handlebars helpers
Handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

Handlebars.registerHelper('groupBy', function(array, property) {
  if (!array || !Array.isArray(array)) return {};
  const grouped = {};
  array.forEach(item => {
    const key = item[property] || 'Unknown';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  });
  return grouped;
});

// database configuration
const dbConfig = {
  host: 'db', // the database server (Docker service name)
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : API Configuration -->
// *****************************************************

// Spoonacular API configuration
const SPOONACULAR_API_KEY = 'd172638adb4d4089925a33f2d0f820cd';
const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';

// *****************************************************
// <!-- Section 4 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '../views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// *****************************************************
// <!-- Section 5 : API Routes -->
// *****************************************************

// Authentication Middleware.
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.redirect('/login');
  }
  next();
};

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/register', (req, res) => {
  res.render('pages/register');
});

app.post('/register', async (req, res) => {
  const rawUsername = (req.body.username || '').trim();
  const rawEmail = (req.body.email || '').trim();

  if (!rawUsername) {
    return res.render('pages/register', {
      message: 'Please enter a valid username.',
      error: true
    });
  }

  if (!EMAIL_REGEX.test(rawEmail)) {
    return res.render('pages/register', {
      message: 'Please enter a valid email address.',
      error: true
    });
  }

  const username = rawUsername.toLowerCase();
  const email = rawEmail.toLowerCase();
  const hash = await bcrypt.hash(req.body.password, 10);
  const query = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)';
  
  try {
    await db.none(query, [username, email, hash]);
    res.redirect('/login');
  } catch (error) {
    res.render('pages/register', { 
      message: 'Registration failed. Username or email may already be in use.',
      error: true 
    });
  }
});


app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
  const query = 'SELECT * FROM users WHERE username = $1';
  const username = (req.body.username || '').trim().toLowerCase();
  
  if (!username) {
    return res.render('pages/login', { 
      message: 'Please enter your username.',
      error: true 
    });
  }
  
  try {
    const user = await db.oneOrNone(query, [username]);
    
    if (!user) {
      return res.render('pages/login', { 
        message: 'Incorrect username or password.',
        error: true 
      });
    }
    
    const match = await bcrypt.compare(req.body.password, user.password);
    
    if (!match) {
      return res.render('pages/login', { 
        message: 'Incorrect username or password.',
        error: true 
      });
    }
    
    req.session.user = user;
    req.session.save();
    res.redirect('/discover'); // Redirect to discover page after successful login
  } catch (error) {
    res.render('pages/login', { 
      message: 'Login failed. Please try again.',
      error: true 
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.render('pages/logout', {
        message: 'Error logging out. Please try again.',
        error: true
      });
    }
    res.render('pages/logout', {
      message: 'Logged out successfully',
      error: false
    });
  });
});

// Authentication Required - routes below this require authentication
app.use(auth);

app.get('/discover', (req, res) => {
  res.render('pages/discover', { 
    user: req.session.user,
    results: null,
    searchParams: null
  });
});

// POST route for recipe search
app.post('/discover/search', async (req, res) => {
  try {
    const {
      query,
      diet,
      intolerances,
      ingredients,
      maxReadyTime,
      minCalories,
      maxCalories,
      minPrice,
      maxPrice,
      number = 10
    } = req.body;

    // Build query parameters for Spoonacular API
    const params = {
      apiKey: SPOONACULAR_API_KEY,
      number: Math.min(parseInt(number) || 10, 100), // Max 100 recipes
      addRecipeInformation: true,
      addRecipeNutrition: true,
      addRecipePrice: true,
    };

    // Add optional parameters
    if (query) params.query = query;
    if (diet && diet !== 'none') params.diet = diet;
    if (intolerances) params.intolerances = intolerances;
    if (maxReadyTime) params.maxReadyTime = parseInt(maxReadyTime);
    if (minCalories) params.minCalories = parseInt(minCalories);
    if (maxCalories) params.maxCalories = parseInt(maxCalories);
    if (minPrice) params.minPrice = parseFloat(minPrice);
    if (maxPrice) params.maxPrice = parseFloat(maxPrice);
    if (ingredients) {
      // If ingredients are provided, use findByIngredients endpoint first
      return res.redirect(`/discover/ingredients?ingredients=${encodeURIComponent(ingredients)}&${new URLSearchParams(params)}`);
    }

    // Call Spoonacular Complex Recipe Search endpoint
    const response = await axios.get(`${SPOONACULAR_BASE_URL}/recipes/complexSearch`, {
      params: params
    });

    const recipes = response.data.results || [];

    // Get detailed information for each recipe including prices
    const detailedRecipes = await Promise.all(
      recipes.slice(0, 20).map(async (recipe) => {
        try {
          const detailResponse = await axios.get(
            `${SPOONACULAR_BASE_URL}/recipes/${recipe.id}/information`,
            {
              params: {
                apiKey: SPOONACULAR_API_KEY,
                includeNutrition: true,
              }
            }
          );
          const recipeData = detailResponse.data;
          // Format price per serving (divide by 100 as Spoonacular returns in cents)
          if (recipeData.pricePerServing) {
            recipeData.pricePerServing = (recipeData.pricePerServing / 100).toFixed(2);
          }
          return recipeData;
        } catch (error) {
          console.error(`Error fetching recipe ${recipe.id}:`, error.message);
          return recipe;
        }
      })
    );

    res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes.filter(r => r !== null),
      searchParams: req.body,
      message: detailedRecipes.length > 0 ? `Found ${detailedRecipes.length} recipes!` : 'No recipes found. Try adjusting your search criteria.',
      error: detailedRecipes.length === 0
    });
  } catch (error) {
    console.error('Error searching recipes:', error.response?.data || error.message);
    res.render('pages/discover', {
      user: req.session.user,
      results: null,
      searchParams: req.body,
      message: 'Error searching recipes. Please try again.',
      error: true
    });
  }
});

// GET route for ingredient-based search
app.get('/discover/ingredients', async (req, res) => {
  try {
    const ingredients = req.query.ingredients;
    const params = {
      apiKey: SPOONACULAR_API_KEY,
      ingredients: ingredients,
      number: Math.min(parseInt(req.query.number) || 10, 100),
      ranking: 1, // Maximize used ingredients
      ignorePantry: true
    };

    const response = await axios.get(`${SPOONACULAR_BASE_URL}/recipes/findByIngredients`, {
      params: params
    });

    const recipes = response.data || [];

    // Get detailed information for each recipe
    const detailedRecipes = await Promise.all(
      recipes.slice(0, 20).map(async (recipe) => {
        try {
          const detailResponse = await axios.get(
            `${SPOONACULAR_BASE_URL}/recipes/${recipe.id}/information`,
            {
              params: {
                apiKey: SPOONACULAR_API_KEY,
                includeNutrition: true,
              }
            }
          );
          const recipeData = detailResponse.data;
          // Format price per serving (divide by 100 as Spoonacular returns in cents)
          if (recipeData.pricePerServing) {
            recipeData.pricePerServing = (recipeData.pricePerServing / 100).toFixed(2);
          }
          return recipeData;
        } catch (error) {
          console.error(`Error fetching recipe ${recipe.id}:`, error.message);
          return null;
        }
      })
    );

    res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes.filter(r => r !== null),
      searchParams: { ingredients: ingredients },
      message: detailedRecipes.length > 0 ? `Found ${detailedRecipes.length} recipes!` : 'No recipes found. Try different ingredients.',
      error: detailedRecipes.length === 0
    });
  } catch (error) {
    console.error('Error searching by ingredients:', error.response?.data || error.message);
    res.render('pages/discover', {
      user: req.session.user,
      results: null,
      searchParams: req.query,
      message: 'Error searching recipes. Please try again.',
      error: true
    });
  }
});

// POST route to generate weekly grocery list
app.post('/discover/grocery-list', async (req, res) => {
  try {
    const { recipeIds } = req.body;
    
    if (!recipeIds || !Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        message: 'Please select at least one recipe.',
        error: true
      });
    }

    // Get detailed recipe information for all selected recipes
    const recipes = await Promise.all(
      recipeIds.map(async (id) => {
        try {
          const response = await axios.get(
            `${SPOONACULAR_BASE_URL}/recipes/${id}/information`,
            {
              params: {
                apiKey: SPOONACULAR_API_KEY,
                includeNutrition: true,
              }
            }
          );
          return response.data;
        } catch (error) {
          console.error(`Error fetching recipe ${id}:`, error.message);
          return null;
        }
      })
    );

    // Aggregate ingredients from all recipes
    const ingredientMap = new Map();
    let totalEstimatedCost = 0;

    recipes.forEach(recipe => {
      if (!recipe || !recipe.extendedIngredients) return;
      
      recipe.extendedIngredients.forEach(ingredient => {
        const key = ingredient.name.toLowerCase();
        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key);
          // Try to combine amounts (simplified - in production, would need proper unit conversion)
          existing.amount += ingredient.amount || 0;
          existing.recipes.push(recipe.title);
        } else {
          ingredientMap.set(key, {
            id: ingredient.id,
            name: ingredient.name,
            original: ingredient.original,
            amount: ingredient.amount || 0,
            unit: ingredient.unit || '',
            aisle: ingredient.aisle || 'Unknown',
            image: ingredient.image,
            estimatedCost: ingredient.estimatedCost?.value ? (ingredient.estimatedCost.value / 100).toFixed(2) : '0.00',
            recipes: [recipe.title]
          });
          totalEstimatedCost += (ingredient.estimatedCost?.value || 0) / 100; // Convert cents to dollars
        }
      });
    });

    const groceryList = Array.from(ingredientMap.values());
    
    // Sort by aisle for better organization
    groceryList.sort((a, b) => {
      if (a.aisle < b.aisle) return -1;
      if (a.aisle > b.aisle) return 1;
      return 0;
    });

    // Group by aisle for easier rendering
    const groupedByAisle = {};
    groceryList.forEach(item => {
      const aisle = item.aisle || 'Unknown';
      if (!groupedByAisle[aisle]) {
        groupedByAisle[aisle] = [];
      }
      groupedByAisle[aisle].push(item);
    });

    res.render('pages/grocery-list', {
      user: req.session.user,
      recipes: recipes.filter(r => r !== null),
      groceryList: groceryList,
      groupedByAisle: groupedByAisle,
      totalEstimatedCost: totalEstimatedCost.toFixed(2)
    });
  } catch (error) {
    console.error('Error generating grocery list:', error.response?.data || error.message);
    res.render('pages/discover', {
      user: req.session.user,
      results: null,
      message: 'Error generating grocery list. Please try again.',
      error: true
    });
  }
});

app.get('/dashboard', (req, res) => {
  res.render('pages/dashboard', { user: req.session.user });
});

app.get('/settings', (req, res) => {
  res.render('pages/settings', { user: req.session.user });
});

app.post('/settings/username', async (req, res) => {
  const userId = req.session.user.id;
  const newUsername = req.body.username.trim();
  
  // Check if username is provided
  if (!newUsername) {
    return res.render('pages/settings', {
      user: req.session.user,
      message: 'Username cannot be empty.',
      error: true
    });
  }
  
  // Check if username is the same
  if (newUsername === req.session.user.username) {
    return res.render('pages/settings', {
      user: req.session.user,
      message: 'New username must be different from current username.',
      error: true
    });
  }
  
  try {
    // Check if username already exists
    const existingUser = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [newUsername]);
    if (existingUser) {
      return res.render('pages/settings', {
        user: req.session.user,
        message: 'Username already exists. Please choose a different username.',
        error: true
      });
    }
    
    // Update username
    await db.none('UPDATE users SET username = $1 WHERE id = $2', [newUsername, userId]);
    
    // Update session
    req.session.user.username = newUsername;
    req.session.save();
    
    res.render('pages/settings', {
      user: req.session.user,
      message: 'Username updated successfully!',
      error: false
    });
  } catch (error) {
    res.render('pages/settings', {
      user: req.session.user,
      message: 'Failed to update username. Please try again.',
      error: true
    });
  }
});

app.post('/settings/password', async (req, res) => {
  const userId = req.session.user.id;
  const currentPassword = req.body.currentPassword;
  const newPassword = req.body.newPassword;
  const confirmPassword = req.body.confirmPassword;
  
  // Validate passwords
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.render('pages/settings', {
      user: req.session.user,
      message: 'All password fields are required.',
      error: true
    });
  }
  
  if (newPassword !== confirmPassword) {
    return res.render('pages/settings', {
      user: req.session.user,
      message: 'New passwords do not match.',
      error: true
    });
  }
  
  if (newPassword.length < 6) {
    return res.render('pages/settings', {
      user: req.session.user,
      message: 'Password must be at least 6 characters long.',
      error: true
    });
  }
  
  try {
    // Get current user from database
    const user = await db.one('SELECT * FROM users WHERE id = $1', [userId]);
    
    // Verify current password
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.render('pages/settings', {
        user: req.session.user,
        message: 'Current password is incorrect.',
        error: true
      });
    }
    
    // Hash new password
    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await db.none('UPDATE users SET password = $1 WHERE id = $2', [hash, userId]);
    
    res.render('pages/settings', {
      user: req.session.user,
      message: 'Password updated successfully!',
      error: false
    });
  } catch (error) {
    res.render('pages/settings', {
      user: req.session.user,
      message: 'Failed to update password. Please try again.',
      error: true
    });
  }
});

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');
