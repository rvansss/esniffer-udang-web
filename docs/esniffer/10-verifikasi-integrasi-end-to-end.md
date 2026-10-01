# Verifikasi Integrasi End-to-End

Tanggal verifikasi: 1 Oktober 2026 (Asia/Jakarta)

## Lingkup dan environment

Alur yang diuji secara nyata:

`DeviceSimulator → Mosquitto → WorkerDaemon → PostgreSQL/Prisma → API Next.js → dashboard Chrome`

Environment yang benar-benar dipakai:

| Komponen | Konfigurasi aktual |
|---|---|
| Node.js / npm | `v22.23.2` / `10.9.8` |
| PostgreSQL | PostgreSQL 15.18 di `127.0.0.1:5432`; `pg_isready` melaporkan `accepting connections` |
| MQTT | container `esniffer-mosquitto`, image `eclipse-mosquitto:2`, port `127.0.0.1:1883`, sudah aktif saat verifikasi dimulai |
| Web | Next.js 16.3.0 production server pada port 3101, dijalankan dan dihentikan oleh test harness |
| Worker | `WorkerDaemon` nyata dengan koneksi MQTT/Prisma nyata, dijalankan dan dihentikan oleh test harness |
| Device | simulator yang sudah ada di `test/e2e/simulator.ts` |
| Browser | Google Chrome melalui Puppeteer |

Perintah yang dijalankan:

```text
node --experimental-strip-types --test --test-concurrency=1 test/e2e/full-stack-trace.test.ts
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
```

Test memakai data unik per run dan menghapus reading, time reference, user, serta session yang dibuatnya. Status device awal dipulihkan pada cleanup.

## Hasil skenario

| Skenario | Hasil | Bukti yang diperiksa |
|---|:---:|---|
| Telemetry valid → commit → ACK | **PASS** | ACK `accepted` berisi ID row yang langsung dapat dibaca dari PostgreSQL; ACK hanya diterbitkan setelah operasi persistence selesai |
| Resolusi device/chamber/assignment | **PASS** | Row tersimpan mengacu ke device, chamber, dan assignment aktif yang benar |
| `/latest`, history, dan series | **PASS** | ID reading/message sama pada latest dan history; series pada rentang sempit berisi tepat satu reading dan agregat yang sesuai |
| Dashboard | **PASS** | Respons `/latest` yang diterima browser memiliki ID/timestamp yang sama; UI menampilkan suhu `31.2`, MQ-137 `3210.00`, dan MQ-136 `-- / SENSOR_ERROR` |
| Retry payload identik | **PASS** | ACK `duplicate`; jumlah row untuk `(device_id, message_id)` tetap satu |
| Message ID sama, payload berbeda | **PASS** | ACK `rejected` dengan `MESSAGE_ID_CONFLICT`; tidak ada insert kedua |
| Acquisition error | **PASS** | MQ-136 tersimpan sebagai `NULL` + `SENSOR_ERROR`, tidak diubah menjadi nol, dan UI menampilkan placeholder/kualitas yang sama |
| Timestamp `UNKNOWN` | **PASS** | Reading tetap dapat diaudit melalui endpoint device, `chamber_id` null, dan tidak muncul di latest/history/dashboard |
| Timestamp `RECONSTRUCTED` | **PASS** | Backlog dengan anchor boot yang sama tersimpan sebagai `RECONSTRUCTED` dan menunjuk UUID row `device_time_references` yang valid |
| Status live | **PASS** | Heartbeat live menghasilkan `ONLINE`, evidence `LIVE_STATUS`, dan memajukan `last_seen_at` |
| Replay retained | **PASS** | Setelah worker restart, retained status menghasilkan evidence `RETAINED_SNAPSHOT` dan tidak memajukan `last_seen_at`; heartbeat live berikutnya memulihkan status |
| Outage dashboard | **PASS** | Request latest diabort → `Degraded (Cached)`; freshness terus bertambah; poller kembali `Poller OK` setelah request dipulihkan |
| Timestamp round-trip/range timezone | **PASS** | Kolom terverifikasi `timestamp with time zone`; instant `+07:00` kembali sebagai UTC ekuivalen dan filter ber-offset menemukan row tanpa pergeseran |

