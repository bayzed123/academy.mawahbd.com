-- A buyer whose account was made at checkout (no password) gets one the moment their payment arrives: the website makes a simple password
-- and sends it, with the student ID and the sign-in page, by text message and e-mail — many buy inside Facebook or Messenger and could
-- not sign in again in another browser. When it was sent; cleared as soon as the student chooses their own password (the app then stops
-- saying "your password is in the message we sent").
ALTER TABLE students ADD COLUMN password_sent_at TEXT;
