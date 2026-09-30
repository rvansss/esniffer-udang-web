# Laporan Kemajuan dan Implementasi Fase 5: Integrasi Login & Dashboard dengan PostgreSQL HTTP API

Dokumen ini mencatat penyelesaian penuh **Fase 5 (Integrasi Halaman Login, Dashboard Real-time, Poller Tunggal per Chamber, 4 Dimensi Status Independen, Panel Grafik Deret Waktu dengan Keyset Range Sync, Ekspor CSV Berbatas Aman, serta Pengujian Browser Nyata End-to-End)** per 1 Oktober 2026.

---

## 1. Penyelesaian Temuan Pra-Fase 5 (Quality Gate)

Sebelum memulai integrasi antarmuka, seluruh temuan review Fase 4 telah diperbaiki dan diverifikasi:

| No | Area Temuan | Tindakan & Implementasi Aktual |
|---|---|---|
| 1 | **CSRF & Origin Verification** | Diperbaiki pada [`lib/auth/guard.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/auth/guard.ts): header kustom (`X-CSRF-Token`) **bukan** lagi bypass verifikasi origin. Server memverifikasi origin lengkap terhadap `APP_BASE_URL` dan allowlist terkonfigurasi. Localhost hanya diizinkan pada `NODE_ENV !== 'production'`. Token CSRF diverifikasi menggunakan HMAC-SHA256 yang terikat pada ID sesi pengguna. |
| 2 | **Keyset Pagination & Keamanan CSV** | Diperbaiki pada [`app/api/v1/chambers/[chamberId]/export/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/chambers/[chamberId]/export/route.ts): traversal ekspor menggantikan offset `skip` dengan pagination berbasis keyset `(history_sequence ASC)` dengan snapshot watermark beku (*frozen watermark*). Count dan stream memakai eligibility snapshot yang identik. Stream menerapkan backpressure *pull* melalui `ReadableStream`, serta formula sanitization yang aman (tidak mengubah angka negatif numerik menjadi teks). |
| 3 | **Fail-Fast Konfigurasi & Header Keamanan** | Diperbaiki pada [`shared/pagination.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/shared/pagination.ts) dan [`lib/api/response.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/api/response.ts): secret cursor tidak lagi memiliki fallback insecure di lingkungan produksi (langsung melempar error konfigurasi jika tidak tersedia). Seluruh respons API menyertakan header `Cache-Control: no-store, private` untuk mencegah kebocoran data sensitif ke proxy atau cache bersama. |

---

## 2. Arsitektur Antarmuka & Manajemen Sesi (Fase 5)

### 2.1 Manajemen Sesi & Keamanan Token CSRF
- **Komponen: [`components/auth/AuthProvider.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/auth/AuthProvider.tsx)**
  - **Prinsip Keamanan Tanpa localStorage:** Sesi pengguna dikelola sepenuhnya melalui cookie `HttpOnly` (`esniffer_session`). Tidak ada token otentikasi yang disimpan di `localStorage`, `sessionStorage`, atau terekspos ke JavaScript sisi klien.
  - **Token CSRF In-Memory:** Saat mount atau refresh, `AuthProvider` memanggil `GET /api/v1/auth/session` untuk memvalidasi cookie dan memulihkan profil user beserta token CSRF sesi ke dalam memori React.
  - **Otomatisasi `apiFetch`:** Wrapper `apiFetch` secara transparan menyuntikkan header `X-CSRF-Token` pada metode mutasi (`POST`, `PATCH`, `DELETE`).
  - **Penanganan 401 Terpusat:** Jika endpoint mengembalikan HTTP 401 (sesi kedaluwarsa atau tidak valid), poller dihentikan seketika dan pengguna diarahkan ke `/login?redirect=...`.

### 2.2 Halaman Otentikasi Aksesibel
- **Halaman: [`app/login/page.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/login/page.tsx)**
  - Mengikuti panduan modern web & aksesibilitas: atribut `autocomplete="username"` dan `autocomplete="current-password"`, `type="email"`, tombol toggle lihat/sembunyikan kata sandi dengan `aria-label` dan `aria-pressed`.
  - Penanganan error terstruktur dengan banner accessible ber-atribut `role="alert"`.
  - State tombol dinonaktifkan dengan animasi indikator spinner selama proses verifikasi.
  - Dibungkus dengan `<Suspense>` boundary untuk memenuhi standar Next.js 16 App Router CSR bailout.

