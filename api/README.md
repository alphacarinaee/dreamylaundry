# Dreamy Laundry POS - Database & API

PostgreSQL + REST API (Node 20+, Express). Migrasi otomatis saat start.

## Struktur database
`users` (kasir/operator/owner) · `customers` · `services` · `aromas` · `orders` · `order_items` · `order_status_log` · view `v_receivables`

Aturan yang dijaga langsung oleh database:
- Status hanya boleh maju: antrian → proses → siap → diambil.
- Pesanan belum lunas tidak bisa berstatus "diambil".
- Nomor HP divalidasi, uang diterima tidak boleh kurang dari total saat lunas.
- Nama dan harga layanan disalin ke `order_items`, jadi nota lama tidak berubah kalau harga naik.
- Setiap perpindahan status tercatat di `order_status_log` beserta siapa yang mengubah.
- Total dihitung ulang di server dari harga di database, bukan dari angka kiriman frontend.

## Jalankan lokal
```bash
cp .env.example .env        # isi JWT_SECRET, password, DATABASE_URL
npm install
npm run seed                # buat tabel + layanan + aroma + akun owner & rina (kasir)
npm run seed:demo           # opsional: tambah 4 pelanggan contoh
npm run dev                 # http://localhost:3000/health
```
Login: `POST /auth/login {"username":"rina","password":"<KASIR_PASSWORD>"}` → token, kirim sebagai `Authorization: Bearer <token>`.

## Deploy opsi A: Neon (database) + Render (API), gratis
1. Buat project di neon.tech, salin connection string (sudah `sslmode=require`).
2. Dari laptop, isi `.env` dengan connection string itu dan `DATABASE_SSL=true`, lalu jalankan `npm run seed` sekali untuk membuat tabel dan akun.
3. Push folder ini ke GitHub. Di Render pilih New → Blueprint, arahkan ke repo (membaca `render.yaml`).
4. Isi `DATABASE_URL` (connection string Neon) dan `CORS_ORIGIN` (alamat frontend, mis. `https://nama.netlify.app`).
5. Cek `https://<nama-api>.onrender.com/health`.

Plan gratis Render tidur saat sepi, request pertama bisa lambat. Untuk outlet sungguhan pakai plan berbayar atau opsi B.

## Deploy opsi B: Docker di VPS
```bash
# .env berisi: DB_PASSWORD, JWT_SECRET, CORS_ORIGIN, OWNER_PASSWORD, KASIR_PASSWORD
docker compose up -d --build
docker compose exec api node src/migrate.js --seed
```
Pasang reverse proxy HTTPS (Caddy/Nginx) di depan port 3000. Backup: `docker compose exec db pg_dump -U laundry dreamy_laundry > backup.sql`

## Endpoint
| Method | Path | Keterangan |
|---|---|---|
| POST | /auth/login | token 12 jam |
| GET | /services, /aromas | katalog |
| GET / POST | /customers?q= | cari nama atau HP / daftar baru |
| POST | /orders | buat nota (atau draft dengan `is_draft:true`) |
| GET | /orders?status=&paid=&q=&from=&to= | Kanban dan riwayat |
| GET | /orders/:id | detail bon (id atau nomor nota) |
| PATCH | /orders/:id/status | maju satu tahap; ke "diambil" untuk yang belum lunas sertakan `payment` |
| GET | /stats/summary | KPI |

Contoh buat nota: `{"customer_id":1,"aroma_id":1,"payment_method":"tunai","paid_amount":70000,"items":[{"service_id":1,"qty":4.5},{"service_id":5,"qty":1}]}`

## Sebelum dipakai di produksi
- Ganti semua password dan `JWT_SECRET` dengan nilai acak.
- Set `CORS_ORIGIN` ke alamat frontend, jangan `*`.
- Aktifkan backup otomatis (Neon sudah menyediakan point-in-time restore).
- Rate limit login bersifat per-proses (memori); kalau menjalankan banyak instance, pindahkan ke Redis atau proxy.
