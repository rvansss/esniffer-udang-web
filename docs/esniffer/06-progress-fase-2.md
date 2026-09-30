# Laporan Kemajuan dan Implementasi Fase 2: PostgreSQL & Prisma

Dokumen ini mencatat penyelesaian penuh **Fase 2 (PostgreSQL, Prisma ORM, Skema & Migrasi Database, Constraint Integritas, Seed Development, dan Pengujian Integrasi Multi-Koneksi)** per 30 September 2026. Dokumen ini menjadi acuan teknis bagi agent dan pengembang pada fase berikutnya.

---

## 1. Ringkasan Eksekutif Fase 2

Fase 2 telah berhasil mengintegrasikan PostgreSQL lokal khusus pengembangan (`esniffer_dev`) menggunakan Prisma 7.9.1 dan driver adapter `@prisma/adapter-pg` dengan *bounded connection pool* per proses.

Seluruh target keberhasilan dan fokus integritas Fase 2 terpenuhi:
1. **Unique `(device_id, message_id)`**: Ditegakkan di level PostgreSQL untuk menjamin *at-most-once storage*.
2. **Deduplikasi vs Konflik**: Payload identik menghasilkan status `duplicate` (idempotent no-op); payload berbeda pada message_id yang sama menghasilkan `MESSAGE_ID_CONFLICT`.
3. **Retry Committed Reading**: Tetap mengembalikan data historis valid sekalipun perangkat telah dipindah ke chamber lain atau dinonaktifkan (`isActive: false`).
4. **Assignment Non-Overlapping & Konsistensi**: Menggunakan ekstensi `btree_gist` dan constraint eksklusi SQL untuk mencegah tumpang tindih waktu penugasan perangkat, serta trigger `trg_sensor_reading_assignment_consistency` untuk memastikan pembacaan sensor selalu konsisten dengan pasangan device-chamber pada penugasan.
5. **Check Constraints Known-Time vs Unknown-Time**:
   - `SYNCED` / `RECONSTRUCTED`: Mewajibkan `measured_at`, `chamber_id`, `assignment_id`, dan `history_sequence` terisi.
   - `UNKNOWN`: Mewajibkan `measured_at`, `chamber_id`, `assignment_id`, dan `history_sequence` bernilai `NULL`, dengan `sample_uptime_ms` terisi.
   - Sensor Quality: Nilai sensor terisi jika dan hanya jika quality berstatus `OK`.
6. **Preservasi Hash Kanonikal**: Rekonstruksi waktu terbukti memperbarui metadata waktu tanpa pernah mengubah `payload_sha256` atau `raw_payload`.
7. **Visibilitas Reading Unresolved**: Data unknown-time tersembunyi dari pagination publik chamber (`history_sequence IS NOT NULL`), namun dapat diaudit melalui riwayat perangkat (`WHERE device_id = ? AND measurement_time_quality = 'UNKNOWN'`).
8. **Pengujian Konkurensi & Pagination Multi-Koneksi (Review Note 1)**: Menguji secara empiris fenomena keterlambatan commit (*late commit*) menggunakan 3 koneksi PostgreSQL independen, serta membuktikan efektivitas serialisasi alokasi sequence berbasis row-level lock pada tabel watermark.

---

## 2. Struktur Skema & Constraint DDL PostgreSQL

