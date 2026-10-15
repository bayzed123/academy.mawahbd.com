-- Where a student account came from.
--   signup    the person registered themselves (the default, and what every existing student is)
--   checkout  made for a buyer who paid, or is about to pay, without registering ("guest checkout"): no password until they set one
--   admin     added by hand by the shop's staff
--   import    brought in from an old list
-- A "checkout" account with no class and no settled payment is a visitor who has not paid yet: it is hidden from the student lists and
-- counts, and removed by the housekeeping job after 30 days.
ALTER TABLE students ADD COLUMN source TEXT NOT NULL DEFAULT 'signup' CHECK (source IN ('signup','checkout','admin','import'));
CREATE INDEX idx_students_source ON students(source);