### 2.3 Navigasi Dinamis & Kompatibilitas Legacy URL
- **Komponen: [`components/layout/Header.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/layout/Header.tsx)**
  - Mengambil daftar chamber aktif secara dinamis dari `GET /api/v1/chambers?active=true`.
  - Tombol hardcoded Chamber 1 / Chamber 2 digantikan tombol navigasi dinamis dengan penanda aktif (*active highlight*).
  - **Kompatibilitas Legacy:** Mendukung URL lama `/chamber/1` dan `/chamber/2` dengan memetakannya secara otomatis ke chamber yang sesuai (`CH-01`, `CH-02`).
  - Menampilkan profil pengguna aktif (email), badge hak akses (`ADMIN` berwarna hijau/cyan atau `VIEWER` berwarna ungu), serta tombol logout yang membersihkan sesi dan mengarahkan ke halaman login.

---

## 3. Telemetri Real-time & Visualisasi Dashboard

### 3.1 Poller Tunggal per Chamber
- **Hook: [`hooks/useChamberLatest.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/hooks/useChamberLatest.ts)**
  - **Interval Awal:** 5.000 ms (5 detik).
  - **Tanpa Overlap Request:** Menggunakan rekursif `setTimeout` yang hanya menjadwalkan polling berikutnya setelah request sebelumnya selesai.
  - **Timeout & Pembatalan:** Timeout 8.000 ms via `AbortController`. Request langsung dibatalkan saat pengguna berpindah chamber atau komponen unmount.
  - **Pencegahan Race Condition:** Menggunakan pencatat nomor generasi request (`activeReqIdRef`). Respons yang datang terlambat dari chamber lama langsung diabaikan dan tidak akan menimpa data chamber baru.
  - **Exponential Backoff:** Saat terjadi gangguan jaringan atau database, interval mundur secara eksponensial (5s $\to$ 10s $\to$ 20s $\to$ 30s max), dan segera direset ke 5s saat berhasil.
  - **Optimasi Tab Tersembunyi:** Mendengarkan event `document.visibilitychange`. Saat tab browser di-minimize atau disembunyikan, polling diperlambat ke interval maksimum (30s) untuk menghemat daya dan bandwidth. Saat tab aktif kembali, poller langsung memicu pembacaan segar jika data sudah lewat toleransi.
  - **Retensi Data Stale (*Degraded Mode*):** Kegagalan fetch tidak menghapus data metrik yang ada; data terakhir tetap dipertahankan dengan indikator visual `Degraded (Cached)`.
  - **Bebas Console Spam:** Polling yang berhasil tidak mencetak log spam ke console browser.

### 3.2 Penyajian 4 Dimensi Status Independen
- **Halaman: [`app/chamber/[chamberId]/page.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/chamber/[chamberId]/page.tsx)**
- **Kartu Metrik: [`components/ui/MetricCard.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/ui/MetricCard.tsx)** & **[`components/ui/SensorCard.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/ui/SensorCard.tsx)**
  1. **Request State:** Menampilkan status siklus fetch: `Poller OK`, `Connecting...`, atau `Degraded (Cached)`.
  2. **Connection State:** Menampilkan status koneksi perangkat aktif (`ONLINE`, `OFFLINE`, `UNKNOWN`) beserta bukti telemetri (`LIVE_STATUS`, `LWT`, dll.) dan waktu *last seen*.
  3. **Freshness State:** Diturunkan secara eksklusif dari timestamp `measuredAt`: `Fresh` ($\le 15$ detik) vs `Stale` ($> 15$ detik) vs `Unknown Time`.
  4. **Quality per Sensor:** Menampilkan status kalibrasi/kualitas (`OK`, `OUT_OF_RANGE`, `SENSOR_ERROR`) per instrumen.
  - **Keamanan Nilai Null:** Sensor yang bernilai `null` ditampilkan secara aman sebagai placeholder `--` (BUKAN angka `0` atau `0.00`).
  - **Pelabelan Eksplisit Gas:** Sensor gas MQ-137, MQ-136, dan MQ-4 secara eksplisit mencantumkan satuan konsentrasi `raw`.

### 3.3 Panel Grafik Deret Waktu (*Time-Series Series*)
- **Komponen: [`components/charts/ChartPanel.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/charts/ChartPanel.tsx)**
  - Terhubung ke endpoint agregasi PostgreSQL `GET /api/v1/chambers/[chamberId]/series`.
  - **Sinkronisasi URL Query:** Pilihan rentang waktu (`15m`, `1h`, `6h`, `24h`) tersinkronisasi langsung ke `searchParams` URL (misal: `?range=6h`) dan bertahan saat halaman di-refresh.
  - **Garis Putus untuk Nilai Null:** Seluruh elemen `<Line>` Recharts dikonfigurasi dengan `connectNulls={false}` sehingga data sensor yang hilang atau rusak menghasilkan celah (*gap*) putus dan tidak jatuh ke nol.
  - **Live Mode Tanpa Kedip:** Pembaruan background berkala memperbarui data grafik secara mulus tanpa mereset canvas atau memicu kedipan (*flicker*).

