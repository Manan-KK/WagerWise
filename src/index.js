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

const PORT = Number(process.env.PORT) || 3000;

const resolveDbHost = () => {
  if (process.env.POSTGRES_HOST) {
    return process.env.POSTGRES_HOST;
  }

  if (process.env.NODE_ENV === 'test') {
    return '127.0.0.1';
  }

  return 'db';
};

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

const stripHtmlTags = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
};

// database configuration
const dbConfig = {
  host: resolveDbHost(),
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
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

const spoonacularRequest = (endpoint, params = {}) => {
  return axios.get(`${SPOONACULAR_BASE_URL}${endpoint}`, {
    params: {
      apiKey: SPOONACULAR_API_KEY,
      ...params,
    },
  });
};

const normalizeApiRecipe = (recipeData = {}) => {
  if (!recipeData || typeof recipeData !== 'object') {
    return null;
  }

  const sanitizedSummary = stripHtmlTags(recipeData.summary);
  let normalizedPrice = null;

  if (recipeData.pricePerServing !== undefined && recipeData.pricePerServing !== null) {
    const numericPrice = Number(recipeData.pricePerServing);
    if (!Number.isNaN(numericPrice)) {
      normalizedPrice = Number((numericPrice / 100).toFixed(2));
    }
  }

  return {
    ...recipeData,
    id: recipeData.id || recipeData.spoonacular_id,
    summary: sanitizedSummary,
    pricePerServing: normalizedPrice,
  };
};

const saveRecipeToDatabase = async (recipe) => {
  if (!recipe || !recipe.id) {
    return null;
  }

  const payload = {
    spoonacularId: recipe.id,
    title: recipe.title || 'Untitled Recipe',
    description: recipe.summary || recipe.description || null,
    servings: recipe.servings || null,
    sourceUrl: recipe.sourceUrl || null,
    imageUrl: recipe.image || null,
    readyInMinutes: recipe.readyInMinutes || null,
    pricePerServing: typeof recipe.pricePerServing === 'number' ? recipe.pricePerServing : null,
    summary: recipe.summary || null,
    rawData: JSON.stringify(recipe),
  };

  try {
    await db.one(
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
        payload.spoonacularId,
        payload.title,
        payload.description,
        payload.servings,
        payload.sourceUrl,
        payload.imageUrl,
        payload.readyInMinutes,
        payload.pricePerServing,
        payload.summary,
        payload.rawData,
      ]
    );
  } catch (error) {
    console.error(`Error saving recipe ${recipe.id} to database:`, error.message || error);
  }

  return recipe;
};

const getCachedRecipesMap = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  try {
    const rows = await db.any(
      'SELECT spoonacular_id, raw_data FROM recipes WHERE spoonacular_id IN ($1:csv)',
      [ids]
    );

    return rows.reduce((acc, row) => {
      if (row.raw_data) {
        const recipe = {
          ...row.raw_data,
          id: row.raw_data.id || row.spoonacular_id,
        };
        acc.set(row.spoonacular_id, recipe);
      }
      return acc;
    }, new Map());
  } catch (error) {
    console.error('Error loading cached recipes:', error.message || error);
    return new Map();
  }
};

const fetchRecipeFromApi = async (recipeId) => {
  try {
    const response = await spoonacularRequest(`/recipes/${recipeId}/information`, {
      includeNutrition: true,
    });
    const normalizedRecipe = normalizeApiRecipe(response.data);
    if (normalizedRecipe) {
      await saveRecipeToDatabase(normalizedRecipe);
    }
    return normalizedRecipe;
  } catch (error) {
    console.error(`Error fetching recipe ${recipeId}:`, error.response?.data || error.message);
    return null;
  }
};

const getDetailedRecipes = async (recipeIds = []) => {
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    return [];
  }

  const cachedRecipes = await getCachedRecipesMap(recipeIds);
  const missingIds = recipeIds.filter(id => !cachedRecipes.has(id));

  if (missingIds.length > 0) {
    const fetchedRecipes = await Promise.all(missingIds.map(fetchRecipeFromApi));
    fetchedRecipes.forEach(recipe => {
      if (recipe && recipe.id) {
        cachedRecipes.set(recipe.id, recipe);
      }
    });
  }

  return recipeIds
    .map(id => cachedRecipes.get(id))
    .filter(recipe => Boolean(recipe));
};

