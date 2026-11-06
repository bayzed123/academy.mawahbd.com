-- Where a class is shown (Admin → Classes → a class → "Where is this class shown?"):
--   website  sold on the website, as every class so far (students who bought it study it on the website and in the Android app)
--   app      only in the Android app, free for everyone who signs in there — never listed or sold on the website (Google Play: nothing is
--            sold in the app, so a class there is free)
-- One plain new column with a default, so the release still running during the rollout keeps working.
ALTER TABLE courses ADD COLUMN channel TEXT NOT NULL DEFAULT 'website' CHECK (channel IN ('website', 'app'));
CREATE INDEX idx_courses_channel ON courses(channel, status);
