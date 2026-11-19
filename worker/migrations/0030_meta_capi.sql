-- Meta Conversions API. At checkout the buyer's browser tells the server about the visit — Meta's own first-party cookies (_fbp, and _fbc
-- when they came from an ad), the browser and its address — and that is kept with the order, only when the visitor may be counted (not
-- with "Do Not Track", Global Privacy Control, the footer's "stop counting", or in Europe/UK without a yes). When the order is paid —
-- however late, by SSLCommerz or by staff approving a send-money or Bangla QR payment — the server reports the purchase to Meta with it,
-- once (capi_sent_at), and then forgets it (ad_track is cleared).
ALTER TABLE orders ADD COLUMN ad_track TEXT;
ALTER TABLE orders ADD COLUMN capi_sent_at TEXT;
