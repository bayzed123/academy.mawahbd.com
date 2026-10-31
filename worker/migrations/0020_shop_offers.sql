-- The shop's offers (Admin -> Shop -> Settings, Admin -> Banners):
--   * a cash-on-delivery charge: what the couriers keep of the cash they collect (Steadfast and Pathao take 1%), passed on to the buyer
--     who pays on delivery. Worked out by the Worker for each order and stored with it, so a later change of the rate never changes an
--     order already placed. 0 = none (every order before this one).
--   * banners for the shop's own pages: a third place a banner can go, beside the home page's slider and the offer pop-up. SQLite cannot
--     change a CHECK, so the table is built again with every column and row as they are, and its index made again.
--   * the free-delivery offer becomes a switch of its own (on: from the amount given, 0 = every order; off: the delivery charges apply).
--     What was "free delivery everywhere" stays free for every order, and what was "free from ৳X" stays free from ৳X.
-- A new column with a default and a CHECK that only allows more: the release still running while this one rolls out keeps working (an
-- offer "from ৳X" reads there as free delivery for every order, for the minutes until this release is live; the live shop has none).
ALTER TABLE shop_orders ADD COLUMN cod_fee INTEGER NOT NULL DEFAULT 0 CHECK (cod_fee >= 0);

CREATE TABLE banners_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  placement         TEXT NOT NULL CHECK (placement IN ('hero','popup','shop')),
  title_bn          TEXT NOT NULL DEFAULT '',
  title_en          TEXT NOT NULL DEFAULT '',
  text_bn           TEXT NOT NULL DEFAULT '',
  text_en           TEXT NOT NULL DEFAULT '',
  image_key         TEXT,
  mobile_image_key  TEXT,
  alt_bn            TEXT NOT NULL DEFAULT '',
  alt_en            TEXT NOT NULL DEFAULT '',
  button_bn         TEXT NOT NULL DEFAULT '',
  button_en         TEXT NOT NULL DEFAULT '',
  link_url          TEXT NOT NULL DEFAULT '',
  new_tab           INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  starts_at         TEXT,
  ends_at           TEXT,
  sort              INTEGER NOT NULL DEFAULT 100,
  popup_delay_sec   INTEGER NOT NULL DEFAULT 6,
  popup_repeat_days INTEGER NOT NULL DEFAULT 1,
  popup_pages       TEXT NOT NULL DEFAULT 'home' CHECK (popup_pages IN ('home','all')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT,
  layout            TEXT CHECK (layout IN ('left','center','split')),
  theme             TEXT CHECK (theme IN ('dark','ruby','gold','ivory')),
  icon              TEXT,
  focus             TEXT CHECK (focus IN ('top','center','bottom')),
  kicker_bn         TEXT NOT NULL DEFAULT '',
  kicker_en         TEXT NOT NULL DEFAULT ''
);
INSERT INTO banners_new (id, placement, title_bn, title_en, text_bn, text_en, image_key, mobile_image_key, alt_bn, alt_en, button_bn, button_en,
                         link_url, new_tab, active, starts_at, ends_at, sort, popup_delay_sec, popup_repeat_days, popup_pages, created_at,
                         updated_at, deleted_at, layout, theme, icon, focus, kicker_bn, kicker_en)
SELECT id, placement, title_bn, title_en, text_bn, text_en, image_key, mobile_image_key, alt_bn, alt_en, button_bn, button_en,
       link_url, new_tab, active, starts_at, ends_at, sort, popup_delay_sec, popup_repeat_days, popup_pages, created_at,
       updated_at, deleted_at, layout, theme, icon, focus, kicker_bn, kicker_en
FROM banners;
DROP TABLE banners;
ALTER TABLE banners_new RENAME TO banners;
CREATE INDEX idx_banners_live ON banners(placement, active, sort) WHERE deleted_at IS NULL;

-- "free delivery everywhere" (the old switch on): the offer, on, for every order
UPDATE settings SET value = json_set(value, '$.free_over', 0) WHERE key = 'store' AND json_extract(value, '$.free_delivery') = 1;
-- "free from ৳X" (the old switch off, an amount given): the offer, on, from ৳X
UPDATE settings SET value = json_set(value, '$.free_delivery', json('true'))
WHERE key = 'store' AND json_extract(value, '$.free_delivery') = 0 AND json_extract(value, '$.free_over') > 0;
