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
// <!-- Section 3 : App Settings -->
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
// <!-- Section 4 : API Routes -->
// *****************************************************

// Authentication Middleware.
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
  const hash = await bcrypt.hash(req.body.password, 10);
  const query = 'INSERT INTO users (username, password) VALUES ($1, $2)';
  
  try {
    await db.none(query, [req.body.username, hash]);
    res.redirect('/login');
  } catch (error) {
    res.render('pages/register', { 
      message: 'Registration failed. Username already exists.',
      error: true 
    });
  }
});

app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
  const query = 'SELECT * FROM users WHERE username = $1';
  
  try {
    const user = await db.oneOrNone(query, [req.body.username]);
    
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
  res.render('pages/discover', { user: req.session.user });
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

