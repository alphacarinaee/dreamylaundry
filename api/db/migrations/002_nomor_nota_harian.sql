-- Nomor nota harian: DL-YYMMDD-0001, nomor urut kembali ke 0001 setiap hari (WIB).
-- Memperbaiki 001: lpad(..., 4) memotong angka > 9999 sehingga nomor nota bentrok
-- setelah transaksi ke-10.000. Sekarang tetap 4 digit, dan tumbuh menjadi 5 digit
-- atau lebih kalau satu hari melebihi 9999 transaksi. Nota lama tidak diubah.

CREATE TABLE order_no_daily (
  day     date PRIMARY KEY,
  last_no integer NOT NULL CHECK (last_no > 0)
);

-- Lanjutkan dari nomor terbesar yang sudah ada per tanggal, supaya tidak bentrok
-- dengan nota yang dibuat sebelum migrasi ini (penting untuk transaksi hari ini).
INSERT INTO order_no_daily (day, last_no)
SELECT to_date(substr(order_no, 4, 6), 'YYMMDD'), max(split_part(order_no, '-', 3)::integer)
FROM orders
WHERE order_no ~ '^DL-[0-9]{6}-[0-9]+$'
GROUP BY 1;

-- Baris per tanggal dikunci sampai transaksi selesai, jadi dua kasir yang menyimpan
-- bersamaan tetap mendapat nomor berbeda. Kalau transaksi dibatalkan (ROLLBACK),
-- nomornya ikut batal sehingga tidak ada nomor yang terlewat.
CREATE FUNCTION next_order_no() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  d date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  n integer;
BEGIN
  INSERT INTO order_no_daily (day, last_no) VALUES (d, 1)
  ON CONFLICT (day) DO UPDATE SET last_no = order_no_daily.last_no + 1
  RETURNING last_no INTO n;
  RETURN 'DL-' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, greatest(4, length(n::text)), '0');
END $$;

ALTER TABLE orders ALTER COLUMN order_no SET DEFAULT next_order_no();
DROP SEQUENCE order_no_seq;
