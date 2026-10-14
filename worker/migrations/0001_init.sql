-- =============================================================================
--  MAWAH Academy — core schema (Cloudflare D1 / SQLite)
--  Conventions: INTEGER ids, money in whole BDT (integer), UTC ISO-8601 TEXT timestamps,
--  soft delete via deleted_at where content must be recoverable.
--  NOTE: no semicolons inside string literals (the migration splitter is statement based).
-- =============================================================================

-- ---------- site settings (key/value, JSON values) ----------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_by  INTEGER
);

-- ---------- people ----------
CREATE TABLE staff (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('super_admin','content_manager','support','viewer')),
  password_hash        TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  sessions_valid_after TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE students (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name              TEXT NOT NULL,
  phone             TEXT,
  password_hash     TEXT,
  google_sub        TEXT UNIQUE,
  locale            TEXT NOT NULL DEFAULT 'bn' CHECK (locale IN ('bn','en')),
  blocked           INTEGER NOT NULL DEFAULT 0,
  blocked_reason    TEXT,
  email_verified_at TEXT,
  marketing_opt_in  INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  sessions_valid_after TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_students_created ON students(created_at);

-- password reset / e-mail verification tokens (only the SHA-256 of the token is stored)
CREATE TABLE auth_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('password_reset','email_verify')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('student','staff')),
  subject_id   INTEGER NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------- catalog ----------
CREATE TABLE categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL UNIQUE,
  name_bn   TEXT NOT NULL,
  name_en   TEXT NOT NULL,
  blurb_bn  TEXT NOT NULL DEFAULT '',
  blurb_en  TEXT NOT NULL DEFAULT '',
  accent    TEXT NOT NULL DEFAULT 'snack' CHECK (accent IN ('snack','cake','dessert','cook','sweet','frozen')),
  icon      TEXT NOT NULL DEFAULT 'cake',
  sort      INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE instructors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name_bn     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  headline_bn TEXT NOT NULL DEFAULT '',
  headline_en TEXT NOT NULL DEFAULT '',
  bio_bn      TEXT NOT NULL DEFAULT '',
  bio_en      TEXT NOT NULL DEFAULT '',
  credentials TEXT NOT NULL DEFAULT '',
  photo_key   TEXT,
  links       TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at  TEXT
);

CREATE TABLE courses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title_bn       TEXT NOT NULL,
  title_en       TEXT NOT NULL,
  short_bn       TEXT NOT NULL DEFAULT '',
  short_en       TEXT NOT NULL DEFAULT '',
  long_bn        TEXT NOT NULL DEFAULT '',
  long_en        TEXT NOT NULL DEFAULT '',
  banner_key     TEXT,
  icon           TEXT,
  category_id    INTEGER REFERENCES categories(id),
  instructor_id  INTEGER REFERENCES instructors(id),
  level          TEXT CHECK (level IN ('beginner','intermediate','advanced')),
  price          INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','coming_soon','published','archived')),
  details_url    TEXT,
  featured       INTEGER NOT NULL DEFAULT 0,
  cert_enabled   INTEGER NOT NULL DEFAULT 1,
  cert_template  TEXT NOT NULL DEFAULT 'classic',
  seo_title_bn   TEXT NOT NULL DEFAULT '',
  seo_title_en   TEXT NOT NULL DEFAULT '',
  seo_desc_bn    TEXT NOT NULL DEFAULT '',
  seo_desc_en    TEXT NOT NULL DEFAULT '',
  rating_avg     REAL NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  lesson_count   INTEGER NOT NULL DEFAULT 0,
  duration_sec   INTEGER NOT NULL DEFAULT 0,
  sort           INTEGER NOT NULL DEFAULT 0,
  launch_at      TEXT,
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at     TEXT
);
CREATE INDEX idx_courses_list     ON courses(status, deleted_at, sort, id);
CREATE INDEX idx_courses_category ON courses(category_id, status, deleted_at);
CREATE INDEX idx_courses_featured ON courses(featured, status, deleted_at);
CREATE INDEX idx_courses_price    ON courses(price);

