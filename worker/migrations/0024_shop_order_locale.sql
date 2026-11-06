-- The language the buyer used on the website when they placed a tools-shop order: the text messages about the order (received, paid,
-- confirmed, on its way, delivered, cancelled) are written in it. One plain new column with a default (Bangla, the site's first language),
-- so the release still running during the rollout keeps working.
ALTER TABLE shop_orders ADD COLUMN locale TEXT NOT NULL DEFAULT 'bn' CHECK (locale IN ('bn', 'en'));