// *****************************************************
// <!-- Section 3 : API Configuration -->
// *****************************************************

// Spoonacular API configuration
const FALLBACK_SPOONACULAR_API_KEY = 'd172638adb4d4089925a33f2d0f820cd';
const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY || FALLBACK_SPOONACULAR_API_KEY;
const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';

if (!process.env.SPOONACULAR_API_KEY) {
  console.warn('SPOONACULAR_API_KEY not set in environment. Falling back to development key.');
}

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

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

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
  if (req.session.user) {
    return res.redirect('/discover');
  }

  res.render('pages/register');
});

app.post('/register', async (req, res) => {
  const rawUsername = (req.body.username || '').trim();
  const rawEmail = (req.body.email || '').trim();
  const password = req.body.password || '';
  const viewModel = {
    form: {
      username: rawUsername,
      email: rawEmail
    }
  };

  if (!rawUsername) {
    return res.render('pages/register', {
      ...viewModel,
      message: 'Please enter a valid username.',
      error: true
    });
  }

  if (!EMAIL_REGEX.test(rawEmail)) {
    return res.render('pages/register', {
      ...viewModel,
      message: 'Please enter a valid email address.',
      error: true
    });
  }

  if (password.length < 6) {
    return res.render('pages/register', {
      ...viewModel,
      message: 'Password must be at least 6 characters long.',
      error: true
    });
  }

  const username = rawUsername.toLowerCase();
  const email = rawEmail.toLowerCase();
  const query = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)';
  
  try {
    const existingUser = await db.oneOrNone(
      'SELECT username, email FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser) {
      const conflictMessage =
        existingUser.username === username
          ? 'Username is already taken. Please choose another one.'
          : 'Email is already in use. Try logging in or use a different email.';

      return res.render('pages/register', {
        ...viewModel,
        message: conflictMessage,
        error: true
      });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.none(query, [username, email, hash]);
    res.redirect('/login?registered=1');
  } catch (error) {
    console.error('Registration error:', error);
    res.render('pages/register', { 
      ...viewModel,
      message: 'Registration failed. Please try again later.',
      error: true 
    });
  }
});


app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/discover');
  }

  const { registered } = req.query;
  const context = {};

  if (registered) {
    context.message = 'Account created successfully. Please log in.';
    context.error = false;
  }

  res.render('pages/login', context);
});

