-- A class's demo class (Admin → Classes → a class → Demo class): a YouTube or Vimeo video anyone can watch on the class page before
-- enrolling, with a title and a few lines of its own in both languages. The page shows it under the class's description and plays it
-- right there, in the video site's own player built from the checked video id (shared/src/videoEmbed.ts) — never from the pasted text.
-- Empty address: no demo class. New columns with defaults only, so the release still running while this one rolls out keeps working.
ALTER TABLE courses ADD COLUMN demo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN demo_title_bn TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN demo_title_en TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN demo_text_bn TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN demo_text_en TEXT NOT NULL DEFAULT '';
