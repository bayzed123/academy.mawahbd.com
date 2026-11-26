-- A class's offer price (Admin → class → Price): while it runs, the class sells at `offer_price` and every page shows the regular `price`
-- crossed out with the saving in per cent. `offer_ends_at` (UTC, "YYYY-MM-DDTHH:MM:SSZ") ends it by itself — "today only", a weekend;
-- empty means it runs until the owner removes it. Both empty = no offer. The offer is always lower than the price and at least ৳1
-- (a class that costs nothing is a free class, which works differently).
ALTER TABLE courses ADD COLUMN offer_price INTEGER CHECK (offer_price IS NULL OR offer_price >= 1);
ALTER TABLE courses ADD COLUMN offer_ends_at TEXT;