### 2.1 Prisma 7 Configuration & Schema
- Konfigurasi Prisma didefinisikan pada [`prisma.config.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma.config.ts) menggunakan `defineConfig` dari `prisma/config`.
- Skema [`prisma/schema.prisma`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma/schema.prisma) mendefinisikan 8 model:
  1. `Chamber` (`chambers`): Ruang/kolam pemantauan.
  2. `Device` (`devices`): Perangkat IoT / node sensor.
  3. `DeviceAssignment` (`device_assignments`): Riwayat penugasan perangkat ke chamber.
  4. `DeviceTimeReference` (`device_time_references`): Titik jangkar sinkronisasi waktu per boot session.
  5. `SensorReading` (`sensor_readings`): Data telemetri sensor terukur.
  6. `User` (`users`): Akun pengguna (ADMIN / VIEWER).
  7. `AuthSession` (`auth_sessions`): Sesi autentikasi token.
  8. `HistorySequenceWatermark` (`history_sequence_watermark`): Singleton baris untuk alokasi sequence monotonik dan tracking watermark.

### 2.2 Migrasi Awal & SQL Constraints ([`migration.sql`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma/migrations/20260930_init/migration.sql))
- **Ekstensi `btree_gist`**: Diaktifkan untuk mendukung exclusion constraint pada tipe data temporal (`TIMESTAMPTZ`):
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;

  ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_no_overlap"
  EXCLUDE USING gist (
      device_id WITH =,
      tstzrange(active_from, COALESCE(active_until, 'infinity'::timestamptz), '[)') WITH &&
  );
  ```
- **Constraint Validitas Waktu & Visibilitas Publik (`chk_reading_time_quality`)**:
  ```sql
  ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_reading_time_quality" CHECK (
      (
          "measurement_time_quality" IN ('SYNCED', 'RECONSTRUCTED')
          AND "measured_at" IS NOT NULL
          AND "chamber_id" IS NOT NULL
          AND "assignment_id" IS NOT NULL
          AND "history_sequence" IS NOT NULL
      ) OR (
          "measurement_time_quality" = 'UNKNOWN'
          AND "measured_at" IS NULL
          AND "chamber_id" IS NULL
          AND "assignment_id" IS NULL
          AND "history_sequence" IS NULL
      )
  );
  ```
- **Constraint Kualitas Sensor**: Menjamin integritas data numerik (`temperature`, `humidity`, `mq137`, `mq136`, `mq4`):
  ```sql
  ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_temperature_quality" CHECK (
      ("temperature_quality" = 'OK' AND "temperature_c" IS NOT NULL)
      OR ("temperature_quality" != 'OK' AND "temperature_c" IS NULL)
  );
  ```
- **Trigger Konsistensi Assignment (`check_sensor_reading_assignment`)**:
  Memastikan jika suatu reading memiliki `assignment_id`, maka `device_id` dan `chamber_id` pada reading harus identik dengan pemilik assignment tersebut.

---

## 3. Database Client & Pool Architecture

Implementasi di [`lib/db/client.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/db/client.ts) dan [`worker/db.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/worker/db.ts):
- Menggunakan driver adapter `@prisma/adapter-pg` yang membungkus instance `pg.Pool`.
- **Bounded Pool:** Koneksi dibatasi (`max: 5`) dengan parameter idle timeout 30 detik dan connection timeout 5 detik.
- **Next.js Hot-Reload Guard:** Menggunakan caching singleton pada `globalThis` di lingkungan non-produksi untuk mencegah kehabisan koneksi saat kompilasi ulang Turbopack/Next.js.
- **Alokasi Sequence Monotonik:**
  Fungsi `allocateHistorySequence(client)` mengeksekusi:
  ```sql
  UPDATE history_sequence_watermark
  SET current_sequence = current_sequence + 1
  WHERE id = 1
  RETURNING current_sequence;
  ```
  PostgreSQL row-level lock pada baris tunggal (`id = 1`) memastikan setiap transaksi memperoleh sequence strictly monotonik tanpa race condition antar-proses worker.

---

## 4. Seed Development Database

File [`prisma/seed.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma/seed.ts) menyediakan data awal pengembangan yang idempoten:
- Inisialisasi baris watermark `(id: 1, current_sequence: 0)`.
- 2 Chamber: `CH-01` (Chamber 1 / Kolam A) dan `CH-02` (Chamber 2 / Kolam B).
- 2 Device: `esp32-001` (Node 01) dan `esp32-002` (Node 02).
- 1 Active Assignment: `esp32-001` terhubung ke `CH-01` mulai `2026-09-01T00:00:00Z` hingga aktif (null).
- 2 Akun Pengguna Uji: `admin@esniffer.local` (role `ADMIN`) dan `operator@esniffer.local` (role `VIEWER`).

Dijalankan melalui:
```bash
npm run db:seed
```

---

## 5. Hasil Pengujian Integrasi Database

### 5.1 Integritas Skema & Constraint ([`test/db/schema-integrity.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/db/schema-integrity.test.ts))
| No | Kasus Uji | Hasil |
|---|---|---|
| 1 | Unique `(device_id, message_id)` menolak duplikasi pada device sama, mengizinkan pada device berbeda | **PASS** |
| 2 | Deduplikasi: hash identik -> `duplicate`; hash berbeda -> `MESSAGE_ID_CONFLICT` | **PASS** |
| 3 | Retry committed reading tetap berhasil dan mempertahankan assignment historis saat device dipindah/nonaktif | **PASS** |
| 4 | Assignment non-overlapping (`btree_gist`) menolak interval tumpang tindih maupun open-ended overlap | **PASS** |
| 5 | Trigger konsistensi menolak reading dengan ketidakcocokan chamber/device terhadap assignment | **PASS** |
| 6 | SQL check constraint `chk_reading_time_quality` menegakkan aturan known-time vs unknown-time | **PASS** |
| 7 | SQL check constraint `chk_temperature_quality` menegakkan relasi status OK vs MISSING | **PASS** |
| 8 | Rekonstruksi waktu mempertahankan `payload_sha256` dan `raw_payload` asli tanpa mutasi | **PASS** |
| 9 | Reading unresolved tersembunyi dari pagination publik namun dapat ditemukan via audit riwayat device | **PASS** |

