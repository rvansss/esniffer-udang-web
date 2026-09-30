# Laporan Kemajuan dan Audit Terarah Fase 1

Dokumen ini mencatat hasil audit terarah atas penyelesaian **Fase 1 (Fondasi repository, kontrak bersama, validator, parser, hash kanonikal, fixtures, pengujian, logger, dan skeleton worker)** per 30 September 2026. Dokumen ini menjadi acuan bagi agent dan pengembang pada fase berikutnya.

---

## 1. Audit Implementasi RFC 8785 & Canonical Payload Hash

### Temuan & Implementasi
- **Library Referensi RFC 8785:**
  Implementasi di [`shared/canonical.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/shared/canonical.ts) menggunakan package resmi `canonicalize` (versi 5.1.0, karya Samuel Erdtman — salah satu editor/co-author spesifikasi RFC 8785).
- **Penolakan Duplicate JSON Keys:**
  Fungsi `assertNoDuplicateKeys(rawString)` dijalankan langsung pada string JSON mentah **sebelum** pemanggilan `JSON.parse`. Hal ini krusial karena mesin JavaScript (`JSON.parse`) secara otomatis menimpa key duplikat sehingga informasi duplikasi hilang jika tidak diperiksa terlebih dahulu.
- **Integritas Hash Deduplikasi:**
  `payload_sha256` dihitung dari bytes kanonikal hasil serialisasi payload asli yang immutable. Normalisasi database (misal sensor di luar batas menjadi `null` dengan quality `OUT_OF_RANGE`), metadata server (`received_at`, `reading_id`), dan rekonstruksi waktu selanjutnya **tidak pernah mengubah** nilai `payload_sha256`.

---

## 2. Audit Snapshot Pagination & Karakteristik Sequence PostgreSQL

### Peringatan Kritis Urutan Sequence vs Commit
PostgreSQL sequence generator (`nextval`) **TIDAK mengikuti urutan commit transaksi**. Sequence dialokasikan secara independen di luar batas transaksi untuk performa dan tidak pernah di-rollback.

### Skenario Anomali Late-Commit
1. **Waktu $t_1$:** Transaksi $A$ mengalokasikan sequence 100 via `nextval()`. Transaksi $A$ masih berjalan (*in-flight*).
2. **Waktu $t_2$:** Transaksi $B$ mengalokasikan sequence 101 via `nextval()`.
3. **Waktu $t_3$:** Transaksi $B$ berhasil commit. Baris dengan sequence 101 kini terlihat (*committed*) di database.
4. **Waktu $t_4$:** Klien membaca Halaman 1. Bila server menggunakan *naive watermark* `SELECT MAX(history_sequence)`, watermark yang dibaca adalah 101. Klien menerima halaman pertama dengan cursor yang membawa watermark 101.
5. **Waktu $t_5$:** Transaksi $A$ akhirnya commit dengan sequence 100.
6. **Waktu $t_6$:** Klien meminta Halaman 2 menggunakan cursor Halaman 1 (watermark=101). Karena sequence $100 \le 101$, Transaksi $A$ memenuhi syarat filter watermark. Jika sort position baris $A$ berada pada rentang Halaman 2, data $A$ muncul di tengah traversal; bila posisinya pada Halaman 1 sudah terlewat, data $A$ terlewat (*missed*) dari pagination ini.

### Mekanisme Visibility untuk Keamanan Watermark
- **Opsi A (Active Transaction Boundary):**
  Watermark tidak sekadar `max(history_sequence)`, melainkan dibatasi oleh transaksi aktif:
  $$\text{safeWatermark} = \text{COALESCE}(\min(\text{in\_flight\_sequence}) - 1, \max(\text{committed\_sequence}))$$
  atau memanfaatkan PostgreSQL transaction snapshot (`pg_snapshot` / `txid_snapshot`). Fungsi pemodelan aplikasi `calculateSafeWatermark()` telah ditambahkan di [`shared/pagination.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/shared/pagination.ts).
- **Opsi B (Commit-Time Allocation):**
  Nomor `history_sequence` hanya dialokasikan saat commit menggunakan lock terkoordinasi atau status visibilitas bertahap.

### Status Verifikasi
> [!WARNING]
> **Jaminan transaksi ini BELUM TERVERIFIKASI pada Fase 1.**
> Pengujian di Fase 1 baru memvalidasi logika pemodelan unit test in-memory. Jaminan konkurensi fisik **WAJIB diuji secara nyata terhadap PostgreSQL pada Fase 2 (skenario T-HIS-04).**

---

## 3. Audit Kode, Duplikasi Aturan, dan Logger

