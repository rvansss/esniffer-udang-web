# E-Sniffer Web Dashboard

Dashboard pencatatan & monitoring e-nose udang (Next.js App Router + PostgreSQL/Prisma + MQTT worker).
Data chamber, sesi observasi batch udang, dan telemetri sensor terhubung lewat worker ingestion MQTT terpisah.

**Hosting produksi:** <https://e-sniffer.stas-rg.com/> — deploy dari repo
[`rvansss/esniffer-udang-web`](https://github.com/rvansss/esniffer-udang-web)
(remote `upstream`). Kontribusi berjalan lewat fork
[`dikialiftaufik/esniffer-udang-web`](https://github.com/dikialiftaufik/esniffer-udang-web)
(remote `origin`) dan masuk produksi via pull request; panduan lengkap ada di
`diki/Panduan_Sinkronisasi_GitHub_Fork.md`.

## Getting Started

```bash
npm install

# salin contoh env lalu sesuaikan DATABASE_URL / MQTT_URL / APP_BASE_URL
cp .env.example .env

# terapkan seluruh migrasi + generate prisma client
npx prisma migrate deploy
npx prisma generate

# seed akun demo: admin@esniffer.local / admin123, operator@esniffer.local / viewer123
npx prisma db seed

npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) — halaman utama pencatatan berada di `/batches`.

## Environment

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | PostgreSQL runtime (wajib). |
| `MQTT_URL` / `MQTT_ADMIN_URL` | Broker untuk worker ingestion & setup mosquitto (lihat `diki/Panduan_Menghubungkan_Alat_ESP32_Kelokal.md`). |
| `APP_BASE_URL` | Base URL publik. Wajib **https://** absolut di produksi (mis. `https://e-sniffer.stas-rg.com`) — dipakai allowlist Origin/CSRF (`lib/auth/guard.ts`) dan `metadataBase` SEO (`app/layout.tsx`). |

## Zona waktu

Tampilan tanggal/jam dan input operator menggunakan **WIB (Asia/Jakarta, UTC+7)**,
termasuk grafik, notifikasi, serta filter riwayat. Zona waktu perangkat tidak
mengubah interpretasi input. Konversi dan format bersama ada di `shared/datetime.ts`.
Database, API, log, dan telemetri tetap memakai UTC untuk menyimpan instant waktu.
CSV chamber dan dataset mempertahankan kolom UTC serta menambahkan kolom berakhiran
`_wib` dengan offset `+07:00`; ekspor per sesi menyediakan `waktu_wib`.
Tanggal pada nama file ekspor chamber juga mengikuti WIB.

## Database

Prasyarat: **PostgreSQL 12 atau lebih baru**. Migrasi `20261019070000_source_type_supermarket` memakai `ALTER TYPE ... ADD VALUE` yang baru boleh berjalan di dalam transaksi sejak PostgreSQL 12; versi lebih lama akan menggagalkan migrasi.

```bash
# terapkan seluruh migrasi
npx prisma migrate deploy

# cek migrasi dan schema.prisma tidak melenceng (drift check)
npm run db:drift
```

`npm run db:drift` memakai shadow database terpisah di server yang sama (`<DATABASE_URL>_shadow`, mis. `esniffer_dev_shadow`). Buat sekali dengan `createdb esniffer_dev_shadow`; override lewat env `SHADOW_DATABASE_URL` bila server melarang `CREATEDB`.

## Testing & kualitas

```bash
npm run typecheck   # tsc --noEmit
npx eslint .        # lint
npm run test:unit   # tes unit (node:test)
npm run test:db     # tes integrasi schema (dev DB)
npm run test:api    # tes HTTP API route handler (dev DB, jalankan serial)
```

Dokumen fitur, checklist verifikasi manual, dan rencana implementasi ada di folder `diki/`.
