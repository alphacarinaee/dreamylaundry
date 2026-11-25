-- Metode pengambilan cucian: diambil sendiri di toko atau diantar (delivery).
-- Pesanan lama otomatis dianggap "ambil".

CREATE TYPE fulfillment_method AS ENUM ('ambil', 'antar');

ALTER TABLE orders
  ADD COLUMN fulfillment      fulfillment_method NOT NULL DEFAULT 'ambil',
  ADD COLUMN delivery_address text,
  ADD CONSTRAINT delivery_needs_address
    CHECK (fulfillment = 'ambil' OR length(trim(coalesce(delivery_address, ''))) >= 5);