### 3.4 Panel Ekspor CSV & Tabel Riwayat
- **Komponen: [`components/layout/ExportPanel.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/layout/ExportPanel.tsx)**
  - Tombol unduh telemetri CSV terhubung ke `GET /api/v1/chambers/[chamberId]/export` menggunakan batas waktu aktif.
  - **Penanganan HTTP 413 (`PAYLOAD_TOO_LARGE`):** Jika data melebihi 50.000 baris, banner alert informatif muncul dan meminta pengguna mempersempit filter rentang waktu.
  - **Tabel Riwayat Berpaginasi Keyset:** Modal tabel riwayat terhubung ke `GET /api/v1/chambers/[chamberId]/history` dengan tombol *Halaman Berikutnya* berbasis token kursor bertanda tangan.
  - **Tautan Audit Unknown-Time:** Tautan audit langsung ke pembacaan waktu belum terpecahkan perangkat (`/api/v1/devices/[deviceId]/readings?timeQuality=UNKNOWN`).

---

## 4. Pengujian Browser Nyata (End-to-End dengan Google Chrome)

Pengujian dilakukan menggunakan peramban Google Chrome asli dalam mode headless melalui Puppeteer pada server produksi Next.js lokal (`PORT=3099`):

- **File Pengujian:** [`test/e2e/browser-dashboard.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/browser-dashboard.test.ts)

### Hasil Eksekusi Uji Browser

| No | Skenario Pengujian | Hasil | Durasi | Keterangan Verifikasi |
|---|---|:---:|:---:|---|
| 1 | **Login Gagal** | **PASS** | 788 ms | Menginput kredensial salah, banner `role="alert"` muncul dengan pesan otentikasi gagal. |
| 2 | **Login Sukses & Header** | **PASS** | 688 ms | Menginput kredensial valid, redirect otomatis ke dashboard chamber, header menyajikan email user dan badge `ADMIN`. |
| 3 | **4 Status Dimensi Independen** | **PASS** | 695 ms | Memverifikasi tampilan Request `Poller OK`, Connection `ONLINE`, Freshness `Fresh` ($\le 15$s), dan nilai metrik bersatuan. |
| 4 | **Sensor Null sebagai `--`** | **PASS** | 596 ms | Memverifikasi sensor MQ-136 dan MQ-4 bernilai NULL ditampilkan sebagai `--` (bukan nol) dengan label eksplisit `raw`. |
| 5 | **Navigasi Antar-Chamber** | **PASS** | 1.201 ms | Berpindah ke Chamber 2 membatalkan polling lama dan memuat data aktual Chamber 2 (`OFFLINE` & `Stale`). |
| 6 | **Sinkronisasi Rentang Waktu URL** | **PASS** | 627 ms | Memilih filter `6h` memperbarui query browser ke `?range=6h` dan memuat deret waktu sesuai. |
| 7 | **Penanganan HTTP 413 Export CSV** | **PASS** | 742 ms | Menekan ekspor pada chamber dengan 50.006 data memicu HTTP 413 dan menampilkan banner batas 50.000 baris. |
| 8 | **Logout & Pembersihan Sesi** | **PASS** | 714 ms | Menekan tombol Logout mencabut sesi, menghapus cookie, redirect ke `/login`, dan akses balik ditolak (401). |

**Total Waktu Uji Browser:** 9,55 detik (8 lulus, 0 gagal).

---

## 5. Rekapitulasi Verifikasi Menyeluruh

| Jenis Pemeriksaan | Perintah / Alat | Status | Hasil |
|---|---|:---:|---|
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS** | 0 error |
| **ESLint Quality & React Rules** | `npm run lint` (`eslint`) | **PASS** | 0 error, 0 warning |
| **Next.js Production Build** | `npm run build -- --webpack` | **PASS** | 19 routes terkompilasi; bundler default Turbopack memerlukan host tanpa pembatasan port proses internal |
| **Unit & Integration Tests** | `npm test` (11 test suites) | **PASS** | **134/134 tests pass** (0 fail, 0 skipped) |

