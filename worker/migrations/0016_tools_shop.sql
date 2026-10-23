-- The tools shop (/shop): baking tools and packaging, sold by weight or size, delivered by courier anywhere in Bangladesh.
-- Separate from the classes: a product is not a course, a shop order is not a class order (it has a delivery address, a delivery fee,
-- cash on delivery and a courier's steps), and nothing here opens a class.

CREATE TABLE shop_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name_bn     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE shop_products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  category_id  INTEGER REFERENCES shop_categories(id) ON DELETE SET NULL,
  name_bn      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  short_bn     TEXT NOT NULL DEFAULT '',          -- one or two lines under the name, and the page's search description
  short_en     TEXT NOT NULL DEFAULT '',
  body_bn      TEXT NOT NULL DEFAULT '',          -- the full description (plain text; blank lines make paragraphs, "- " lines a list)
  body_en      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  featured     INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  sort         INTEGER NOT NULL DEFAULT 100,
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_shop_products_list ON shop_products(status, category_id, sort, id);

-- One row per weight or size ("500 g", "1 kg", "Pack of 50"): each has its own price. A product with one price has one row.
CREATE TABLE shop_variants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  label_bn    TEXT NOT NULL DEFAULT '',
  label_en    TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price > 0),             -- what the buyer pays, whole taka
  list_price  INTEGER NOT NULL DEFAULT 0 CHECK (list_price >= 0), -- the usual price, struck through with the "% off" when above price; 0 = none
  stock       INTEGER CHECK (stock IS NULL OR stock >= 0),     -- NULL = not counted; 0 = out of stock
  sku         TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE INDEX idx_shop_variants_product ON shop_variants(product_id, sort, id);

CREATE TABLE shop_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  image_key   TEXT NOT NULL,                      -- R2 key under gallery/ (public, content-hashed): the large picture
  thumb_key   TEXT,                               -- the small copy for the grid (NULL = the large one)
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_shop_images_product ON shop_images(product_id, sort, id);

-- A buyer's review: shown only once staff approve it. "verified" = the phone matches a delivered order of this product.
CREATE TABLE shop_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',           -- never shown; only to mark a verified buyer
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT NOT NULL DEFAULT '',
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_shop_reviews_product ON shop_reviews(product_id, status, created_at);

-- An order: what was bought, where it goes and how it is paid.
--   cash on delivery:  placed → confirmed → shipped → delivered (the courier collects the money)
--   SSLCommerz:        pending → paid → confirmed → shipped → delivered   (pending → failed / cancelled if the payment does not happen;
--                      pending → review when SSLCommerz takes the money but marks it risky: staff check it in the SSLCommerz panel first)
-- Staff can cancel before it is shipped; a paid order that is cancelled is refunded by hand (refunded).
CREATE TABLE shop_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT NOT NULL UNIQUE,            -- SHxxxxxxxx: the order code the buyer sees, and SSLCommerz's tran_id
  access_key     TEXT NOT NULL,                   -- in the buyer's order link, so only they can open it
  status         TEXT NOT NULL CHECK (status IN ('pending','placed','paid','review','confirmed','shipped','delivered','cancelled','failed','refunded')),
  payment        TEXT NOT NULL CHECK (payment IN ('cod','sslcommerz')),
  subtotal       INTEGER NOT NULL CHECK (subtotal >= 0),
  delivery_fee   INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total          INTEGER NOT NULL CHECK (total >= 0),
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT NOT NULL DEFAULT '',
  division_id    INTEGER NOT NULL,
  district_id    INTEGER NOT NULL,
  upazila_id     INTEGER NOT NULL DEFAULT 0,      -- 0 = the district's town or city area
  union_id       INTEGER NOT NULL DEFAULT 0,      -- 0 = not given
  place          TEXT NOT NULL,                   -- the names, as chosen, in English: "Union, Upazila, District, Division"
  address        TEXT NOT NULL,                   -- house, road, area or village
  note           TEXT NOT NULL DEFAULT '',        -- the buyer's note for the delivery
  gateway_txn    TEXT,
  staff_note     TEXT NOT NULL DEFAULT '',
  courier_ref    TEXT NOT NULL DEFAULT '',        -- the courier's tracking number, once shipped
  paid_at        TEXT,
  shipped_at     TEXT,
  delivered_at   TEXT,
  cancelled_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_shop_orders_status ON shop_orders(status, created_at);
CREATE INDEX idx_shop_orders_phone  ON shop_orders(phone, created_at);

CREATE TABLE shop_order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES shop_products(id) ON DELETE SET NULL,
  variant_id  INTEGER REFERENCES shop_variants(id) ON DELETE SET NULL,
  name_en     TEXT NOT NULL,                      -- as it was when bought
  name_bn     TEXT NOT NULL,
  label_en    TEXT NOT NULL DEFAULT '',
  label_bn    TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99)
);
CREATE INDEX idx_shop_order_items_order ON shop_order_items(order_id);
CREATE INDEX idx_shop_order_items_product ON shop_order_items(product_id);
