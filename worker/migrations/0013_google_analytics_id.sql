-- The shop's Google Analytics 4 measurement ID (the "G-…" number of the Google tag). It is a public number — every visitor can read it in
-- the page — so it is filled in here, once, and only if the owner has not typed one already. Changing or clearing it later in
-- Admin → Settings → Analytics is never undone by this file (a migration runs once). The property (559265538) and the data stream
-- (16139065386) are public numbers too; they live in wrangler.toml. Local and test databases are cleared of the ID again by
-- worker/seed/dev-demo.sql, and pages only ever carry the tag on the real site (worker/src/lib/tracking.ts).
INSERT INTO settings (key, value) VALUES ('analytics', '{"ga4":"G-J0R62NQJD4","clarity":"","meta_pixel":""}')
ON CONFLICT(key) DO UPDATE SET value = json_set(settings.value, '$.ga4', 'G-J0R62NQJD4')
WHERE COALESCE(json_extract(settings.value, '$.ga4'), '') = '';
