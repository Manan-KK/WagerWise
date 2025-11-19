const app = require('./app');
const { saveRecipeToDatabase } = require('./services/recipeService');

const PORT = Number(process.env.PORT) || 3000;
let serverInstance;

if (require.main === module) {
  serverInstance = app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}

module.exports = app;
module.exports.serverInstance = serverInstance;
module.exports.saveRecipeToDatabase = saveRecipeToDatabase;