### Kode & Import
- Seluruh import bertipe (`type`) menggunakan sintaks `import { type ... }` sesuai standar Node.js 22 ESM (`--experimental-strip-types`).
- Tidak ada dead code atau unused functions. Semua helper memiliki pemanggil nyata di unit test dan skeleton worker.
- Aturan validasi sensor, unit, batas angka, dan evaluasi timestamp dipusatkan di folder `shared/` (`units.ts`, `telemetry-schema.ts`, `time.ts`) tanpa duplikasi di layer worker.

### Audit Structured Logger
- **Redaksi:** Field sensitif (`password`, `token`, `secret`, `cookie`, `database_url`, `authorization`, `raw_payload`) secara otomatis diganti dengan `[REDACTED]`.
- **Batas Input:** String lebih panjang dari 256 karakter dipotong dengan akhiran `...[TRUNCATED]` untuk mencegah eksploitasi log injection atau kebocoran memori.
- **Konteks Korelasi:** `correlation_id` / `request_id`, `device_id`, dan `message_id` diteruskan menggunakan `AsyncLocalStorage` tanpa perlu *parameter drilling*.
- **Pencatatan Error Sekali (Single Logging Point):**
  Layer domain dan fungsi validasi hanya melempar typed error (`TelemetryValidationError`, `TimeValidationError`, `CanonicalizationError`). Pencatatan log terstruktur lengkap dilakukan tepat satu kali di layer batas (`worker/pipeline.ts`).
- **Pengendalian Volume Log:**
  - Paket telemetry sukses (`accepted`) dan duplikat wajar (`duplicate`) dicatat pada level `DEBUG` (untuk metrik/counter di produksi, bukan `INFO` per paket).
  - Duplikasi error identik saat outage (misal database mati) diredam otomatis oleh `StructuredLogger` menggunakan suppression window 5 detik, mencegah banjir I/O pada stdout/stderr.

---

## 4. Verifikasi `components/charts/ChartPanel.tsx`

Perubahan pada [`components/charts/ChartPanel.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/charts/ChartPanel.tsx) diperiksa secara ketat melalui `git diff`:
- Perubahan **hanya** mendefinisikan interface `SensorChartPoint` dan mengganti state `useState<any[]>([])` menjadi `useState<SensorChartPoint[]>([])`.
- Tidak ada perubahan alur runtime, logika fetching, timing polling 5 detik, buffer 20 titik, maupun rendering grafik Recharts.
- Perubahan ini menyelesaikan error `@typescript-eslint/no-explicit-any` pada linter.

---

## 5. Ringkasan Hasil Pengujian Mutu

| Uji Mutu | Perintah | Status | Catatan |
|---|---|---|---|
| **Unit Tests** | `npm test` | **51 / 51 Lulus** | 0 failed, waktu eksekusi ~120 ms |
| **Typecheck** | `npm run typecheck` | **0 Error** | `tsc --noEmit` target ES2022 |
| **Lint** | `npm run lint` | **0 Error** | `eslint` bersih |
| **Production Build** | `npm run build` | **Sukses** | Next.js 16.3 Turbopack compiled |
| **Bundle Isolation** | Grep worker di web | **Terisolasi** | Web bundle tidak mengimpor modul `worker/` |

---

## 6. Hal yang Membutuhkan Integration Test Lanjutan

Daftar berikut berada di luar cakupan Fase 1 dan menjadi target pengujian integrasi pada fase-fase berikutnya:

1. **Fase 2 (PostgreSQL & Prisma):**
   - **T-HIS-04:** Uji konkurensi snapshot pagination di mana transaksi terlambat commit terjadi secara fisik di PostgreSQL.
   - **T-ING-05 / T-ING-07:** Constraint unik database `(device_id, message_id)` dan verifikasi deteksi konflik hash di level database.
   - **T-DAT-01:** Verifikasi constraint SQL lintas-tabel (known-time mewajibkan `measured_at`, chamber, assignment, dan sequence; unknown-time mewajibkan semuanya null).
   - **Pool Saturation & N+1:** Pengujian batas koneksi pool Prisma terpisah antara web dan worker.
2. **Fase 3 (Mosquitto & Worker MQTT):**
   - **T-ING-01 & T-SEC-03:** Uji end-to-end dengan Mosquitto broker aktif, autentikasi TLS/ACL per device, dan isolasi topic antar-perangkat.
   - **T-STS-02:** Verifikasi perilaku retained message replay saat broker/worker restart terhadap status `UNKNOWN` dan ketidaktermajuan `last_seen_at`.
   - **T-REL-01, T-REL-02, T-REL-03:** Uji ketahanan crash database, worker restart, dan broker restart dengan verifikasi zero data loss dan at-least-once delivery.
