-- Buying with a name, a mobile number and an address, and an e-mail only if the buyer wants to give one.
--   students.address         where the student lives, as given at checkout ('' when not given: old students, people added by hand)
--   orders.customer_address  the same, written on the order when it is placed (like the name, e-mail and phone already are)
--   idx_students_phone       a buyer who gave no e-mail is found by their mobile number: signing in, "forgot my password" and buying again
-- A buyer who gave no e-mail is stored under a made-up address (p<digits>@no-email.invalid) — the column stays required and unique, the
-- address can never receive mail, and nothing shows it. Two plain new columns and an index, so the release that is still running while
-- this one rolls out keeps working.
ALTER TABLE students ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_address TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_students_phone ON students(phone) WHERE phone IS NOT NULL;