---

## 6. Struktur File Baru & Modifikasi Fase 5

```
esniffer-udang-web/
├── app/
│   ├── chamber/
│   │   └── [chamberId]/
│   │       └── page.tsx              # Dashboard terintegrasi dengan 4 dimensi status dan API v1
│   ├── login/
│   │   └── page.tsx                  # Halaman login modern, accessible, dan in-memory CSRF
│   ├── layout.tsx                    # Root layout membungkus AuthProvider & Header
│   └── page.tsx                      # Root route redirect (/chamber/CH-01)
├── components/
│   ├── auth/
│   │   └── AuthProvider.tsx          # Konteks autentikasi, in-memory CSRF, session check, apiFetch
│   ├── charts/
│   │   └── ChartPanel.tsx            # Grafik Recharts dengan query sync (?range=1h) & connectNulls=false
│   ├── layout/
│   │   ├── Header.tsx                # Navigasi dinamis chamber dari API, profil user, & logout
│   │   └── ExportPanel.tsx           # Ekspor CSV aman, modal tabel riwayat keyset, & 413 banner
│   └── ui/
│       ├── MetricCard.tsx            # Kartu metrik dengan null safety (--) & indikator quality
│       └── SensorCard.tsx            # Kartu sensor gas dengan label 'raw' & penanganan null
├── hooks/
│   └── useChamberLatest.ts           # Poller tunggal recursive setTimeout, backoff, visibility change
├── test/
│   └── e2e/
│       └── browser-dashboard.test.ts # Pengujian browser nyata Puppeteer + Chrome (15 skenario)
└── docs/
    └── esniffer/
        └── 09-progress-fase-5.md     # Dokumen laporan Fase 5 ini
```

Fase 5 telah selesai secara tuntas, aman, dan terverifikasi di seluruh lapisan.

---

## 7. Audit Penutup Fase 5 (1 Oktober 2026)

Audit terarah setelah implementasi Fase 5 menemukan dan memperbaiki lima kategori temuan berikut.

### 7.1 Penguatan Logout di AuthProvider

**Temuan:** `logout()` memakai blok `finally` untuk selalu memanggil `setUser(null)` dan `router.push('/login')` tanpa memperhatikan status respons server. Kegagalan jaringan atau HTTP 5xx ditampilkan sebagai logout berhasil.

**Perbaikan di [`components/auth/AuthProvider.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/auth/AuthProvider.tsx):**
- HTTP 200/204 → revokasi sesi dikonfirmasi server → hapus state klien, redirect ke `/login`.
- HTTP 401 → sesi sudah tidak valid di server → aman hapus state klien, redirect ke `/login`.
- Kegagalan jaringan (fetch throw) atau HTTP 5xx → lempar `LogoutError` tanpa menghapus state. Sesi MUNGKIN masih aktif di server; jangan palsukan logout berhasil.
- Kelas `LogoutError` diekspor sehingga komponen dapat membedakan jenis kegagalan.

**Perbaikan di [`components/layout/Header.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/components/layout/Header.tsx):**
- Menangkap `LogoutError` dan menampilkan pesan error inline (`role="alert"`) di area profil pengguna tanpa redirect.
- Tombol logout dinonaktifkan selama proses logout berlangsung (`isLoggingOut`).

**Bukti pengujian:**
- Test 13 (auth.test.ts): `POST /logout` → HTTP 200 → session endpoint mengembalikan 401.
- Test 15 (auth.test.ts): Simulasi "refresh halaman" → CSRF dipulihkan via `GET /session` → logout berhasil → cookie lama 401.

### 7.2 Landing Page Dinamis (Menghapus Ketergantungan CH-01)

**Temuan:** `app/page.tsx` mengandung `redirect('/chamber/CH-01')` hardcoded.