CREATE TABLE modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title_bn   TEXT NOT NULL,
  title_en   TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  drip_days  INTEGER NOT NULL DEFAULT 0 CHECK (drip_days >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_modules_course ON modules(course_id, sort);

CREATE TABLE lessons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id    INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title_bn     TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'video' CHECK (type IN ('video','external','text','resource')),
  stream_uid   TEXT,
  external_url TEXT,
  body_bn      TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  is_preview   INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_lessons_module ON lessons(module_id, sort);
CREATE INDEX idx_lessons_course ON lessons(course_id);

CREATE TABLE lesson_resources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title_bn   TEXT NOT NULL DEFAULT '',
  title_en   TEXT NOT NULL DEFAULT '',
  r2_key     TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_resources_lesson ON lesson_resources(lesson_id);

-- ---------- bundles & coupons ----------
CREATE TABLE bundles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title_bn   TEXT NOT NULL,
  title_en   TEXT NOT NULL,
  desc_bn    TEXT NOT NULL DEFAULT '',
  desc_en    TEXT NOT NULL DEFAULT '',
  price      INTEGER NOT NULL CHECK (price >= 0),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  banner_key TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);

CREATE TABLE bundle_items (
  bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, course_id)
);

CREATE TABLE coupons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type              TEXT NOT NULL CHECK (type IN ('percent','flat')),
  value             INTEGER NOT NULL CHECK (value > 0),
  min_order         INTEGER NOT NULL DEFAULT 0,
  max_discount      INTEGER,
  starts_at         TEXT,
  expires_at        TEXT,
  max_uses          INTEGER,
  used_count        INTEGER NOT NULL DEFAULT 0,
  per_student_limit INTEGER NOT NULL DEFAULT 1,
  active            INTEGER NOT NULL DEFAULT 1,
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT
);

CREATE TABLE coupon_courses (
  coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, course_id)
);

-- ---------- orders, payments, invoices ----------
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT NOT NULL UNIQUE,
  invoice_no     TEXT UNIQUE,
  student_id     INTEGER NOT NULL REFERENCES students(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','awaiting_verification','paid','failed','cancelled','refunded')),
  subtotal       INTEGER NOT NULL CHECK (subtotal >= 0),
  discount       INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          INTEGER NOT NULL CHECK (total >= 0),
  currency       TEXT NOT NULL DEFAULT 'BDT',
  coupon_id      INTEGER REFERENCES coupons(id),
  coupon_code    TEXT,
  bundle_id      INTEGER REFERENCES bundles(id),
  method         TEXT CHECK (method IN ('bkash','nagad','rocket','card','free','manual','mock')),
  gateway        TEXT CHECK (gateway IN ('sslcommerz','bkash','manual','mock','free')),
  gateway_ref    TEXT,
  gateway_txn    TEXT,
  payer_number   TEXT,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  paid_at        TEXT,
  paid_claim     TEXT,
  refunded_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_orders_student ON orders(student_id, created_at);
CREATE INDEX idx_orders_status  ON orders(status, created_at);
CREATE INDEX idx_orders_paid    ON orders(paid_at);
-- a manual-payment transaction id can only ever be used on one order
CREATE UNIQUE INDEX idx_orders_manual_txn ON orders(gateway, gateway_txn)
  WHERE gateway = 'manual' AND gateway_txn IS NOT NULL;

CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id),
  title_bn   TEXT NOT NULL,
  title_en   TEXT NOT NULL,
  list_price INTEGER NOT NULL,
  price      INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order  ON order_items(order_id);
CREATE INDEX idx_order_items_course ON order_items(course_id);

-- raw gateway callbacks (audit + idempotency)
CREATE TABLE payment_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER REFERENCES orders(id),
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  verified   INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_payment_events_order ON payment_events(order_id);

-- gapless per-day invoice sequence: INV-<BRAND>-YYYYMMDD-0001
CREATE TABLE invoice_counters (
  day      TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

-- ---------- learning ----------
CREATE TABLE enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  order_id    INTEGER REFERENCES orders(id),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  source      TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','free','admin','bundle')),
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  revoked_at  TEXT,
  UNIQUE (student_id, course_id)
);
CREATE INDEX idx_enrollments_course ON enrollments(course_id, status);

