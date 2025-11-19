const path = require('path');
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');

const registerHelpers = () => {
  Handlebars.registerHelper('eq', (a, b) => a === b);

  Handlebars.registerHelper('groupBy', (array, property) => {
    if (!array || !Array.isArray(array)) return {};
    return array.reduce((acc, item) => {
      const key = item[property] || 'Unknown';
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});
  });

  Handlebars.registerHelper('or', (...args) => {
    const values = args.slice(0, -1);
    return values.some((value) => Boolean(value));
  });

  Handlebars.registerHelper('includes', (array, value) => {
    if (!Array.isArray(array)) {
      return false;
    }
    return array.some((item) => String(item) === String(value));
  });

  Handlebars.registerHelper('formatCurrency', (value) => {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return '';
    }
    return `$${(numericValue / 100).toFixed(2)}`;
  });

  Handlebars.registerHelper('formatDate', (dateValue) => {
    if (!dateValue) {
      return '';
    }
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  });
};

let instance;

const getHandlebarsInstance = () => {
  if (instance) {
    return instance;
  }

  registerHelpers();

  instance = handlebars.create({
    extname: 'hbs',
    layoutsDir: path.join(__dirname, '../../views/layouts'),
    partialsDir: path.join(__dirname, '../../views/partials'),
    defaultLayout: 'main',
  });

  return instance;
};

module.exports = {
  getHandlebarsInstance,
};
