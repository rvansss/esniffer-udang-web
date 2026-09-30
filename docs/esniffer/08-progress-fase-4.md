# Laporan Kemajuan dan Implementasi Fase 4: Autentikasi & HTTP API Route Handlers

Dokumen ini mencatat penyelesaian penuh **Fase 4 (Autentikasi Pengguna, Otorisasi RBAC, CSRF/Origin Guard, API Chambers/Devices/Assignments, Latest Reading 3-Dimensi, History Keyset Pagination dengan Watermark, Series Time-Bucket Aggregation, dan Safe CSV Export)** serta penyelesaian 5 catatan verifikasi Fase 3 per 30 September 2026.

---

## 1. Penyelesaian 5 Catatan Verifikasi Fase 3

| No | Catatan Verifikasi | Tindakan & Implementasi Aktual |
|---|---|---|
| 1 | **Pembedaan outage database nyata vs simulasi** | Pengujian [`test/e2e/mqtt-ingestion.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/mqtt-ingestion.test.ts) memperjelas batasan: exception layer persistence/storage diuji secara in-process untuk membuktikan worker tidak menerbitkan ACK sukses saat transaksi gagal, sedangkan kegagalan network socket/koneksi pool PostgreSQL nyata memicu connection retry dan penahanan paket pada persistent session broker. |
| 2 | **Antrean berbatas selain konkurensi (bounded queue)** | [`worker/index.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/worker/index.ts) kini dilengkapi batas kapasitas `maxQueueSize` (default 500 paket, configurable via `WORKER_MAX_QUEUE`). Bila antrean mencapai kapasitas, pesan baru didrop tanpa ACK dengan log warning `QUEUE_CAPACITY_EXCEEDED` untuk mencegah konsumsi memori berlebih (OOM) saat terjadi backpressure. Diverifikasi pada uji end-to-end ke-10. |
| 3 | **Kredensial dan data broker tidak dilacak Git** | Aturan [`docker/mosquitto/config/passwords.txt`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/docker/mosquitto/config/passwords.txt) dan `docker/mosquitto/data/` telah ditambahkan ke [`.gitignore`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/.gitignore). Disediakan template aman [`passwords.txt.example`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/docker/mosquitto/config/passwords.txt.example). |
| 4 | **Batasan verifikasi TLS vs ACL lokal** | Dokumen menegaskan bahwa pengujian lokal memverifikasi autentikasi username/password (PBKDF2-SHA512) dan isolasi topic ACL per perangkat pada broker Mosquitto di loopback `127.0.0.1:1883`. Port TLS 8883 (MQTTS) dirancang untuk reverse proxy produksi dengan sertifikat domain publik dan belum diuji secara publik pada tahap lokal ini. |
| 5 | **Ketahanan worker restart dengan antrean persistence** | Terverifikasi bahwa persistent session (clean: false, QoS 1) memungkinkan worker yang di-restart segera menyambung kembali dan memproses antrean paket tanpa kehilangan pesan. |

---

## 2. Arsitektur & Komponen Fase 4

### 2.1 Autentikasi Pengguna & Sesi Opaque
- **Password Hashing ([`lib/auth/password.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/password.ts)):**
  - Menggunakan algoritma Node.js native `crypto.scrypt` ($N=16384, r=8, p=1$, keylen=64) dengan salt acak 16 byte.
  - Verifikasi menggunakan `crypto.timingSafeEqual` untuk mencegah serangan timing side-channel.
- **Sesi Opaque ([`lib/auth/session.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/session.ts)):**
  - Token sesi berupa 32 byte acak (64 karakter hex) yang hanya dikirim ke browser melalui cookie `esniffer_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400`, `Secure` saat production).
  - Di database (`auth_sessions`), token hanya disimpan dalam bentuk `token_hash = sha256(rawToken)`.
  - Validasi sesi memeriksa masa aktif (`expiresAt > now()`), status pencabutan (`revokedAt IS NULL`), dan keaktifan akun (`user.isActive = true`).
  - Logout melakukan pencabutan sesi secara langsung di database (`revokedAt = now()`) dan menghapus cookie.
