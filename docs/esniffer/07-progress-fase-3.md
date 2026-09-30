# Laporan Kemajuan dan Implementasi Fase 3: Mosquitto & Worker MQTT

Dokumen ini mencatat hasil audit pra-Fase 3 serta penyelesaian penuh **Fase 3 (Mosquitto broker lokal, kredensial & ACL per perangkat, worker MQTT proses terpisah, persistence PostgreSQL transaksi tunggal, simulator perangkat, dan 9 pengujian integrasi End-to-End)** per 30 September 2026.

---

## 1. Hasil Audit Tiga Poin Kritis Pra-Fase 3

### 1.1 Transaksi Tunggal untuk Watermark & Reading Insertion/Promotion
- **Temuan:** Alokasi sequence di luar transaksi utama dapat menyebabkan row lock terlepas sebelum data tersimpan, membuka celah sequence out-of-order atau nomor sequence terbuang saat commit gagal.
- **Implementasi:**
  - Seluruh alokasi `history_sequence` pada [`worker/storage.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/worker/storage.ts) kini dijalankan di dalam blok `prisma.$transaction(async (tx) => { ... })`.
  - Fungsi `insertReading` mengunci baris watermark (`id = 1`), mengalokasikan nomor sequence berikutnya, dan meng-insert data reading pada `tx` yang sama.
  - Fungsi `promoteUnknownReading` mengalokasikan sequence baru dan mempromosikan reading `UNKNOWN` menjadi `RECONSTRUCTED` dalam transaksi tunggal.
  - Diverifikasi melalui [`test/db/persistence-transaction.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/db/persistence-transaction.test.ts) (4/4 lulus): saat transaksi rollback, alokasi sequence ikut ter-rollback; saat transaksi A menahan lock, transaksi B tertahan dan sequence B tepat bernilai sequence A + 1.

### 1.2 Penyelarasan Riwayat Migrasi Prisma (`_prisma_migrations`)
- **Tindakan:**
  - Migrasi `20260930_init` yang sebelumnya diterapkan via `psql` diselaraskan menggunakan:
    ```bash
    npx prisma migrate resolve --applied 20260930_init
    ```
  - Verifikasi status: `npx prisma migrate status` melaporkan `Database schema is up to date!`.
  - Pembuktian clean deployment: Dibuat basis data baru `esniffer_test_deploy`, dijalankan `prisma migrate deploy` dan berhasil menerapkan seluruh DDL awal dari nol, kemudian basis data sementara dibersihkan.
  - Pembuktian idempotensi: `prisma migrate deploy` pada `esniffer_dev` terbukti menghasilkan `No pending migrations to apply` tanpa mengulang eksekusi DDL atau mereset data.

### 1.3 Audit & Proteksi Seed Idempoten
- **Tindakan:**
  - [`prisma/seed.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma/seed.ts) diperbarui:
    1. Watermark: `INSERT INTO ... ON CONFLICT ("id") DO NOTHING` tidak pernah mereset `current_sequence`.
    2. User: `prisma.user.upsert` pada klausul `update` tidak mencantumkan `passwordHash`, sehingga password yang telah diubah pengguna tidak ditimpa.
    3. Assignment: Sebelum membuat penugasan default, diperiksa apakah perangkat sudah memiliki assignment aktif apapun (`activeUntil: null`). Penugasan pengguna tidak akan ditimpa atau menyebabkan konflik `btree_gist`.
  - Diverifikasi melalui [`test/db/seed-idempotency.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/db/seed-idempotency.test.ts) (1/1 lulus).

---

## 2. Implementasi Fase 3 (Mosquitto & Worker Ingestion)

### 2.1 Konfigurasi Mosquitto Broker Lokal
- **Container Lokal:** Disediakan direktori konfigurasi pada [`docker/mosquitto/config/`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/docker/mosquitto/config/) dengan listener terikat secara ketat hanya pada `127.0.0.1:1883` (loopback internal, tidak terekspos ke internet).
- **Kredensial Terenkripsi:** Password file di-generate menggunakan `mosquitto_passwd` (format hash PBKDF2 `$7$`):
  - Ingestion worker: `worker`
  - Node sensor: `esp32-001`, `esp32-002`
- **Topic ACL Terisolasi:**
  - Worker memiliki akses read ke `esniffer/v1/devices/+/telemetry` dan `.../status`, serta akses write ke `.../ack`.
  - Perangkat `esp32-001` hanya dapat write ke topiknya sendiri (`telemetry`, `status`) dan read topiknya sendiri (`ack`).
  - Perangkat ditolak secara mutlak jika mencoba mengakses topik perangkat lain.

### 2.2 Worker Ingestion Daemon ([`worker/index.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/worker/index.ts))
- **Koneksi Terpisah:** Berjalan sebagai proses terpisah via library `mqtt@^5.16.0` dengan client ID `esniffer-ingest-v1`, clean session `false` (persistent session), dan QoS 1.
- **Bounded Concurrency Queue:** Antrean pemrosesan pesan dibatasi maksimal 5 tugas konkuren paralel bersamaan (`WORKER_CONCURRENCY=5`), selaras dengan pool koneksi PostgreSQL.
- **Penerbitan Application ACK:**
  - ACK aplikasi diterbitkan ke `esniffer/v1/devices/{deviceId}/ack` (QoS 1) **hanya setelah** transaksi database berhasil committed (`accepted` atau `accepted_unresolved_time`), atau duplikat/konflik terkonfirmasi.
  - Bila operasi database mengalami kegagalan/outage, worker tidak menerbitkan ACK berhasil, membiarkan pesan di-retry oleh perangkat/broker saat koneksi pulih.
