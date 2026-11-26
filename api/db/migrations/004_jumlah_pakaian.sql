-- Jumlah pakaian (potong) per pesanan, dicatat kasir saat menerima cucian
-- dan dicocokkan saat cucian diserahkan. Kosong untuk pesanan lama.

ALTER TABLE orders
  ADD COLUMN garment_count integer CHECK (garment_count BETWEEN 1 AND 999);
