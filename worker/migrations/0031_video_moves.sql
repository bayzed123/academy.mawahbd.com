-- Admin → Video speed (services/videoMoves.ts): a lesson whose video lives in Google Drive is copied into Cloudflare Stream, which plays it
-- in the quality a student's internet can take (it steps down on a slow phone instead of stopping). One row per copy: queued → copying →
-- ready (the lesson now plays from Stream) | failed (with Stream's or Google's reason) | undone (the owner switched the lesson back to Drive).
-- The Drive link stays on the lesson, so switching back is always possible.
CREATE TABLE video_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  drive_id    TEXT NOT NULL,
  stream_uid  TEXT,
  -- the one-time address Stream copies from (/api/video-source/<token>, also in KV), while the copy runs
  source_token TEXT,
  state       TEXT NOT NULL CHECK (state IN ('queued','copying','ready','failed','undone')),
  problem     TEXT,
  minutes     REAL,
  started_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_video_moves_lesson ON video_moves(lesson_id, id);
CREATE INDEX idx_video_moves_state ON video_moves(state);
