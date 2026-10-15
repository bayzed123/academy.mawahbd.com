-- Class materials the owner manages in Admin -> Materials: files to download (PDF, ZIP, books, videos), recorded videos or other
-- things by link, live classes (link + time), plain links, and private groups (Facebook / WhatsApp / Telegram). Only NEW tables, so
-- the release that is still running while this one rolls out keeps working.
CREATE TABLE materials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id),
  kind         TEXT NOT NULL CHECK (kind IN ('video','pdf','zip','book','live','link','group')),
  title_bn     TEXT NOT NULL DEFAULT '',
  title_en     TEXT NOT NULL DEFAULT '',
  note_bn      TEXT NOT NULL DEFAULT '',            -- a line or two shown under the title
  note_en      TEXT NOT NULL DEFAULT '',
  -- how it is delivered: a file in the PRIVATE bucket (key under materials/, never served by /media), or a link
  r2_key       TEXT,
  filename     TEXT,
  mime         TEXT,
  size_bytes   INTEGER,
  url          TEXT,
  -- live class: the platform and the start time (UTC); private group: the platform of the group
  platform     TEXT,
  starts_at    TEXT,
  duration_min INTEGER,
  -- private group: the student gives their Facebook profile link first, so the owner can find and approve them
  ask_profile  INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at   TEXT,
  CHECK (r2_key IS NOT NULL OR url IS NOT NULL)
);
CREATE INDEX idx_materials_course ON materials(course_id, active, sort) WHERE deleted_at IS NULL;
CREATE INDEX idx_materials_kind ON materials(kind) WHERE deleted_at IS NULL;

-- Every download / open by a student: who got what, and when (shown in Admin -> Materials -> Downloads)
CREATE TABLE material_downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  student_id  INTEGER NOT NULL REFERENCES students(id),
  action      TEXT NOT NULL CHECK (action IN ('download','open')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_mdl_material ON material_downloads(material_id, created_at);
CREATE INDEX idx_mdl_student ON material_downloads(student_id, created_at);

-- Requests to join a private group: one per student per group; the owner approves or declines after checking the profile
CREATE TABLE group_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  student_id  INTEGER NOT NULL REFERENCES students(id),
  profile_url TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note        TEXT NOT NULL DEFAULT '',
  handled_by  INTEGER REFERENCES staff(id),
  handled_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (material_id, student_id)
);
CREATE INDEX idx_group_requests_status ON group_requests(status, created_at);
