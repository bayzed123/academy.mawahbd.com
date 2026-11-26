-- A class material's video sent in parts (Admin → Materials → a video file), like a lesson's video (0035): a video is no longer limited to
-- what one request can carry (95 MB), so a long class recording goes up whole — up to 4 GB. Which class and storage key the upload is
-- for, its size and part size, the file's name; the row goes when the upload ends (R2 drops a never-finished upload after 7 days).
CREATE TABLE material_uploads (
  upload_id  TEXT PRIMARY KEY,
  r2_key     TEXT NOT NULL,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  part_bytes INTEGER NOT NULL CHECK (part_bytes > 0),
  filename   TEXT NOT NULL DEFAULT 'video',
  staff_id   INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