**Perbaikan di [`app/page.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/page.tsx):**
- Komponen klien yang memanggil `GET /api/v1/chambers?active=true&limit=1` setelah autentikasi.
- Chamber pertama diurutkan deterministik (`code ASC`) dan diarahkan ke `/chamber/<code>`.
- Menangani: tidak ada chamber aktif (tampilan empty-state informatif dengan tombol Retry), kegagalan fetch (banner error dengan Retry), unauthenticated (redirect ke `/login`).
- Kompatibilitas URL lama (`/chamber/1`, `/chamber/2`) tetap ditangani oleh `Header.tsx` dan `useChamberLatest.ts`.

### 7.3 Freshness Badge Non-Freezing

**Temuan:** `renderFreshnessPill()` di `app/chamber/[chamberId]/page.tsx` membaca `freshness.state` dan `freshness.ageSeconds` dari respons API. Saat poller degraded, objek ini tidak diperbarui → badge "Fresh" membeku.

**Perbaikan di [`app/chamber/[chamberId]/page.tsx`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/chamber/[chamberId]/page.tsx):**
- Menambahkan ticker 1 detik berbasis `setInterval` yang menghitung `ageSeconds` dari `reading.measuredAt` secara real-time.
- `liveFreshnessState` dan `liveAgeSeconds` diperbarui setiap detik melalui `compute()`.
- Jika `measuredAt === null` (unknown-time), fallback ke `apiFresnhess.state` dari server.
- Ticker dibersihkan saat `measuredAt` berubah atau komponen unmount.
- Hasil: badge `Fresh` → `Stale (16s)` → `Stale (17s)` terus bertambah meski poller degraded.

### 7.4 Perbaikan Watermark Produksi dan Fixture

**Temuan (Produksi):** `export/route.ts` dan `history/route.ts` (halaman pertama) menggunakan fallback `MAX(history_sequence)` dari database jika nilai tersebut melebihi singleton watermark. Ini berpotensi mengekspos baris yang belum committed ke snapshot.

**Perbaikan di [`app/api/v1/chambers/[chamberId]/export/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/chambers/[chamberId]/export/route.ts) dan [`history/route.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/app/api/v1/chambers/[chamberId]/history/route.ts):**
- Hapus seluruh blok `MAX(history_sequence)` + fallback.
- Ganti dengan `const snapshotWatermark = await getCurrentWatermark();` — sumber tunggal yang otoritatif.

**Temuan (Fixture E2E):** Fixture browser test menggunakan `generate_series` PostgreSQL untuk menyisipkan 50.006 baris secara massal, yang melewati `allocateHistorySequence`. Hal ini menyebabkan `watermark < MAX(history_sequence)`, sehingga baris tersebut tidak terlihat oleh ekspor produksi — memaksa fallback MAX sebelumnya.

**Perbaikan di [`test/e2e/browser-dashboard.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/browser-dashboard.test.ts):**
- Fixture bulk berjalan di dalam satu `prisma.$transaction`.
- Baris singleton `history_sequence_watermark` dikunci dengan `SELECT ... FOR UPDATE`.
- Rentang 50.006 sequence dicadangkan dari nilai counter yang terkunci, seluruh reading dimasukkan dengan `generate_series`, lalu watermark diperbarui ke akhir rentang sebelum transaksi commit.
- Insert dan watermark tidak dapat terlihat sebagian: rollback membatalkan keduanya, sedangkan commit mempertahankan invariant `watermark >= MAX(history_sequence)`.

**Perbaikan fixture API di [`test/api/series-export.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/series-export.test.ts):**
- Reading suhu negatif dan reading yang datang setelah snapshot kini mengalokasikan sequence melalui `allocateHistorySequence(tx)` dan insert dalam transaksi yang sama.
- Tidak ada lagi sequence fixture tetap yang berada di atas singleton watermark dan merusak invariant global.

**Perbaikan DB Client:** [`lib/db/client.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/lib/db/client.ts) menambahkan `options: '-c timezone=UTC'` pada `pg.Pool` sehingga seluruh koneksi database menggunakan UTC — bukan zona waktu sistem host (US/Pacific pada macOS ini).

### 7.5 Pengujian Terarah Baru

**Auth Binding Proof (unit-level, [`test/api/auth.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/auth.test.ts)):**
| No | Skenario | Hasil |
|---|---|:---:|
| 14 | CSRF token sesi A ditolak 403 pada sesi B | **PASS** |
| 15 | Refresh halaman → CSRF dipulihkan → logout berhasil → cookie lama 401 | **PASS** |

**Browser E2E Baru ([`test/e2e/browser-dashboard.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/e2e/browser-dashboard.test.ts)):**
| No | Skenario | Cakupan |
|---|---|---|
| 9 | URL query `?range=6h` bertahan setelah refresh | Range persistence |
| 10 | 401 dari poller → redirect ke `/login` | Polling halt on 401 |
| 11 | Navigasi cepat ke chamber lain tidak menampilkan data chamber lama | Race condition guard |
| 12 | CSV endpoint mengembalikan 200 atau 401 (bukan 500/413 untuk data kecil) | Export correctness |
| 13 | Mobile viewport 375×667 tanpa overflow horizontal | Responsive layout |
| 14 | Navigasi keyboard: Tab/Enter bekerja pada form login | Keyboard accessibility |
| 15 | Putuskan request `latest` → `Degraded (Cached)` → freshness terus menua → request pulih → `Poller OK` | Outage retention & recovery |

