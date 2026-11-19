INSERT INTO services (name, description, category, unit, price, est_hours) VALUES
 ('Cuci Komplit Reguler','Cuci, kering, setrika, 2 hari','kiloan','kg',7000,48),
 ('Setrika Saja','Setrika uap rapi wangi','kiloan','kg',5000,24),
 ('Cuci Kering Lipat','Tanpa setrika, langsung dilipat','kiloan','kg',6000,24),
 ('Express 6 Jam','Prioritas cuci kering setrika','express','kg',12000,6),
 ('Bed Cover King','Plastik vakum','satuan','pcs',30000,72),
 ('Jas Formal / Blazer','Dry cleaning + hanger','satuan','pcs',35000,72)
ON CONFLICT (name) DO NOTHING;
INSERT INTO aromas (name) VALUES ('Ocean Fresh'),('Lavender Dream'),('Soft Floral'),('Sakura Blossom')
ON CONFLICT (name) DO NOTHING;
