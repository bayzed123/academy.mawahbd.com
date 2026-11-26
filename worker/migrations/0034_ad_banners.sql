-- Ads of the academy's own (Admin -> Banners -> "Ad on the pages people read"): a wide picture, and a taller one for phones, that opens
-- one of the academy's pages, shown by itself on every class page, every blog post, the blog's list and the classes' lists (the spots the
-- owner ticks: a comma list in ad_spots, e.g. "course,blog"). A fourth place a banner can go; SQLite cannot change a CHECK, so the table
-- is built again with every column and row as they are (the same way as 0020), and its index made again. The release still running while
-- this one rolls out never writes an ad, and reads the rows it knows exactly as before.
CREATE TABLE banners_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  placement         TEXT NOT NULL CHECK (placement IN ('hero','popup','shop','ad')),
  title_bn          TEXT NOT NULL DEFAULT '',
  title_en          TEXT NOT NULL DEFAULT '',
  text_bn           TEXT NOT NULL DEFAULT '',
  text_en           TEXT NOT NULL DEFAULT '',
  image_key         TEXT,
  mobile_image_key  TEXT,
  alt_bn            TEXT NOT NULL DEFAULT '',
  alt_en            TEXT NOT NULL DEFAULT '',
  button_bn         TEXT NOT NULL DEFAULT '',
  button_en         TEXT NOT NULL DEFAULT '',
  link_url          TEXT NOT NULL DEFAULT '',
  new_tab           INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  starts_at         TEXT,
  ends_at           TEXT,
  sort              INTEGER NOT NULL DEFAULT 100,
  popup_delay_sec   INTEGER NOT NULL DEFAULT 6,
  popup_repeat_days INTEGER NOT NULL DEFAULT 1,
  popup_pages       TEXT NOT NULL DEFAULT 'home' CHECK (popup_pages IN ('home','all')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT,
  layout            TEXT CHECK (layout IN ('left','center','split')),
  theme             TEXT CHECK (theme IN ('dark','ruby','gold','ivory')),
  icon              TEXT,
  focus             TEXT CHECK (focus IN ('top','center','bottom')),
  kicker_bn         TEXT NOT NULL DEFAULT '',
  kicker_en         TEXT NOT NULL DEFAULT '',
  ad_spots          TEXT NOT NULL DEFAULT ''
);
INSERT INTO banners_new (id, placement, title_bn, title_en, text_bn, text_en, image_key, mobile_image_key, alt_bn, alt_en, button_bn, button_en,
                         link_url, new_tab, active, starts_at, ends_at, sort, popup_delay_sec, popup_repeat_days, popup_pages, created_at,
                         updated_at, deleted_at, layout, theme, icon, focus, kicker_bn, kicker_en)
SELECT id, placement, title_bn, title_en, text_bn, text_en, image_key, mobile_image_key, alt_bn, alt_en, button_bn, button_en,
       link_url, new_tab, active, starts_at, ends_at, sort, popup_delay_sec, popup_repeat_days, popup_pages, created_at,
       updated_at, deleted_at, layout, theme, icon, focus, kicker_bn, kicker_en
FROM banners;
DROP TABLE banners;
ALTER TABLE banners_new RENAME TO banners;
CREATE INDEX idx_banners_live ON banners(placement, active, sort) WHERE deleted_at IS NULL;
