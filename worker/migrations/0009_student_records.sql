-- Students the owner adds by hand or imports from a spreadsheet (people who studied before the website existed).
-- One new column with a default, so the release that is still running while this one rolls out keeps working.
--   notes:  a private line only staff see ("paid by bKash in 2023, old group member")
-- (How a person came to have an account - signup / checkout / admin / import - is students.source, added by 0008_guest_checkout.sql.)
ALTER TABLE students ADD COLUMN notes TEXT NOT NULL DEFAULT '';
