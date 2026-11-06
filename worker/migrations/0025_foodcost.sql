-- FoodCost Pro (docs/foodcost.md): recipe costing for students, on the website and in the Android app. Five new tables, all fc_; nothing
-- else changes, so the release still running during the rollout keeps working.

-- Every recipe belongs to a workspace: each student gets a personal one (made the first time they open FoodCost), so a bakery team can
-- share one later without changing these tables. `plan`: free (a few saved recipes) or pro (no limit), given by staff today — a paid plan is
-- a later decision (`plan_source` says how it came: admin, the website, Google Play).
CREATE TABLE fc_workspaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  name        TEXT NOT NULL DEFAULT '',
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  plan_until  TEXT,
  plan_source TEXT NOT NULL DEFAULT '' CHECK (plan_source IN ('','admin','web','play')),
  currency    TEXT NOT NULL DEFAULT 'BDT' CHECK (currency IN ('BDT','USD','GBP','EUR','AED')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE UNIQUE INDEX idx_fc_workspaces_student ON fc_workspaces(student_id);

-- Ingredients: the shared list staff keep in Admin → FoodCost (workspace_id NULL), and each workspace's own. Density (grams in one ml) and
-- the weight of one piece let weight, volume and pieces meet; the nutrition columns (per 100 g) are for phase 2 and stay empty until then.
-- Never deleted while a recipe uses one: switched off instead (active = 0).
CREATE TABLE fc_ingredients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER REFERENCES fc_workspaces(id) ON DELETE CASCADE,
  name_bn      TEXT NOT NULL DEFAULT '',
  name_en      TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  g_per_ml     REAL CHECK (g_per_ml IS NULL OR g_per_ml > 0),
  g_per_piece  REAL CHECK (g_per_piece IS NULL OR g_per_piece > 0),
  kcal         REAL,
  protein_g    REAL,
  carbs_g      REAL,
  fat_g        REAL,
  fiber_g      REAL,
  sugar_g      REAL,
  sodium_mg    REAL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort         INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (name_bn <> '' OR name_en <> '')
);
CREATE INDEX idx_fc_ingredients_workspace ON fc_ingredients(workspace_id, active, sort);

-- Prices, as packs ("৳120 for 1 kg"), one row per change so there is a history. workspace_id NULL: staff's default (the Dhaka average);
-- set: that workspace's own price, which replaces the default for it alone (its newest row counts). Money in paisa.
CREATE TABLE fc_prices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES fc_ingredients(id) ON DELETE CASCADE,
  workspace_id  INTEGER REFERENCES fc_workspaces(id) ON DELETE CASCADE,
  pack_qty      REAL NOT NULL CHECK (pack_qty > 0),
  pack_unit     TEXT NOT NULL,
  price_minor   INTEGER NOT NULL CHECK (price_minor >= 0),
  currency      TEXT NOT NULL DEFAULT 'BDT',
  supplier      TEXT NOT NULL DEFAULT '',
  bought_on     TEXT,
  staff_id      INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_fc_prices_lookup ON fc_prices(ingredient_id, workspace_id, id);

-- Recipes: what one batch makes (yield_qty of yield_unit, a label such as "slice"), its finished weight when the yield is counted (another
-- recipe may then use it by weight), the costs that are not ingredients and the pricing choice (JSON, read by shared/src/foodcost.ts).
-- Deleted softly; a recipe another one uses cannot be deleted.
CREATE TABLE fc_recipes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES fc_workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  notes        TEXT NOT NULL DEFAULT '',
  yield_qty    REAL NOT NULL CHECK (yield_qty > 0),
  yield_unit   TEXT NOT NULL,
  yield_label  TEXT NOT NULL DEFAULT '',
  output_g     REAL CHECK (output_g IS NULL OR output_g > 0),
  costs        TEXT NOT NULL DEFAULT '[]',
  pricing      TEXT NOT NULL DEFAULT '{"mode":"markup","pct":0}',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at   TEXT
);
CREATE INDEX idx_fc_recipes_workspace ON fc_recipes(workspace_id, deleted_at, updated_at);

-- A recipe's lines, in order: an ingredient, or another recipe of the same workspace, and how much of it.
CREATE TABLE fc_recipe_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id     INTEGER NOT NULL REFERENCES fc_recipes(id) ON DELETE CASCADE,
  sort          INTEGER NOT NULL DEFAULT 0,
  ingredient_id INTEGER REFERENCES fc_ingredients(id) ON DELETE CASCADE,
  sub_recipe_id INTEGER REFERENCES fc_recipes(id) ON DELETE CASCADE,
  qty           REAL NOT NULL CHECK (qty > 0),
  unit          TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  CHECK ((ingredient_id IS NULL) <> (sub_recipe_id IS NULL))
);
CREATE INDEX idx_fc_recipe_items_recipe ON fc_recipe_items(recipe_id, sort);
CREATE INDEX idx_fc_recipe_items_sub ON fc_recipe_items(sub_recipe_id) WHERE sub_recipe_id IS NOT NULL;
CREATE INDEX idx_fc_recipe_items_ingredient ON fc_recipe_items(ingredient_id) WHERE ingredient_id IS NOT NULL;
