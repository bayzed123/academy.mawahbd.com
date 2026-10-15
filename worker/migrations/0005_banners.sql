-- Marketing banners the owner manages in Admin -> Banners: the slider at the top of the home page ('hero') and the offer
-- pop-up ('popup'). A new table only, so the release that is still running while this one rolls out keeps working.
CREATE TABLE banners (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  placement         TEXT NOT NULL CHECK (placement IN ('hero','popup')),
  title_bn          TEXT NOT NULL DEFAULT '',
  title_en          TEXT NOT NULL DEFAULT '',
  text_bn           TEXT NOT NULL DEFAULT '',   -- one short line under the title
  text_en           TEXT NOT NULL DEFAULT '',
  image_key         TEXT,                       -- R2 key under banners/ (wide picture); NULL = a text-only banner
  mobile_image_key  TEXT,                       -- optional picture for phones (squarer); NULL = the wide one is used
  alt_bn            TEXT NOT NULL DEFAULT '',   -- what the picture shows (blind visitors, search engines)
  alt_en            TEXT NOT NULL DEFAULT '',
  button_bn         TEXT NOT NULL DEFAULT '',   -- the call-to-action button; empty = no button
  button_en         TEXT NOT NULL DEFAULT '',
  link_url          TEXT NOT NULL DEFAULT '',   -- where the button (or the whole picture) goes: /courses/…, https://…, tel:…, mailto:…
  new_tab           INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  starts_at         TEXT,                       -- first day shown (Bangladesh calendar day, YYYY-MM-DD); NULL = from now
  ends_at           TEXT,                       -- last day shown (inclusive); NULL = until switched off
  sort              INTEGER NOT NULL DEFAULT 100,
  popup_delay_sec   INTEGER NOT NULL DEFAULT 6, -- popup only: seconds on the page before it appears
  popup_repeat_days INTEGER NOT NULL DEFAULT 1, -- popup only: after it is closed, ask again after N days (0 = once per visit)
  popup_pages       TEXT NOT NULL DEFAULT 'home' CHECK (popup_pages IN ('home','all')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_banners_live ON banners(placement, active, sort) WHERE deleted_at IS NULL;