### 5.2 Konkurensi & Pagination Multi-Koneksi ([`test/db/concurrency-pagination.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/db/concurrency-pagination.test.ts))
| No | Kasus Uji | Hasil |
|---|---|---|
| 1 | Alokasi sequence 10 transaksi serentak menghasilkan urutan unik dan strictly monoton ($+1$) | **PASS** |
| 2 | **Review Note 1 Empiris:** 3 koneksi PostgreSQL independen membuktikan transaksi terlambat commit tidak terbaca di bawah Read Committed sampai commit terjadi | **PASS** |
| 3 | Row-level lock pada watermark menahan transaksi konkuren sehingga sequence tidak mendahului commit | **PASS** |
| 4 | Celah sequence akibat alokasi terbuang / rollback tidak merusak pembacaan cursor pagination | **PASS** |
| 5 | Promosi reading UNKNOWN menjadi RECONSTRUCTED mengalokasikan sequence baru dan muncul di pagination stream | **PASS** |

---

## 6. Rekapitulasi Uji Mutu Keseluruhan

Pengujian dijalankan pada lingkungan lokal yang bersih dengan isolasi database pengujian:

| Uji Mutu | Perintah | Status | Keterangan |
|---|---|---|---|
| **Test Suite Total** | `npm test` | **65 / 65 Lulus (100%)** | 51 unit tests + 14 PostgreSQL integration tests |
| **Typecheck** | `npm run typecheck` | **0 Error** | TypeScript 5 (target ES2022) |
| **Lint** | `npm run lint` | **0 Error** | ESLint 9 (1 warning gambar legacy `SensorCard.tsx`) |
| **Production Build** | `npm run build` | **Sukses (609 ms)** | Next.js 16.3 Turbopack clean build |
| **Database Migration** | `psql` / migration DDL | **Sukses** | 8 tabel, 1 ekstensi btree_gist, 8 check constraints, 1 trigger |

---

## 7. Rencana Lanjutan Fase 3 (Mosquitto & Worker MQTT)

Dengan rampungnya infrastruktur basis data dan pengujian konkurensi di Fase 2, repository siap untuk melangkah ke **Fase 3: Mosquitto dan Worker MQTT**:
1. Konfigurasi Mosquitto broker terisolasi dengan autentikasi per node/device.
2. Implementasi MQTT client loop pada `worker/index.ts` dengan QoS 1 dan persistent subscription.
3. Integrasi pipeline worker dengan database menggunakan `worker/db.ts` untuk pemrosesan live telemetry dan status message.
4. Pengujian end-to-end retensi pesan, handling LWT, dan crash recovery.
