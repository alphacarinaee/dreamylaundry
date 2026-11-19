-- Opsional: data pelanggan contoh (jangan dipakai di produksi)
INSERT INTO customers (name, phone, address, member_tier) VALUES
 ('Ibu Siti Rahmawati','0812-9843-1120','Jl. Melati No. 4B','Reguler'),
 ('Ibu Siska Amelia','0813-8899-7711','Jl. Kenanga 12','Gold'),
 ('Mba Anisa Rahma','0877-2233-4455','Perum Asri B-7','Reguler'),
 ('Pak Bagus Wicaksono','0811-9876-5432','Jl. Mawar 3','Silver')
ON CONFLICT (phone) DO NOTHING;
