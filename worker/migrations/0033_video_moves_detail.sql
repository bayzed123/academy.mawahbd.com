-- Admin → Video speed: what Cloudflare Stream (or Google) actually said when a move failed or paused, so the reason can be read on the page
-- and acted on (the plain-words reason stays in `problem`; this is the service's own message, with anything key-like cut out).
ALTER TABLE video_moves ADD COLUMN detail TEXT;
