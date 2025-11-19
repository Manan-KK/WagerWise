const bcrypt = require('bcryptjs');

const userRepository = require('../repositories/userRepository');
const { EMAIL_REGEX } = require('../utils/validation');

const redirectRoot = (req, res) => {
  res.redirect('/login');
};

const renderRegister = (req, res) => {
  if (req.session.user) {
    return res.redirect('/discover');
  }

  return res.render('pages/register', {
    form: {},
    errors: {},
  });
};

const handleRegister = async (req, res) => {
  const rawUsername = (req.body.username || '').trim();
  const rawEmail = (req.body.email || '').trim();
  const password = req.body.password || '';
  const viewModel = {
    form: {
      username: rawUsername,
      email: rawEmail,
    },
    errors: {},
  };

  if (!rawUsername) {
    viewModel.errors.username = 'Please enter a valid username.';
    return res.render('pages/register', {
      ...viewModel,
      message: 'Fix the highlighted issues and try again.',
      error: true,
    });
  }

  if (!EMAIL_REGEX.test(rawEmail)) {
    viewModel.errors.email = 'Please enter a valid email address.';
    return res.render('pages/register', {
      ...viewModel,
      message: 'Fix the highlighted issues and try again.',
      error: true,
    });
  }

  if (password.length < 6) {
    viewModel.errors.password = 'Password must be at least 6 characters long.';
    return res.render('pages/register', {
      ...viewModel,
      message: 'Fix the highlighted issues and try again.',
      error: true,
    });
  }

  const username = rawUsername.toLowerCase();
  const email = rawEmail.toLowerCase();

  try {
    const existingUser = await userRepository.findByUsernameOrEmail(username, email);
    if (existingUser) {
      const conflictMessage =
        existingUser.username === username
          ? 'Username is already taken. Please choose another one.'
          : 'Email is already in use. Try logging in or use a different email.';

      if (existingUser.username === username) {
        viewModel.errors.username = conflictMessage;
      } else {
        viewModel.errors.email = conflictMessage;
      }

      return res.render('pages/register', {
        ...viewModel,
        message: conflictMessage,
        error: true,
      });
    }

    const hash = await bcrypt.hash(password, 10);
    await userRepository.createUser({ username, email, password: hash });
    return res.redirect('/login?registered=1');
  } catch (error) {
    console.error('Registration error:', error);
    return res.render('pages/register', {
      ...viewModel,
      message: 'Registration failed. Please try again later.',
      error: true,
    });
  }
};

const renderLogin = (req, res) => {
  if (req.session.user) {
    return res.redirect('/discover');
  }

  const { registered } = req.query;
  const context = {};

  if (registered) {
    context.message = 'Account created successfully. Please log in.';
    context.error = false;
  }

  return res.render('pages/login', context);
};

const handleLogin = async (req, res) => {
  const rawCredential = (req.body.username || '').trim();
  const password = req.body.password || '';
  const viewModel = {
    form: {
      username: rawCredential,
    },
  };

  if (!rawCredential) {
    return res.render('pages/login', {
      ...viewModel,
      message: 'Please enter your username or email.',
      error: true,
    });
  }

  if (!password) {
    return res.render('pages/login', {
      ...viewModel,
      message: 'Please enter your password.',
      error: true,
    });
  }

  const normalizedCredential = rawCredential.toLowerCase();
  const lookupField = EMAIL_REGEX.test(rawCredential) ? 'email' : 'username';

  try {
    const user = await userRepository.findByCredential(lookupField, normalizedCredential);

    if (!user) {
      return res.render('pages/login', {
        ...viewModel,
        message: 'Incorrect username/email or password.',
        error: true,
      });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render('pages/login', {
        ...viewModel,
        message: 'Incorrect username/email or password.',
        error: true,
      });
    }

    return req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.render('pages/login', {
          ...viewModel,
          message: 'Unable to log in at this time. Please try again.',
          error: true,
        });
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
      };

      return req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          return res.render('pages/login', {
            ...viewModel,
            message: 'Unable to log in at this time. Please try again.',
            error: true,
          });
        }

        return res.redirect('/discover');
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.render('pages/login', {
      ...viewModel,
      message: 'Login failed. Please try again.',
      error: true,
    });
  }
};

const handleLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.render('pages/logout', {
        message: 'Error logging out. Please try again.',
        error: true,
      });
    }
    return res.render('pages/logout', {
      message: 'Logged out successfully',
      error: false,
    });
  });
};

module.exports = {
  redirectRoot,
  renderRegister,
  handleRegister,
  renderLogin,
  handleLogin,
  handleLogout,
};