## Trace MQTT → DB → API → UI

Trace berikut berasal dari eksekusi `npm test` yang lulus. Data test dibersihkan setelah pengujian.

| Lapisan | Bukti |
|---|---|
| MQTT | topic `esniffer/v1/devices/esp32-001/telemetry`; message ID `8b4ba761-de4f-425a-b72e-4ed0e0cccd5c:0000000001`; `measured_at=2026-09-30T18:43:41.828Z` |
| ACK | status `accepted`; reading ID `260f959c-e624-486a-b1d6-5528c1baf21e`; SHA-256 `ab1d3fc321f49be19125dfcd2aa258ed3d7316b90200d72f856ccaf251e12396`; received `2026-09-30T18:43:41.831Z` |
| PostgreSQL | reading ID dan message ID sama; `measured_at=2026-09-30T18:43:41.828Z`; device `d1e87397-2f13-4d09-b647-7a44b65e590c`; chamber `bbe27a43-ce5d-44d5-b866-b3d37165e354`; assignment `b33a76f3-2450-4746-9e36-a0bffb185358` |
| API | `/latest` dan history mengembalikan reading ID yang sama; series memasukkan reading pada bucket `2026-09-30T18:43:40.000Z` |
| Browser/UI | browser menangkap reading ID dan timestamp yang sama dari `/latest`; dashboard merender nilai/kualitas trace tersebut |

Status trace yang sama: live `last_seen_at=2026-09-30T18:43:41.655Z`; replay retained mempertahankan timestamp itu; heartbeat pemulihan memajukannya ke `2026-09-30T18:43:41.774Z`.

## Masalah yang ditemukan dan perbaikan

Pengujian `RECONSTRUCTED` awalnya gagal karena nilai domain `reference_id` dikirim langsung ke foreign key UUID `sensor_readings.time_reference_id`. Worker sekarang melakukan upsert anchor ke `device_time_references`, mengambil UUID row aktual, lalu memakai UUID tersebut saat insert reading. Unit test baru memastikan backlog menggunakan ID row reference, dan alur nyata lulus melalui MQTT/worker/PostgreSQL.

Fixture awal memakai MQ-137 `4321`, di luar batas ADC 12-bit `0..4095`, sehingga normalisasi yang benar menghasilkan `NULL + OUT_OF_RANGE`. Fixture happy path dikoreksi ke nilai valid `3210`; assertion kualitas tidak dilemahkan.

Tidak ada perubahan tipe timestamp yang diperlukan: Prisma/PostgreSQL sudah menggunakan `TIMESTAMPTZ(3)`.

## Regression gate

| Gate | Hasil |
|---|:---:|
| `npm test` | **PASS — 136/136**, 12 suite, 0 fail, 0 skipped |
| `npm run typecheck` | **PASS — 0 error** |
| `npm run lint` | **PASS — 0 error, 0 warning** |
| `npm run build -- --webpack` | **PASS — production build selesai** |
| `npm run build` (Turbopack default) | **SKIPPED pada tahap ini** — environment sandbox sebelumnya melarang proses internal membuka port; bukan kegagalan aplikasi |

## Keterbatasan

- Seluruh alur fungsional yang diminta di atas benar-benar dijalankan; tidak ada skenario alur utama yang di-skip.
- TLS/mTLS MQTT tidak diverifikasi karena environment lokal memakai broker plaintext/ACL dan sertifikat bukan bagian tahap ini.
- Verifikasi memakai simulator yang tersedia, bukan perangkat ESP32 fisik.
- Shutdown test kadang mencatat `write after end` dari client MQTT saat koneksi sengaja ditutup; tidak menyebabkan kegagalan, kehilangan data, atau ACK sebelum commit, tetapi layak dipantau bila log shutdown harus sepenuhnya bersih.

