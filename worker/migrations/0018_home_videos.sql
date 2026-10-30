-- The home page's videos (Admin -> Home videos): YouTube or Vimeo links the owner adds, each with a title in both languages and its own
-- on/off switch. Only the ones switched on show, in their order; with none on, the section is not shown at all. The page plays them in the
-- video site's own player, built from the checked video id (shared/src/videoEmbed.ts) — never from the pasted text.
-- A new table only, so the release that is still running while this one rolls out keeps working.
CREATE TABLE home_videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,                                 -- as the owner pasted it (a YouTube or Vimeo address)
  title_bn    TEXT NOT NULL DEFAULT '',
  title_en    TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at  TEXT
);
CREATE INDEX idx_home_videos_live ON home_videos(active, sort) WHERE deleted_at IS NULL;
