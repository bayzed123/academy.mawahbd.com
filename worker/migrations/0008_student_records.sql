-- Students the owner adds by hand or imports from a spreadsheet (people who studied before the website existed).
-- Two new columns with defaults, so the release that is still running while this one rolls out keeps working.
--   source: how the person came to have an account - they signed up themselves, the owner added them, or a list was imported
--   notes:  a private line only staff see ("paid by bKash in 2023, old group member")
ALTER TABLE students ADD COLUMN source TEXT NOT NULL DEFAULT 'signup' CHECK (source IN ('signup','admin','import'));
ALTER TABLE students ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_students_source ON students(source, created_at);