- **Graceful Shutdown:** Menangani sinyal `SIGINT` dan `SIGTERM` dengan menguras antrean in-flight, memutuskan koneksi MQTT, dan menutup pool database.

### 2.3 Simulator Perangkat IoT ([`test/e2e/simulator.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/simulator.ts))
- Mengimplementasikan perilaku lengkap MCU ESP32 sesuai Section 6 dokumen rancangan teknis:
  - Otentikasi per perangkat dengan retained LWT offline saat connect.
  - Publikasi status connect/heartbeat (`state: "online"`).
  - Publikasi telemetry QoS 1 dengan penghitungan hash kanonikal RFC 8785 dan monotonic sequence.
  - Listener penangkap Application ACK asynchronous (`waitForAck(messageId)`).

---

## 3. Hasil Pengujian Integrasi End-to-End ([`test/e2e/mqtt-ingestion.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/mqtt-ingestion.test.ts))

Semua 9 skenario end-to-end yang diwajibkan berhasil lulus 100%:

| No | Skenario Pengujian | Hasil | Keterangan |
|---|---|---|---|
| 1 | **Telemetry valid & ACK** | **PASS** | Telemetry valid tersimpan di database, sequence teralokasi, dan menerima ACK `accepted`. |
| 2 | **Retry identik (idempotensi)** | **PASS** | Paket yang persis sama di-retry tidak menduplikasi baris database dan menerima ACK `duplicate`. |
| 3 | **Konflik payload (message_id sama)** | **PASS** | Message ID sama dengan sensor value berbeda ditolak dengan reason `MESSAGE_ID_CONFLICT`. |
| 4 | **Ketahanan DB outage & recovery** | **PASS** | DB error tidak menghasilkan ACK berhasil; saat DB pulih, retry paket berhasil disimpan dan mendapat ACK `accepted`. |
| 5 | **Worker restart resilience** | **PASS** | Worker dihentikan dan di-restart; subscription MQTT dan konsumsi paket segera pulih. |
| 6 | **Isolasi status retained vs live** | **PASS** | Status retained `online` ditandai `RETAINED_SNAPSHOT` dengan `connectionState: UNKNOWN` tanpa memajukan `last_seen_at`. Heartbeat live berhasil memajukan `last_seen_at` dan mengubah state menjadi `ONLINE`. |
| 7 | **Pengujian ACL per-device** | **PASS** | Device `esp32-001` diblokir oleh broker saat mencoba mempublikasikan data ke topik milik `esp32-002`. |
| 8 | **Unresolved-time ingestion** | **PASS** | Data tanpa clock sync tersimpan dengan `chamber_id = null`, menerima ACK `accepted_unresolved_time`, dan dapat diaudit via riwayat device. |
| 9 | **Penanganan kegagalan publish ACK** | **PASS** | Saat ACK gagal terbit sesudah commit, retry paket oleh perangkat terdeteksi sebagai duplicate dan menerima ACK `duplicate` dengan reading ID yang sama. |

---

## 4. Rekapitulasi Uji Mutu Keseluruhan

| Kategori Pengujian | Perintah | Status | Keterangan |
|---|---|---|---|
| **Unit Tests** | `npm run test:unit` | **51 / 51 Lulus** | Canonical, validator, topics, logger, time, pagination |
| **Database Tests** | `npm run test:db` | **19 / 19 Lulus** | Schema integrity, concurrency, watermark lock, seed safety |
| **E2E MQTT Tests** | `npm run test:e2e` | **9 / 9 Lulus** | 9 skenario end-to-end Mosquitto & Worker |
| **Total Test Suite** | `npm test` | **79 / 79 Lulus (100%)** | Zero failures across all suites |
| **Typecheck** | `npm run typecheck` | **0 Error** | TypeScript 5 (target ES2022) |
| **Lint** | `npm run lint` | **0 Error** | ESLint 9 (1 legacy img warning pada SensorCard) |
| **Production Build** | `npm run build` | **Sukses (894 ms)** | Next.js 16.3 Turbopack build |

---

## 5. Rencana Lanjutan Fase 4 (Route Handlers & Auth API)

Infrastruktur penyerapan data MQTT dan basis data kini telah beroperasi penuh dan terverifikasi. Tahap berikutnya adalah **Fase 4: Route Handlers, Autentikasi Pengguna, dan API Query/Export**:
1. Implementasi API authentication (`POST /api/v1/auth/login`, `logout`, `session`) dengan rate limiting dan cookie HttpOnly.
2. Implementasi query API `/api/v1/chambers/[chamberId]/latest` dan `/series` dengan pagination keyset aman watermark.
3. Implementasi audit API `/api/v1/devices/[deviceId]/unresolved` untuk visualisasi data unknown-time.
4. Export CSV/JSON streaming data pengukuran.
