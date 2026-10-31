-- Sending a shop order to a courier (Admin -> Shop -> Orders -> Send to Steadfast / Send to Pathao) and the couriers' own news of the
-- parcel afterwards (their webhooks: /api/courier/steadfast and /api/courier/pathao). The order keeps which courier has it, the
-- courier's own number for it (the consignment id), its last word on the parcel and when it said it; `courier_ref`, the tracking
-- code the buyer sees, is the column that already exists. Every word a courier sends is kept in courier_events, oldest first, so staff
-- can read what happened to a parcel in the courier's own words.
-- New columns with defaults and a new table only, so the release that is still running while this one rolls out keeps working.
ALTER TABLE shop_orders ADD COLUMN courier TEXT NOT NULL DEFAULT '' CHECK (courier IN ('','steadfast','pathao'));
ALTER TABLE shop_orders ADD COLUMN courier_cid TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN courier_status TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN courier_at TEXT;
CREATE INDEX idx_shop_orders_courier ON shop_orders(courier, courier_cid) WHERE courier_cid != '';

CREATE TABLE courier_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  courier     TEXT NOT NULL CHECK (courier IN ('steadfast','pathao')),
  event       TEXT NOT NULL,                     -- "booked", Steadfast's notification_type, Pathao's event ("order.delivered" …)
  status      TEXT NOT NULL DEFAULT '',          -- the courier's word for the parcel at that moment
  message     TEXT NOT NULL DEFAULT '',          -- its own sentence, when it sent one
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_courier_events_order ON courier_events(order_id, id);