CREATE TABLE lesson_progress (
  student_id   INTEGER NOT NULL REFERENCES students(id),
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id    INTEGER NOT NULL REFERENCES courses(id),
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (student_id, lesson_id)
);
CREATE INDEX idx_progress_course ON lesson_progress(student_id, course_id);

CREATE TABLE lesson_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  body        TEXT NOT NULL,
  answer      TEXT,
  answered_by INTEGER REFERENCES staff(id),
  answered_at TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','hidden')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_questions_lesson ON lesson_questions(lesson_id, status, created_at);
CREATE INDEX idx_questions_status ON lesson_questions(status, created_at);

-- reviews: only students with an active enrollment can write one (enforced in the service layer)
CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reply         TEXT,
  replied_by    INTEGER REFERENCES staff(id),
  replied_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (course_id, student_id)
);
CREATE INDEX idx_reviews_course ON reviews(course_id, status, created_at);
CREATE INDEX idx_reviews_status ON reviews(status, created_at);

CREATE TABLE certificates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  student_id      INTEGER NOT NULL REFERENCES students(id),
  course_id       INTEGER NOT NULL REFERENCES courses(id),
  enrollment_id   INTEGER REFERENCES enrollments(id),
  student_name    TEXT NOT NULL,
  course_title_bn TEXT NOT NULL,
  course_title_en TEXT NOT NULL,
  template        TEXT NOT NULL DEFAULT 'classic',
  issued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  revoked_at      TEXT,
  revoked_reason  TEXT,
  UNIQUE (student_id, course_id)
);
CREATE INDEX idx_certificates_issued ON certificates(issued_at);

-- ---------- content ----------
CREATE TABLE blog_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title_bn     TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  excerpt_bn   TEXT NOT NULL DEFAULT '',
  excerpt_en   TEXT NOT NULL DEFAULT '',
  body_bn      TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  cover_key    TEXT,
  tags         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  seo_title_bn TEXT NOT NULL DEFAULT '',
  seo_title_en TEXT NOT NULL DEFAULT '',
  seo_desc_bn  TEXT NOT NULL DEFAULT '',
  seo_desc_en  TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at   TEXT
);
CREATE INDEX idx_blog_list ON blog_posts(status, deleted_at, published_at);

-- ---------- audience ----------
CREATE TABLE notify_signups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  phone       TEXT,
  lang        TEXT NOT NULL DEFAULT 'bn',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  notified_at TEXT,
  UNIQUE (course_id, email)
);
CREATE INDEX idx_notify_pending ON notify_signups(course_id, notified_at);

CREATE TABLE subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  lang            TEXT NOT NULL DEFAULT 'bn',
  source          TEXT NOT NULL DEFAULT 'site',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unsubscribed_at TEXT
);

CREATE TABLE contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_contact_status ON contact_messages(status, created_at);

-- ---------- AI chatbot ----------
-- Provider API keys are NEVER stored here: they live in Wrangler secrets.
-- key_hint is only a masked display value refreshed from the secret at runtime.
CREATE TABLE ai_provider_configs (
  provider         TEXT PRIMARY KEY CHECK (provider IN ('workers_ai','gemini')),
  enabled          INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 0,
  model            TEXT NOT NULL,
  temperature      REAL NOT NULL DEFAULT 0.3,
  max_tokens       INTEGER NOT NULL DEFAULT 600,
  key_hint         TEXT,
  last_test_at     TEXT,
  last_test_ok     INTEGER,
  last_test_detail TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_by       INTEGER
);
CREATE UNIQUE INDEX idx_ai_single_active ON ai_provider_configs(is_active) WHERE is_active = 1;

CREATE TABLE chat_escalations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  lang       TEXT NOT NULL DEFAULT 'bn',
  question   TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'low_confidence',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_escalations_status ON chat_escalations(status, created_at);

-- ---------- audit trail ----------
CREATE TABLE activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff','student','system')),
  actor_id   INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  summary    TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_activity_time   ON activity_log(created_at);
CREATE INDEX idx_activity_action ON activity_log(action, created_at);
CREATE INDEX idx_activity_actor  ON activity_log(actor_type, actor_id, created_at);