**Timestamp dan filter rentang ([`test/api/series-export.test.ts`](file:///Users/IRHAM/Documents/GitHub/esniffer-udang-web/test/api/series-export.test.ts), test 9):**
- Memastikan `measured_at` dan `received_at` bertipe PostgreSQL `timestamp with time zone`.
- Menyimpan `2026-09-16T17:00:00.123+07:00`, membaca kembali instant yang sama sebagai `2026-09-16T10:00:00.123Z`, lalu memfilter ekspor memakai batas `+07:00` tanpa pergeseran.
- Tidak diperlukan perubahan tipe kolom; skema Prisma dan PostgreSQL sudah memakai `TIMESTAMPTZ(3)`.

### 7.6 Status Keterbatasan

| Area | Status Aktual |
|---|---|
| **Concurrency test isolation** | **SELESAI** — script DB/API/E2E dan `npm test` memakai `--test-concurrency=1` karena seluruh suite berbagi database dan singleton watermark. Suite DB gabungan lulus 19/19; suite penuh lulus 134/134. |
| **CSV negative temperature** | **SELESAI** — fixture memakai alokasi sequence transaksional; assertion asli tetap dan test lulus. |
| **E2E outage retention (UI)** | **SELESAI** — request browser ke endpoint `latest` benar-benar diabort, UI masuk degraded dengan data cached, freshness bertambah, dan poller kembali sehat setelah request dilepas. |
| **TLS/mTLS** | **TERSISA DI LUAR FASE 5** — ACL lokal Mosquitto lulus, tetapi TLS end-to-end tetap memerlukan sertifikat dan pengujian fase berikutnya. |

---

## 8. Rekapitulasi Verifikasi Audit Penutup

| Jenis Pemeriksaan | Perintah | Status | Hasil |
|---|---|:---:|---|
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** | 0 error |
| **ESLint** | `npm run lint` | **PASS** | 0 error, 0 warning |
| **Production Build** | `npm run build -- --webpack` | **PASS** | Next.js 16.3.0, 19 routes terkompilasi. `npm run build` dengan Turbopack default tidak dapat diselesaikan di sandbox karena proses CSS internal dilarang membuka port lokal (`Operation not permitted`), bukan karena error source. |
| **Full Test Suite** | `npm test` | **PASS** | **136/136**, 12 suite, 0 gagal, 0 skip; seluruh file diserialisasi terhadap state DB global, termasuk trace full-stack baru. |
| **Auth Unit Tests** | `node --test test/api/auth.test.ts` | **PASS** | **15/15** (termasuk 2 CSRF binding baru) |
| **DB Integration Tests** | `npm run test:db` | **PASS** | **19/19** dalam satu eksekusi serial |
| **API Tests** | `node --test test/api/readings-latest-history.test.ts` | **PASS** | **5/5** |
| **Series/Export + Timestamp** | `node --test test/api/series-export.test.ts` | **PASS** | **9/9**, termasuk suhu negatif, frozen watermark, dan filter timezone |
| **Browser Dashboard** | `node --test test/e2e/browser-dashboard.test.ts` | **PASS** | **15/15**, termasuk outage → degraded → recovery |

### Pekerjaan Tersisa

- Tidak ada pekerjaan aplikasi tersisa untuk empat butir verifikasi Fase 5 pada audit ini.
- Jika validasi harus memakai bundler default, jalankan ulang `npm run build` di host/CI tanpa pembatasan port proses Turbopack. Build produksi ekuivalen dengan Webpack sudah lulus.
- TLS/mTLS MQTT tetap menjadi pekerjaan fase berikutnya dan tidak termasuk lingkup penyelesaian ini.

Verifikasi integrasi nyata dari simulator hingga dashboard, termasuk trace ID lintas lapisan dan integrity path, dicatat di [`10-verifikasi-integrasi-end-to-end.md`](./10-verifikasi-integrasi-end-to-end.md).
