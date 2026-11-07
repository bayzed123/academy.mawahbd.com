-- Notifications on the Android app (Firebase Cloud Messaging; worker/src/services/push.ts).
--
-- push_devices: one row per phone that allowed notifications. `token` is the address Google gave that copy of the app; `topics` (JSON) are
-- the Firebase "topics" the phone was added to: its language (lang-bn / lang-en: news for everyone) and, while a student is signed in on it,
-- each class they study (class-<id>: new lessons in that class). Kept so a change (another language, a new class, signing out) adds and
-- removes only the difference, and so turning notifications off removes every one. A phone signed out has no student.
CREATE TABLE push_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  lang       TEXT NOT NULL DEFAULT 'bn' CHECK (lang IN ('bn', 'en')),
  topics     TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_push_devices_student ON push_devices(student_id);

-- push_sends: every notification the website sent (or tried to): staff's own from Admin → Android app, and the automatic ones (a new free
-- class, new lessons in a class). What it said in both languages, what a tap opens, who it went to, and how it went (`problem` = why not).
CREATE TABLE push_sends (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('manual', 'new_class', 'new_lessons')),
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  audience   TEXT NOT NULL CHECK (audience IN ('all', 'class')),
  title_bn   TEXT NOT NULL,
  body_bn    TEXT NOT NULL,
  title_en   TEXT NOT NULL,
  body_en    TEXT NOT NULL,
  path       TEXT NOT NULL DEFAULT '/',
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  problem    TEXT,
  staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_push_sends_course ON push_sends(course_id, kind, created_at);
CREATE INDEX idx_push_sends_created ON push_sends(created_at);
