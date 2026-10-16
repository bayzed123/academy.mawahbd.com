-- More than one picture for a class, shown on its page ("Read details") under the main picture. The owner adds them in
-- Admin -> Classes -> a class -> Pictures. A new table only, so the release that is still running while this one rolls out keeps working.
CREATE TABLE course_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  image_key   TEXT NOT NULL,                   -- R2 key under gallery/ (public pictures only, content-hashed): the large picture
  thumb_key   TEXT,                            -- a small copy for the grid, so phones do not download twelve large files (NULL = use the large one)
  caption_bn  TEXT NOT NULL DEFAULT '',        -- one short line shown under the picture when it is opened large
  caption_en  TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_course_images_course ON course_images(course_id, sort, id);