- **Seed Pengguna ([`prisma/seed.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/prisma/seed.ts)):**
  - Akun development diselaraskan dengan password scrypt: `admin@esniffer.local` (`admin123`, `ADMIN`) dan `operator@esniffer.local` (`viewer123`, `VIEWER`).

### 2.2 Otorisasi RBAC & CSRF/Origin Guard ([`lib/auth/guard.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/guard.ts))
- **Role-Based Access Control:**
  - `VIEWER`: Akses read-only (`GET` chambers, devices, assignments, latest, history, series, export).
  - `ADMIN`: Akses penuh termasuk mutasi state (`POST`, `PATCH`, penugasan, pembatalan assignment).
  - Akses tanpa izin yang memadai menghasilkan 403 `FORBIDDEN`.
- **CSRF & Origin Protection:**
  - Metode mutasi (`POST`, `PATCH`, `PUT`, `DELETE`) wajib menyertakan header `Origin` atau `Referer` yang cocok dengan Host server, atau menyertakan custom header `X-CSRF-Token` / `X-Requested-With`.
  - Permintaan mutasi lintas-domain atau tanpa header proteksi langsung ditolak dengan 403 `FORBIDDEN`.

### 2.3 Standarisasi Response & Error Envelope ([`lib/api/response.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/api/response.ts))
- Format seragam sesuai Section 7.1 dokumen teknis:
  - Sukses: `{ "data": ..., "meta": ... }`
  - Error: `{ "error": { "code": string, "message": string, "details": [], "requestId": string } }`
- Propagasi korelasi `requestId` dari header `x-request-id` atau UUID baru ke seluruh lapisan log terstruktur.

---

## 3. Implementasi HTTP API Route Handlers (Next.js 16)

Seluruh Route Handler dibangun menggunakan standar Web Request/Response dengan asynchronous context params (`params: Promise<{ ... }>`) sesuai konvensi Next.js 16:

### 3.1 Endpoint Autentikasi
- `POST /api/v1/auth/login`: Verifikasi email & password, proteksi account lockout sementara bila gagal >= 5 kali, penerbitan cookie HttpOnly.
- `POST /api/v1/auth/logout`: Pencabutan sesi di database dan pembersihan cookie.
- `GET /api/v1/auth/session`: Mengembalikan data user (`id`, `email`, `role`) dan `expiresAt` tanpa membocorkan hash/token.

### 3.2 Endpoint Chamber & Device
- `GET /api/v1/chambers`: Daftar chamber dengan active device count dan keyset pagination `(code ASC, id ASC)`.
- `POST /api/v1/chambers`: Pembuatan chamber baru (ADMIN + CSRF). Kode unik divalidasi; duplikasi menghasilkan 409 `CONFLICT`.
- `GET /api/v1/chambers/[chamberId]`: Detail chamber beserta daftar perangkat yang sedang terpasang aktif.
- `PATCH /api/v1/chambers/[chamberId]`: Pembaruan nama/deskripsi/status aktif (kode bersifat immutable).
- `GET /api/v1/devices`: Daftar perangkat dengan status koneksi, evidence, penugasan aktif, dan jumlah unresolved readings.
- `POST /api/v1/devices`: Pendaftaran perangkat baru (ADMIN + CSRF). Format `mqttDeviceId` divalidasi ketat.
- `GET /api/v1/devices/[deviceId]`: Detail status koneksi dan penugasan perangkat.
- `PATCH /api/v1/devices/[deviceId]`: Pembaruan nama dan status aktif perangkat.
- `GET /api/v1/devices/[deviceId]/readings`: Audit pembacaan khusus untuk data tak berwaktu (`quality=UNKNOWN`) dengan keyset order `(receivedAt DESC, id DESC)`.

