-- Manual (send-money) payments, second version: the student first says which number they will pay from and gets a payment window
-- (pay_by), then sends a TrxID and/or a screenshot of the payment (proof_*). Additive columns only, so the release that is still
-- running while this one rolls out keeps working.
ALTER TABLE orders ADD COLUMN pay_by    TEXT;  -- UTC deadline shown to the student; NULL for every other kind of order
ALTER TABLE orders ADD COLUMN proof_at  TEXT;  -- when the student first sent proof (TrxID and/or screenshot)
ALTER TABLE orders ADD COLUMN proof_key TEXT;  -- R2 key of the payment screenshot: private, staff only, deleted 90 days after the order is settled
