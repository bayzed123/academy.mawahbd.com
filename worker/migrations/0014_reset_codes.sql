-- "Forgot password" by a 6-digit code. The code goes by text message with no link in it (texts with a web address in them did not
-- arrive) and by e-mail; the student types it on the website with the new password. Only a keyed hash of the code is stored. A code
-- lives 15 minutes and may be tried 5 times; the route also caps how many codes one student can be sent per hour and per day.
CREATE TABLE reset_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_reset_codes_student ON reset_codes(student_id, created_at);