### 3.3 Endpoint Penugasan (Assignment)
- `GET /api/v1/assignments`: Daftar riwayat penugasan perangkat ke chamber.
- `POST /api/v1/assignments`: Mutasi transaksional penugasan: menutup assignment aktif lama pada tanggal efektif, dan menerbitkan penugasan baru. Pelanggaran overlap ditangkap melalui constraint `btree_gist` PostgreSQL dan dikembalikan sebagai 409 `CONFLICT`.
- `POST /api/v1/assignments/[id]/end`: Mengakhiri penugasan aktif secara aman (`activeUntil = now()`).

### 3.4 Ingestion Query & Analytics
- `GET /api/v1/chambers/[chamberId]/latest`:
  - **Pemisahan 3 Dimensi Status:**
    1. *Connection State:* `ONLINE` / `OFFLINE` / `UNKNOWN` dengan `evidence`, `lastSeenAt`, `bootId`, dan `sessionId`.
    2. *Freshness State:* `fresh` / `stale` / `unknown` dengan `ageSeconds` dan `thresholdSeconds` (15s). **Dihitung HANYA dari `measuredAt` data known-time; `receivedAt` tidak dipakai untuk memalsukan kesegaran.**
    3. *Reading Values & Qualities:* Nilai kelima sensor (`temperatureC`, `humidityPercent`, `mq137Raw`, `mq136Raw`, `mq4Raw`) beserta unit dan kualitas.
  - Jika belum ada data eligible atau hanya ada data unknown-time, `reading` bernilai `null` (tetap HTTP 200). Data unknown-time tidak pernah dipilih sebagai latest chamber.
- `GET /api/v1/chambers/[chamberId]/history`:
  - Keyset pagination terpadu total order `(measuredAt DESC, receivedAt DESC, historySequence DESC)`.
  - Mengunci `snapshotWatermark = max(history_sequence)` pada halaman pertama.
  - Token cursor ditandatangani HMAC (`shared/pagination.ts`) untuk mencegah tamper atau perpindahan filter di tengah traversal.
  - Data late-commit yang memiliki sequence di atas watermark diisolasi dari traversal halaman aktif.
- `GET /api/v1/chambers/[chamberId]/series`:
  - Agregasi time-bucket menggunakan fungsi native PostgreSQL `date_bin` dengan interval `5s`, `30s`, `1m`, `5m`, `15m`, `1h`, `6h`, `24h`, atau `auto`.
  - Whitelist metrics: suhu, kelembaban, mq137, mq136, mq4.
  - Menghitung `avg`, `min`, `max`, `validCount`, dan `invalidCount`.
  - **Kritikal:** Nilai sensor `null` diabaikan dari kalkulasi numerik dan tidak membiaskan rata-rata menjadi nol. Rentang melebihi 1.000 bucket ditolak dengan 422.
- `GET /api/v1/chambers/[chamberId]/export`:
  - Streaming CSV `text/csv; charset=utf-8` dengan chunking 1.000 baris.
  - Sanitasi formula injection: setiap cell yang diawali karakter `=`, `+`, `-`, `@`, `\t`, `\r` diberi prefix `'`.
  - Escape standar RFC 4180 untuk teks berkoma dan berkutipan.
  - Pembatasan ukuran maksimum 50.000 baris per ekspor (413 `PAYLOAD_TOO_LARGE` jika melebihi batas).
  - Penanganan pembatalan klien via `request.signal.aborted`.

---

## 4. Hasil Pengujian Integrasi HTTP API & Smoke Test

Seluruh 36 skenario pengujian integrasi HTTP API dan E2E HTTP Server lulus 100%:

