-- A student can delete their own account: on the website (Profile → Delete my account), in the Android app (Profile → Delete my account),
-- or staff do it for them on request (Admin → Students). Google Play requires this for every app that has accounts.
-- The row stays, emptied (no name, number, e-mail, address or password), because orders, enrolments and certificates point at it and
-- orders are kept for tax and accounting records (services/accountDeletion.ts). deleted_at says when; a deleted account is never listed,
-- counted, exported, signed in to or unblocked again. One plain new column, so the release still running during the rollout keeps working.
ALTER TABLE students ADD COLUMN deleted_at TEXT;
