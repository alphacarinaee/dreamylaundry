# Dreamy Laundry POS: Sprint 1 dan cara deploy

Struktur repo:
- `api/` : Express + PostgreSQL (database, login, transaksi)
- `web/` : frontend kasir (`index.html` + `config.js`), tanpa build
- `render.yaml` : konfigurasi deploy API di Render. `netlify.toml` : deploy frontend di Netlify.

Cakupan Sprint 1: T-01, US-01 sampai US-08. Menu Status Pesanan, Riwayat (Sprint 2) serta Dashboard dan Pengaturan Harga (Sprint 3, khusus owner) baru berupa penanda.

## Urutan deploy (sekitar 45 menit pertama kali)
1. **Repo**: upload isi folder ini ke GitHub (repo privat). Pastikan tidak ada file `.env`.
2. **Database (Neon)**: buat project di neon.tech, salin connection string.
3. **Isi tabel dan akun** dari laptop (butuh Node 20+):
   ```
   cd api
   cp .env.example .env     # isi DATABASE_URL (dari Neon), DATABASE_SSL=true, JWT_SECRET (acak, min 24 huruf),
                            # OWNER_PASSWORD, KASIR_PASSWORD (min 8 karakter)
   npm install
   npm run seed             # membuat tabel, 6 layanan, 4 aroma, akun owner dan rina (kasir)
   ```
4. **API (Render)**: New, Blueprint, pilih repo (membaca `render.yaml`). Isi `DATABASE_URL` (string Neon) dan `CORS_ORIGIN` (sementara `*`). Setelah selesai, buka `https://<nama>.onrender.com/health`, harus muncul `{"ok":true}`.
5. **Frontend (Netlify)**: ubah `web/config.js` menjadi `window.API_URL = "https://<nama>.onrender.com";`, commit. Di Netlify: Add new site, Import from GitHub, pilih repo (publish folder `web` sudah diatur `netlify.toml`).
6. **Kunci CORS**: kembali ke Render, ubah `CORS_ORIGIN` menjadi alamat Netlify (mis. `https://nama.netlify.app`).
7. **Uji** memakai daftar di bawah, di tablet yang akan dipakai.

Render gratis tertidur saat sepi; login pertama bisa butuh sekitar 30 detik. Untuk outlet sungguhan gunakan paket berbayar.

## Daftar uji Sprint 1 (cocokkan dengan Acceptance Criteria)
| Story | Uji | Hasil yang benar |
|---|---|---|
| T-01 | Buka situs Netlify, login | Data layanan tampil dari database online |
| US-01 | Login `rina` (kasir) dengan password salah, lalu benar | Salah: pesan error. Benar: masuk ke layar kasir |
| US-02 | Login `owner`, lalu `rina` | Owner melihat menu Dashboard dan Pengaturan Harga, kasir tidak |
| US-03 | Ketik "sis" di kolom cari | Daftar pelanggan yang cocok muncul |
| US-04 | + Pelanggan Baru dengan HP 5 digit, lalu HP valid | Ditolak, lalu tersimpan dan otomatis terpilih |
| US-05 | Atur berat 4.5 kg, pilih Cuci Komplit Reguler | Subtotal Rp 31.500 |
| US-06 | Pilih aroma dan isi catatan, simpan | Aroma dan catatan ikut tersimpan di nota |
| US-07 | Tambah Bed Cover King, bayar tunai, tekan 70k | Total Rp 61.500, kembalian Rp 8.500 |
| US-08 | Simpan transaksi | Muncul nomor nota `DL-YYMMDD-NNNN`; cek tabel `orders` di Neon |

Semua baris lulus berarti Sprint 1 memenuhi DoD (uji di tablet, diperiksa anggota lain, dicatat di board).

## Masalah umum
- **Tulisan "Tidak bisa terhubung ke server"**: `API_URL` di `web/config.js` salah, atau API Render masih bangun.
- **CORS error di konsol browser**: `CORS_ORIGIN` di Render belum sama persis dengan alamat Netlify (tanpa garis miring di akhir).
- **Login selalu gagal**: seed belum dijalankan ke database Neon yang sama, atau password di `.env` saat seed berbeda dengan yang dipakai login.
- **API gagal start**: `JWT_SECRET` kosong atau kurang dari 24 karakter.
