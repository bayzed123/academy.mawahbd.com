-- How a banner looks (Admin -> Banners): where its words go, its colour theme, a large line drawing for a banner with no picture, which part
-- of a photo stays in view, and a small line above the title. Columns only, every one empty (NULL = "as before"), so the release that is
-- still running while this one rolls out keeps working and every banner made earlier looks exactly as it did.
ALTER TABLE banners ADD COLUMN layout    TEXT CHECK (layout IN ('left','center','split'));
ALTER TABLE banners ADD COLUMN theme     TEXT CHECK (theme IN ('dark','ruby','gold','ivory'));
ALTER TABLE banners ADD COLUMN icon      TEXT;                         -- one of the class icons; shown large when the banner has no picture
ALTER TABLE banners ADD COLUMN focus     TEXT CHECK (focus IN ('top','center','bottom'));
ALTER TABLE banners ADD COLUMN kicker_bn TEXT NOT NULL DEFAULT '';     -- a short line above the title (a category name, "New class" …)
ALTER TABLE banners ADD COLUMN kicker_en TEXT NOT NULL DEFAULT '';