app.post('/login', async (req, res) => {
  const rawCredential = (req.body.username || '').trim();
  const password = req.body.password || '';
  const viewModel = {
    form: {
      username: rawCredential
    }
  };

  if (!rawCredential) {
    return res.render('pages/login', { 
      ...viewModel,
      message: 'Please enter your username or email.',
      error: true 
    });
  }

  if (!password) {
    return res.render('pages/login', { 
      ...viewModel,
      message: 'Please enter your password.',
      error: true 
    });
  }

  const normalizedCredential = rawCredential.toLowerCase();
  const lookupField = EMAIL_REGEX.test(rawCredential) ? 'email' : 'username';
  const query = `SELECT id, username, email, password FROM users WHERE ${lookupField} = $1`;
  
  try {
    const user = await db.oneOrNone(query, [normalizedCredential]);
    
    if (!user) {
      return res.render('pages/login', { 
        ...viewModel,
        message: 'Incorrect username/email or password.',
        error: true 
      });
    }
    
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      return res.render('pages/login', { 
        ...viewModel,
        message: 'Incorrect username/email or password.',
        error: true 
      });
    }
    
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.render('pages/login', {
          ...viewModel,
          message: 'Unable to log in at this time. Please try again.',
          error: true
        });
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.render('pages/login', {
            ...viewModel,
            message: 'Unable to log in at this time. Please try again.',
            error: true
          });
        }

        res.redirect('/discover'); // Redirect to discover page after successful login
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('pages/login', { 
      ...viewModel,
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
      number: Math.min(parseInt(number, 10) || 10, 100),
      addRecipeInformation: true,
      addRecipeNutrition: true,
      addRecipePrice: true,
    };

    // Add optional parameters
    if (query) params.query = query;
    if (diet && diet !== 'none') params.diet = diet;
    if (intolerances) params.intolerances = intolerances;
    if (maxReadyTime) params.maxReadyTime = parseInt(maxReadyTime, 10);
    if (minCalories) params.minCalories = parseInt(minCalories, 10);
    if (maxCalories) params.maxCalories = parseInt(maxCalories, 10);
    if (minPrice) params.minPrice = parseFloat(minPrice);
    if (maxPrice) params.maxPrice = parseFloat(maxPrice);

    if (ingredients) {
      const ingredientQuery = new URLSearchParams({
        ingredients,
        number: params.number,
      });
      return res.redirect(`/discover/ingredients?${ingredientQuery.toString()}`);
    }

    const response = await spoonacularRequest('/recipes/complexSearch', params);
    const searchResults = response.data.results || [];
    const recipeIds = searchResults.map(recipe => recipe.id).filter(id => !!id);
    const limitedRecipeIds = recipeIds.slice(0, 20);
    const detailedRecipes = await getDetailedRecipes(limitedRecipeIds);

    res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes,
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
      ingredients: ingredients,
      number: Math.min(parseInt(req.query.number, 10) || 10, 100),
      ranking: 1, // Maximize used ingredients
      ignorePantry: true
    };

    const response = await spoonacularRequest('/recipes/findByIngredients', params);
    const recipes = response.data || [];
    const recipeIds = recipes.map(recipe => recipe.id).filter(id => !!id);
    const detailedRecipes = await getDetailedRecipes(recipeIds.slice(0, 20));

    res.render('pages/discover', {
      user: req.session.user,
      results: detailedRecipes,
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
    const rawRecipeIds = req.body.recipeIds;
    const recipeIds = (Array.isArray(rawRecipeIds) ? rawRecipeIds : rawRecipeIds ? [rawRecipeIds] : [])
      .map(id => parseInt(id, 10))
      .filter(id => !Number.isNaN(id));
    
    if (recipeIds.length === 0) {
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        message: 'Please select at least one recipe.',
        error: true
      });
    }

    const recipes = await getDetailedRecipes(recipeIds);

    if (recipes.length === 0) {
      return res.render('pages/discover', {
        user: req.session.user,
        results: null,
        message: 'Unable to load the selected recipes. Please try searching again.',
        error: true
      });
    }

    // Aggregate ingredients from all recipes
    const ingredientMap = new Map();
    let totalEstimatedCost = 0;

    recipes.forEach(recipe => {
      if (!recipe || !recipe.extendedIngredients) return;
      
      recipe.extendedIngredients.forEach(ingredient => {
        const resolvedName = (ingredient.name || ingredient.original || '').trim();
        if (!resolvedName) {
          return;
        }

        const key = resolvedName.toLowerCase();
        const cost = ((ingredient.estimatedCost?.value) || 0) / 100;
        totalEstimatedCost += cost;

        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key);
          // Try to combine amounts (simplified - in production, would need proper unit conversion)
          existing.amount += ingredient.amount || 0;
          existing.recipes.push(recipe.title);
          if (cost > 0) {
            const previousCost = parseFloat(existing.estimatedCost) || 0;
            existing.estimatedCost = (previousCost + cost).toFixed(2);
          }
        } else {
          ingredientMap.set(key, {
            id: ingredient.id,
            name: ingredient.name || resolvedName,
            original: ingredient.original,
            amount: ingredient.amount || 0,
            unit: ingredient.unit || '',
            aisle: ingredient.aisle || 'Unknown',
            image: ingredient.image,
            estimatedCost: cost.toFixed(2),
            recipes: [recipe.title]
          });
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
let serverInstance;

if (require.main === module) {
  serverInstance = app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}

module.exports = app;
module.exports.saveRecipeToDatabase = saveRecipeToDatabase;
