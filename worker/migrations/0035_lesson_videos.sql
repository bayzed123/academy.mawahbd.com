-- A lesson's video kept in the website's own storage (Cloudflare R2): the owner uploads it in Admin (the browser first makes it smaller —
-- 720p, about 2 Mbit/s — so it plays without stopping on a phone's internet), or moves a Google Drive lesson there (Admin → Video speed).
-- While video_key is set, the lesson plays that copy, through the same address the website and the Android app already use for a Drive
-- video (/api/student/lessons/<id>/media); the lesson's link (Drive, YouTube, Stream) is kept, so taking the copy off goes back to it.
ALTER TABLE lessons ADD COLUMN video_key TEXT;
ALTER TABLE lessons ADD COLUMN video_bytes INTEGER NOT NULL DEFAULT 0;

-- An upload in progress (R2 sends a big file in parts): which lesson and storage key it is for, its size and part size, so a part or the
-- finish can only ever go where the upload was started. The row goes when the upload ends; R2 drops a never-finished upload after 7 days.
CREATE TABLE video_uploads (
  upload_id  TEXT PRIMARY KEY,
  r2_key     TEXT NOT NULL,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  part_bytes INTEGER NOT NULL CHECK (part_bytes > 0),
  staff_id   INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_video_uploads_lesson ON video_uploads(lesson_id);
