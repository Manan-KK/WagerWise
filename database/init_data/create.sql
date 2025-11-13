-- Recipe Management Database Setup Script
-- Normalized schema covering recipes, ingredients, equipment, and timing metadata

-- Drop existing tables to allow the script to be rerun during development
DROP TABLE IF EXISTS recipe_step_times;
DROP TABLE IF EXISTS recipe_steps;
DROP TABLE IF EXISTS recipe_equipment;
DROP TABLE IF EXISTS recipe_ingredients;
DROP TABLE IF EXISTS recipe_times;
DROP TABLE IF EXISTS time_categories;
DROP TABLE IF EXISTS measurement_units;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS ingredients;
DROP TABLE IF EXISTS user_favorite_recipes;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS users;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on username for faster lookups
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- User preferences for meal sorting and planning
CREATE TABLE user_preferences (
    preference_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sort_by VARCHAR(50) DEFAULT 'relevance',
    sort_order VARCHAR(10) DEFAULT 'asc',
    priority_factors JSONB DEFAULT '{"price": 1, "time": 1, "calories": 1, "health": 1}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id)
);

CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- Core recipe entity
CREATE TABLE recipes (
    recipe_id SERIAL PRIMARY KEY,
    spoonacular_id INTEGER UNIQUE NOT NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    servings INTEGER CHECK (servings > 0),
    source_url VARCHAR(255),
    image_url TEXT,
    ready_in_minutes INTEGER CHECK (ready_in_minutes >= 0),
    price_per_serving NUMERIC(10, 2),
    summary TEXT,
    raw_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recipes_spoonacular_id ON recipes (spoonacular_id);

-- Favorites stored per user referencing recipes
CREATE TABLE user_favorite_recipes (
    favorite_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES recipes (recipe_id) ON DELETE CASCADE,
    spoonacular_id INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, spoonacular_id)
);

CREATE INDEX idx_user_favorite_recipes_user ON user_favorite_recipes (user_id);
CREATE INDEX idx_user_favorite_recipes_recipe ON user_favorite_recipes (recipe_id);

-- Ingredient catalog kept independent for reuse across recipes
CREATE TABLE ingredients (
    ingredient_id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT
);

CREATE UNIQUE INDEX idx_ingredients_name_lower ON ingredients ((LOWER(name)));

-- Equipment catalog for reusable kitchen tools and appliances
CREATE TABLE equipment (
    equipment_id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT
);

CREATE UNIQUE INDEX idx_equipment_name_lower ON equipment ((LOWER(name)));

-- Measurement units allow consistent quantities across recipe ingredients
CREATE TABLE measurement_units (
    unit_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    abbreviation VARCHAR(12)
);

CREATE UNIQUE INDEX idx_measurement_units_name_lower ON measurement_units ((LOWER(name)));
CREATE UNIQUE INDEX idx_measurement_units_abbr_lower ON measurement_units ((LOWER(abbreviation)));

-- Junction table capturing ingredient usage per recipe
CREATE TABLE recipe_ingredients (
    recipe_ingredient_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes (recipe_id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients (ingredient_id),
    quantity NUMERIC(10, 2),
    unit_id INTEGER REFERENCES measurement_units (unit_id),
    preparation_notes VARCHAR(255),
    UNIQUE (recipe_id, ingredient_id, unit_id, preparation_notes)
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients (recipe_id);
CREATE INDEX idx_recipe_ingredients_ingredient ON recipe_ingredients (ingredient_id);

-- Junction table capturing equipment requirements per recipe
CREATE TABLE recipe_equipment (
    recipe_equipment_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes (recipe_id) ON DELETE CASCADE,
    equipment_id INTEGER NOT NULL REFERENCES equipment (equipment_id),
    quantity SMALLINT CHECK (quantity IS NULL OR quantity > 0),
    notes VARCHAR(255),
    UNIQUE (recipe_id, equipment_id)
);

CREATE INDEX idx_recipe_equipment_recipe ON recipe_equipment (recipe_id);

-- Time categories normalize different timing contexts (e.g., prep, cook, rest)
CREATE TABLE time_categories (
    time_category_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description TEXT
);

CREATE UNIQUE INDEX idx_time_categories_name_lower ON time_categories ((LOWER(name)));

-- Recipe-level timings linked to normalized categories
CREATE TABLE recipe_times (
    recipe_time_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes (recipe_id) ON DELETE CASCADE,
    time_category_id INTEGER NOT NULL REFERENCES time_categories (time_category_id),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
    UNIQUE (recipe_id, time_category_id)
);

CREATE INDEX idx_recipe_times_recipe ON recipe_times (recipe_id);

-- Optional step-by-step instructions with per-step timing if needed
CREATE TABLE recipe_steps (
    recipe_step_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes (recipe_id) ON DELETE CASCADE,
    step_number SMALLINT NOT NULL CHECK (step_number > 0),
    instruction TEXT NOT NULL,
    UNIQUE (recipe_id, step_number)
);

CREATE INDEX idx_recipe_steps_recipe ON recipe_steps (recipe_id);

-- Junction for associating step-specific time records to normalized categories
CREATE TABLE recipe_step_times (
    recipe_step_time_id SERIAL PRIMARY KEY,
    recipe_step_id INTEGER NOT NULL REFERENCES recipe_steps (recipe_step_id) ON DELETE CASCADE,
    time_category_id INTEGER NOT NULL REFERENCES time_categories (time_category_id),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
    UNIQUE (recipe_step_id, time_category_id)
);

CREATE INDEX idx_recipe_step_times_step ON recipe_step_times (recipe_step_id);