| Test Suite | Jumlah Uji | Status | Cakupan Pengujian |
|---|:---:|:---:|---|
| [`test/api/auth.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/auth.test.ts) | 13 | **PASS** | Login sukses/gagal, HttpOnly cookie, lockout, session inspection, penolakan non-aktif, CSRF rejection, RBAC VIEWER vs ADMIN, foreign origin + custom header rejected (403), localhost rejected in production, CSRF token cryptographic validation, no-store headers, logout revocation. |
| [`test/api/chambers-devices.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/chambers-devices.test.ts) | 9 | **PASS** | CRUD chamber, penolakan kode unik duplikat (409), pagination cursor chamber, CRUD device, update device, mutasi transaksional penugasan, reassignment penutupan otomatis, safe assignment end. |
| [`test/api/readings-latest-history.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/readings-latest-history.test.ts) | 5 | **PASS** | Latest reading 3-dimensi (koneksi, freshness, kualitas sensor), isolasi unknown-time dari latest, pagination keyset multi-halaman mematuhi batas watermark (late-commit isolation), audit unknown-time via riwayat perangkat. |
| [`test/api/series-export.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/series-export.test.ts) | 8 | **PASS** | Agregasi series time-bucket mengabaikan nilai NULL (tidak bias ke 0), penolakan bucket > 1000, sanitasi formula injection CSV, angka negatif tetap numerik, keyset pagination export RFC 4180, isolasi backlog via frozen watermark, penanganan stream abort/cancel bersih. |
| [`test/e2e/http-smoke.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/http-smoke.test.ts) | 1 | **PASS** | **Smoke test HTTP server Next.js nyata:** Menjalankan instance Next.js produksi mandiri, siklus login -> Set-Cookie -> inspeksi sesi -> query chambers -> logout -> penolakan 401 pada cookie lama. |
| **Total API & E2E HTTP** | **36** | **PASS** | **100% Lulus (0 Gagal)** |

---

## 5. Penyelesaian Temuan Review Fase 4

Perbaikan terarah diterapkan tanpa memperluas cakupan atau mengubah UI dashboard:

1. **CSRF & Origin Hardening:**
   - Evaluasi header `Origin` / `Referer` dilakukan tanpa jalan pintas (bypass): origin yang tidak terdaftar ditolak 403 meskipun menyertakan custom header (`X-CSRF-Token` atau `X-Requested-With`).
   - Normalisasi perbandingan origin lengkap berbasis `APP_BASE_URL` dan `APP_ORIGIN_ALLOWLIST`.
   - Domain `localhost` dilarang universal pada mode produksi (`NODE_ENV === 'production'`) dan wajib tercantum eksplisit di allowlist jika digunakan.
   - Validasi kriptografis token CSRF (`verifyCsrfToken` dengan HMAC SHA-256 constant-time), menolak manipulasi token dan tidak sekadar memeriksa keberadaan header.
   - Kebijakan login & logout: login memvalidasi origin dan menerbitkan `csrfToken`; logout memvalidasi origin/CSRF, mencabut sesi, dan menghapus cookie via `Max-Age=0`.

2. **Perbaikan CSV Export:**
   - Offset `skip` digantikan penuh dengan keyset `(measuredAt ASC, receivedAt ASC, historySequence ASC)` dan batas snapshot watermark beku (`snapshotWatermark = max(history_sequence)`).
   - Perhitungan jumlah baris (`count`) dan traversal traversal menggunakan filter snapshot eligibility yang identik.
   - Pemanfaatan `pull(controller)` pada `ReadableStream` standar Web Streams untuk menjamin backpressure terkendali dari konsumen lambat.
   - Penanganan pembatalan/abort signal dengan logging failure satu kali via `logger.warn`/`logger.error` tanpa duplikasi.
   - Sanitasi formula injection tetap melindungi teks yang berawalan trigger (`=, +, -, @, \t, \r`), namun mempertahankan angka murni (seperti suhu negatif `-25.5` atau `-12.5`) tetap numerik tanpa kutip pembungkus teks.

3. **Konfigurasi & Autentikasi:**
   - `getCursorSigningSecret()` dan `getAuthSecret()` gagal dengan jelas (`fail-fast`) di mode produksi jika secret wajib tidak disetel.
   - Fallback verifikasi SHA-256 legacy dihapus sepenuhnya; verifikasi password wajib menggunakan format `scrypt$`.
   - Pembaruan `lastUsedAt` sesi dibatasi throttling (maksimal sekali per 5 menit), dan kegagalan query database dicatat ke log warning terstruktur (menghilangkan silent empty catch).
   - Seluruh respons API sensitif dan data (`jsonResponse` & `errorResponse`) dilengkapi header proteksi `Cache-Control: no-store, private`.

---

## 6. Rekapitulasi Uji Mutu Keseluruhan

| Kategori Pengujian | Perintah | Status | Keterangan |
|---|---|---|---|
| **Unit Tests (Fase 1)** | `npm run test:unit` | **51 / 51 Lulus** | Canonical payload RFC 8785, topics, logger, evaluator waktu, pagination math |
| **Database Tests (Fase 2)** | `npm run test:db` | **19 / 19 Lulus** | PostgreSQL schema integrity, exclusion constraint, concurrency watermark lock, seed safety |
| **E2E MQTT Tests (Fase 3)** | `npm run test:e2e` | **11 / 11 Lulus** | Mosquitto broker, worker ingestion, ACL isolasi, post-commit ACK, bounded queue backpressure, real HTTP server smoke test |
| **HTTP API Tests (Fase 4)** | `npm run test:api` | **35 / 35 Lulus** | Auth, RBAC, CSRF, Chamber/Device CRUD, Latest, Keyset History, Series, Export |
| **Total Test Suite** | `npm test` | **116 / 116 Lulus (100%)** | Zero failures di seluruh 10 suites pengujian |
| **Typecheck** | `npm run typecheck` | **0 Error** | TypeScript 5 (Target ES2022) |
| **Production Build** | `npm run build` | **Sukses (680 ms)** | Next.js 16.3 Turbopack build |

---

## 7. Ringkasan File Baru & Termodifikasi

- [`lib/auth/password.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/password.ts): Penghapusan fallback SHA-256 legacy; wajib format `scrypt$`.
- [`lib/auth/session.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/session.ts): Penambahan `getAuthSecret()` fail-fast, pembuatan/verifikasi token CSRF HMAC, throttling touch `lastUsedAt`.
- [`lib/auth/guard.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/guard.ts): Pengawalan origin ketat, larangan localhost produksi, validasi kriptografis CSRF token.
- [`lib/api/response.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/api/response.ts): Default header `Cache-Control: no-store, private`.
- [`lib/api/csv.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/api/csv.ts): Sanitasi formula formula yang mempertahankan format angka negatif.
- [`shared/pagination.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/shared/pagination.ts): Penambahan `getCursorSigningSecret()` fail-fast produksi.
- [`app/api/v1/chambers/[chamberId]/history/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/chambers/[chamberId]/history/route.ts): Pemanfaatan `getCursorSigningSecret()`.
- [`app/api/v1/chambers/[chamberId]/export/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/chambers/[chamberId]/export/route.ts): Keyset streaming dengan frozen snapshot watermark, pull backpressure, dan penanganan cancel.
- [`app/api/v1/auth/login/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/auth/login/route.ts): Validasi origin dan penyertaan `csrfToken` pada payload respons.
- [`app/api/v1/auth/session/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/auth/session/route.ts): Penyertaan `csrfToken` pada payload respons.
- [`test/api/auth.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/auth.test.ts): Pengujian penolakan origin asing, localhost produksi, dan validasi CSRF.
- [`test/api/series-export.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/series-export.test.ts): Pengujian ekspor angka negatif, isolasi watermark backlog, dan abort mid-stream.
- [`test/e2e/http-smoke.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/http-smoke.test.ts): Pengujian smoke HTTP server Next.js nyata secara end-to-end.
