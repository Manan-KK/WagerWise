#!/usr/bin/env node
/**
 * Import custom CSV recipes (with local images) into the application's database.
 *
 * Usage:
 *   node scripts/importCustomRecipes.js --csv ./data/custom.csv \
 *        [--image-source ./images] [--image-dest ./public/images/custom] \
 *        [--image-url /images/custom] [--image-ext .jpg] [--id-offset 400000000]
 *        [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const { saveRecipeToDatabase } = require('../src/services/recipeService');

const DEFAULTS = {
  imageOutputDir: path.join(__dirname, '..', 'public', 'recipe-images', 'custom'),
  imagePublicPath: '/recipe-images/custom',
  imageExtension: '.jpg',
  idOffset: Number(process.env.CUSTOM_RECIPE_ID_OFFSET) || 400_000_000,
  defaultServings: Number(process.env.CUSTOM_RECIPE_DEFAULT_SERVINGS) || 4,
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    csvPath: null,
    imageSourceDir: null,
    imageOutputDir: DEFAULTS.imageOutputDir,
    imagePublicPath: DEFAULTS.imagePublicPath,
    imageExtension: DEFAULTS.imageExtension,
    idOffset: DEFAULTS.idOffset,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--csv':
      case '-c':
        options.csvPath = args[i + 1];
        i += 1;
        break;
      case '--image-source':
        options.imageSourceDir = args[i + 1];
        i += 1;
        break;
      case '--image-dest':
        options.imageOutputDir = args[i + 1];
        i += 1;
        break;
      case '--image-url':
        options.imagePublicPath = args[i + 1];
        i += 1;
        break;
      case '--image-ext':
        options.imageExtension = args[i + 1];
        i += 1;
        break;
      case '--id-offset':
        options.idOffset = Number(args[i + 1]);
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        if (!arg.startsWith('--') && !options.csvPath) {
          options.csvPath = arg;
        } else {
          console.warn(`Ignoring unrecognized argument: ${arg}`);
        }
    }
  }

  if (!options.csvPath) {
    throw new Error('Missing required --csv <path-to-file> argument.');
  }

  options.csvPath = path.resolve(options.csvPath);
  if (options.imageSourceDir) {
    options.imageSourceDir = path.resolve(options.imageSourceDir);
  }
  options.imageOutputDir = path.resolve(options.imageOutputDir);
  options.imagePublicPath = options.imagePublicPath.replace(/\\/g, '/');
  if (!options.imagePublicPath.startsWith('/')) {
    options.imagePublicPath = `/${options.imagePublicPath}`;
  }

  return options;
};

const readCsvFile = async (filePath) => {
  let content = await fs.promises.readFile(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const rows = [];
  let currentValue = '';
  let currentRow = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      const hasContent = currentRow.some((cell) => cell && cell.trim().length > 0);
      if (hasContent || rows.length === 0) {
        rows.push(currentRow);
      }
      currentRow = [];
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1;
      }
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  if (!rows.length) {
    return [];
  }

  const headerRow = rows.shift();
  const headers = headerRow.map((header) => header.trim());

  return rows
    .filter((row) => row.some((cell) => cell && cell.trim().length > 0))
    .map((row) => {
      const record = {};
      headers.forEach((header, idx) => {
        record[header] = row[idx] !== undefined ? row[idx] : '';
      });
      return record;
    });
};

const parseListColumn = (value = '') => {
  let content = value.trim();
  if (!content) {
    return [];
  }

  if (content.startsWith('[') && content.endsWith(']')) {
    content = content.slice(1, -1);
  }

  const items = [];
  let buffer = '';
  let inString = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '\'' && content[i - 1] !== '\\') {
      inString = !inString;
      if (!inString) {
        const normalized = buffer.trim();
        if (normalized.length > 0) {
          items.push(normalized);
        }
        buffer = '';
      }
      continue;
    }

    if (inString) {
      buffer += char;
    }
  }

  return items.map((entry) => entry.replace(/\s+/g, ' ').trim());
};

const parseInstructions = (value = '') => {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const toPosixPath = (inputPath) => inputPath.replace(/\\/g, '/');

const computeStableId = (rowIndex, offset) => {
  // Keep ids within 32-bit integer range while ensuring deterministic ordering.
  return offset + rowIndex + 1;
};

const clampNumber = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

const estimateServings = (row, fallback) => {
  const raw = row.Servings || row.servings;
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return fallback;
};

const estimateReadyMinutes = (instructionCount, ingredientCount) => {
  const base = 15;
  const stepLoad = instructionCount * 4;
  const ingredientLoad = Math.max(0, ingredientCount - 5) * 1.5;
  const total = base + stepLoad + ingredientLoad;
  return clampNumber(Math.round(total), 10, 240);
};

const estimatePricePerServing = (ingredientCount, instructionCount) => {
  const base = 1.5;
  const ingredientContribution = ingredientCount * 0.7;
  const complexityContribution = Math.max(0, instructionCount - 5) * 0.25;
  const estimate = base + ingredientContribution + complexityContribution;
  return clampNumber(Number(estimate.toFixed(2)), 1, 25);
};

const applyCostEstimates = (extendedIngredients, pricePerServing, servings) => {
  if (!Array.isArray(extendedIngredients) || extendedIngredients.length === 0) {
    return;
  }

  if (typeof pricePerServing !== 'number' || pricePerServing <= 0 || !servings) {
    return;
  }

  const totalCost = pricePerServing * servings;
  const perIngredient = totalCost / extendedIngredients.length;
  const cents = Math.max(0, Math.round(perIngredient * 100));

  extendedIngredients.forEach((ingredient) => {
    ingredient.estimatedCost = {
      value: cents,
      unit: 'US Cents',
    };
  });
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const copyImageIfNeeded = async (imageName, options) => {
  if (!imageName) {
    return null;
  }

  const normalizedExt = options.imageExtension.startsWith('.')
    ? options.imageExtension
    : `.${options.imageExtension}`;

  const filename = /\.[a-zA-Z0-9]+$/.test(imageName)
    ? imageName
    : `${imageName}${normalizedExt}`;

  if (options.imageSourceDir) {
    const sourcePath = path.join(options.imageSourceDir, filename);
    const destinationPath = path.join(options.imageOutputDir, filename);
    try {
      await ensureDir(options.imageOutputDir);
      await fs.promises.copyFile(sourcePath, destinationPath);
    } catch (error) {
      console.warn(`Warning: unable to copy image ${filename}: ${error.message}`);
      return null;
    }
  }

  return toPosixPath(path.posix.join(options.imagePublicPath, filename));
};

const buildRecipePayload = async (row, rowIndex, options) => {
  const title = row.Title?.trim();
  if (!title) {
    return null;
  }

  const instructions = parseInstructions(row.Instructions || row.Directions || '');
  const ingredientList = parseListColumn(row.Ingredients || row.ingredients || '');
  const cleanedList = parseListColumn(row.Cleaned_Ingredients || row.cleaned_ingredients || '');
  const mergedIngredients = ingredientList.length > 0 ? ingredientList : cleanedList;
  const imageUrl = await copyImageIfNeeded(row.Image_Name || row.image_name, options);
  const recipeId = computeStableId(rowIndex, options.idOffset);

  const servings = estimateServings(row, options.defaultServings);
  const readyInMinutes = estimateReadyMinutes(instructions.length, mergedIngredients.length);
  const pricePerServing = estimatePricePerServing(mergedIngredients.length, instructions.length);

  const extendedIngredients = mergedIngredients.map((text, idx) => ({
    id: `${recipeId}-${idx}`,
    original: text,
    originalString: text,
    name: cleanedList[idx] || text,
    amount: null,
    unit: '',
  }));

  applyCostEstimates(extendedIngredients, pricePerServing, servings);

  const analyzedInstructions = instructions.length
    ? [
        {
          name: '',
          steps: instructions.map((step, idx) => ({
            number: idx + 1,
            step,
          })),
        },
      ]
    : [];

  const rawMetadata = {
    source: 'custom_csv',
    originalRow: row,
    cleanedIngredients: cleanedList,
  };

  return {
    id: recipeId,
    title,
    summary: row.Summary?.trim() || title,
    sourceUrl: null,
    image: imageUrl,
    servings,
    readyInMinutes,
    pricePerServing,
    extendedIngredients,
    instructions: instructions.join('\n\n'),
    analyzedInstructions,
    diets: [],
    dishTypes: [],
    vegetarian: false,
    vegan: false,
    glutenFree: false,
    dairyFree: false,
    veryHealthy: false,
    cheap: false,
    aggregateLikes: 0,
    spoonacularScore: null,
    healthScore: null,
    nutrition: null,
    rawSource: 'custom_csv',
    datasetMeta: {
      ...rawMetadata,
      heuristics: {
        servings,
        readyInMinutes,
        pricePerServing,
      },
    },
  };
};

const importCustomRecipes = async (options) => {
  const rows = await readCsvFile(options.csvPath);
  if (!rows.length) {
    console.log('No data rows detected in CSV.');
    return;
  }

  console.log(`Processing ${rows.length} recipe rows...`);
  let imported = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const recipe = await buildRecipePayload(rows[i], i, options);
    if (!recipe) {
      console.warn(`Skipping row ${i + 1}: missing title.`);
      continue;
    }

    if (options.dryRun) {
      console.log(`[dry-run] ${recipe.title} -> would assign id ${recipe.id}`);
      continue;
    }

    try {
      await saveRecipeToDatabase(recipe);
      imported += 1;
      if (imported % 25 === 0) {
        console.log(`Imported ${imported}/${rows.length} recipes...`);
      }
    } catch (error) {
      console.error(`Failed to save recipe "${recipe.title}":`, error.message || error);
    }
  }

  if (!options.dryRun) {
    console.log(`Import complete. Saved ${imported} recipe(s).`);
  } else {
    console.log('Dry run complete. No recipes saved.');
  }
};

if (require.main === module) {
  (async () => {
    try {
      const options = parseArgs();
      await importCustomRecipes(options);
    } catch (error) {
      console.error('Import failed:', error.message || error);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  importCustomRecipes,
};
