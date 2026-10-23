-- Landing pages: any number of pages the owner builds from blocks (a banner, words, pictures, a video, a class with its Buy button,
-- a price with its saving, questions and answers, reviews, a WhatsApp button), at /l/<slug> (Bangla) and /en/l/<slug> (English).
-- The blocks are one JSON list, checked block by block by the Worker before it is stored (worker/src/services/landing.ts).
CREATE TABLE landing_pages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title_bn       TEXT NOT NULL DEFAULT '',
  title_en       TEXT NOT NULL DEFAULT '',
  description_bn TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  blocks         TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  published_at   TEXT,
  deleted_at     TEXT
);
CREATE INDEX idx_landing_status ON landing_pages(status, deleted_at);
