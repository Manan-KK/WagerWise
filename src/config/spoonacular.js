const axios = require('axios');

const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';
const FALLBACK_SPOONACULAR_API_KEY = 'd172638adb4d4089925a33f2d0f820cd';
const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY || FALLBACK_SPOONACULAR_API_KEY;

if (!process.env.SPOONACULAR_API_KEY) {
  console.warn('SPOONACULAR_API_KEY not set in environment. Falling back to development key.');
}

const client = axios.create({
  baseURL: SPOONACULAR_BASE_URL,
});

const spoonacularRequest = (endpoint, params = {}) => {
  return client.get(endpoint, {
    params: {
      apiKey: SPOONACULAR_API_KEY,
      ...params,
    },
  });
};

module.exports = {
  SPOONACULAR_API_KEY,
  SPOONACULAR_BASE_URL,
  spoonacularRequest,
};
