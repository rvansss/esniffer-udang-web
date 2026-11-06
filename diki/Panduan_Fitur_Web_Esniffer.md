# Panduan Fitur Web e-Sniffer Udang

> **Untuk siapa dokumen ini?** Untuk orang yang baru membaca kode proyek ini — misalnya tim solidarity,
> magang, atau siapa pun yang perlu memahami *apa saja* yang bisa dilakukan di web e-Sniffer, *file mana*
> yang mengimplementasikan tiap fitur, dan *alur datanya* dari tombol di browser sampai baris di database.
>
> Tidak perlu bisa pemrograman untuk mengikuti; istilah teknis dijelaskan saat muncul. Kalau ingin langsung
> loncat ke bagian tertentu, lihat **Daftar Isi** di bawah.

---

## Daftar Isi

1. [Gambaran besar: apa ini e-Sniffer Udang?](#1-gambaran-besar-apa-ini-e-sniffer-udang)
2. [Arsitektur tiga lapis + alur data](#2-arsitektur-tiga-lapis--alur-data)
3. [Kamus cepat istilah](#3-kamus-cepat-istilah)
4. [Peta halaman: URL → file → tugas](#4-peta-halaman-url--file--tugas)
5. [Fitur detail, halaman demi halaman](#5-fitur-detail-halaman-demi-halaman)
6. [Peta API (34 endpoint)](#6-peta-api-34-endpoint)
7. [Peta basis data (14 model)](#7-peta-basis-data-14-model)
8. [Aturan domain: file yang jadi sumber kebenaran](#8-aturan-domain-file-yang-jadi-sumber-kebenaran)
9. [Data keluar: dua jenis CSV](#9-data-keluar-dua-jenis-csv)
10. [Peta file & folder](#10-peta-file--folder)
11. [Menjalankan, mengisi data awal, dan menguji](#11-menjalankan-mengisi-data-awal-dan-menguji)
12. [Verifikasi independen dengan MCP REA](#12-verifikasi-independen-dengan-mcp-rea)
13. [Kesalahan umum & solusinya](#13-kesalahan-umum--solusinya)
14. [Glosarium](#14-glosarium)

---

## 1. Gambaran besar: apa ini e-Sniffer Udang?

e-Sniffer Udang adalah sistem yang **mengukur kesegaran udang secara otomatis** dan **mencatat seluruh
prosesnya** sebagai data yang bisa diaudit. Ada dua "dunia" yang saling terhubung:

| Dunia | Isinya | Dijalankan di |
|---|---|---|
| **Alat di lapangan** | ESP32 + sensor MQ-137 (amonia), MQ-136 (H₂S), MQ-4 (gas umum), DHT-22 (suhu & kelembapan) — ESP32 yang communicate via MQTT ke broker |
| **Web aplikasi** | Dashboard monitoring, formulir pencatatan batch, notifikasi "sensor sudah stabil" | Next.js (TypeScript) + PostgreSQL |

Tiga tujuan utama produknya:

1. **Monitoring** — teknisi melihat kondisi chamber & sensor *langsung* (grafik, kartu angka, notifikasi).
2. **Pencatatan** — setiap batch udang yang diuji dicatat dari pembelian sampai pengujian selesai, lengkap
   dengan foto, agar bisa diaudit dan dipresentasikan.
3. **Notifikasi** — kalau sensor sudah stabil 10 menit, sistem memberi tahu operator sehingga pengukuran
   bisa dimulai.

> **Analogi sederhana:** think of the system as a *notebook Experiments* untuk laboratorium-segmentasi Freshness.
> Alat di depan adalah "mata" yang mengukur; web aplikasi adalah "buku catatan" yang menyimpan dan
> menampilkan hasil pengukuran beserta semua keputusan operator.

---

## 2. Arsitektur tiga lapis + alur data

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  LAPIS 1 — Browser        │        │  LAPIS 2 — Worker (Node.js)   │
│  (Next.js "use client")   │        │  daemon MQTT terpisah         │
│                           │        │                               │
│  • Halaman & komponen     │  HTTP  │  • subscribe topic telemetry  │
│  • Form wizard 3 langkah  │◄──────►│  • validasi & simpan (Prisma) │
│  • Grafik, tabel, lonceng │  JSON  │  • ACK baru setelah COMMIT   │
└───────────┬───────────────┘        └───────────┬───────────────────┘
            │ apiFetch (cookie + CSRF)            │ TCP/TLS
            ▼                                    ▼
      ┌────────────────────────────────────────────────────────┐
      │  LAPIS 3 — Server Next.js (API routes) + PostgreSQL      │
      │  • 34 endpoint REST di app/api/v1/**                    │
      │  • Aturan validasi (lib/api/*, lib/batch-wizard.ts)     │
      │  • Tabel: batches, groups, sessions, photos, notifikasi │
      └────────────────────────────────────────────────────────┘
```

### Alur data untuk satu contoh: "sensor stabil → notifikasi"

1. ESP32 mengirim reading JSON ke topic MQTT tiap ~0,5 detik.
2. **Worker** (`worker/index.ts`) menySubscribe, memvalidasi (`worker/pipeline.ts`), lalu menyimpan ke
   `sensor_readings` (`worker/storage.ts`). **ACK ke ESP32 baru diterbitkan setelah transaksi database
   commit** — jadi data tidak pernah hilang diam-diam.
3. Sekali per menit, worker menjalankan `sweepStableSessions()` (`worker/stability.ts`): ia menghitung
   apakah 10 menit terakhir sensor *stabil* (`lib/stability.ts`), lalu membuat **satu notifikasi**
   `warmup_stable` untuk sesi tersebut.
4. Browser menampilkan lonceng dengan badge "belum dibaca" (`components/layout/NotificationBell.tsx`),
   diambil dari `GET /api/v1/notifications/unread-count`.
5. Saat operator membuka lonceng, ia melihat riwayat notifikasi + tombol **Tandai semua dibaca**
   (`PATCH /api/v1/notifications/read-all`).

### Alur data untuk contoh kedua: "mencatat satu batch udang"

1. Operator membuka `/batches/new` → **wizard 3 langkah** (`app/batches/new/page.tsx`).
2. Isian form disimpan otomatis ke **draf** di `localStorage` (`lib/batch-draft.ts`) — kalau halaman
   tertutup, isian tidak hilang.
3. Tombol **Simpan batch** mengirim dua permintaan: `POST /api/v1/batches` lalu
   `POST /api/v1/batches/{id}/groups` (dua grup: SR ruang & SD dingin), lalu foto diunggah lewat
   `POST /api/v1/batches/{id}/photos` (dengan `groupId` supaya foto tahu milik grup mana).
4. Setelah tersimpan, halaman `/batches/{batchId}` menampilkan semua isian + grup + sesi + foto.

---

## 3. Kamus cepat istilah

| Istilah | Arti sederhana |
|---|---|
| **Batch** | Satu kegiatan pembelian udang yang dicatat dari awal sampai akhir. Punya ID seperti `BT-20261021-01`. |
| **Grup SR** | Sample Group **Suhu Ruang** (25 ± 2 °C) — udang tanpa pendinginan khusus. |
| **Grup SD** | Sample Group **Suhu Dingin** (4 ± 1 °C) — udang didinginkan. |
| **Sesi (session)** | Satu pengukuran pada satu grup pada satu titik waktu (mis. H0, H6, H12). |
| **Chamber** | Wadah(termokontrol) berisi sensor; punya kode seperti `CH-01`. |
| **Device** | Papan ESP32 + sensor; punya kode seperti `esp32-001`, dan *ditugaskan* ke chamber. |
| **Cool box** | Kotak es yang mengawal udang; punya **suhu saat berangkat**, **suhu saat di pasar**, dan **suhu saat di lab**. |
| **Observasi** | Pengukuran yang dilakukan operator (bukan pengukuran otomatis sensor). |
| **Warmup** | Periode 30 menit sebelum pengukuran dimulai (sensor dinyalakan dulu). |
| **Baseline** | Pengukuran pertama pada satu sesi — dipakai sebagai pembanding. |
| **Deviasi cold-chain** | Kondisi ketika perjalanan lebih dari 3 jam; harus dicatat/disetujui operator. |
| **Draf (draft)** | Isian form yang tersimpan otomatis di browser, belum dikirim ke server. |

---

## 4. Peta halaman: URL → file → tugas

| URL | File utama | Tugas halaman | Peran |
|---|---|---|---|
| `/` | `app/page.tsx` | Mengarahkan ke chamber pertama yang aktif; kalau belum ada chamber → pesan + tombol coba lagi | ADMIN & VIEWER |
| `/login` | `app/login/page.tsx` | Masuk dengan email + password | semua |
| `/chamber/CH-01` | `app/chamber/[chamberId]/page.tsx` | **Dashboard**: kartu angka, status koneksi, grafik gas, tabel riwayat, ekspor CSV, panel chamber/device | ADMIN & VIEWER |
| `/batches` | `app/batches/page.tsx` | Daftar seluruh batch: pilih beberapa → hapus massal, lihat status kunci | ADMIN |
| `/batches/new` | `app/batches/new/page.tsx` | **Wizard 3 langkah** membuat batch baru | ADMIN |
| `/batches/{batchId}` | `app/batches/[batchId]/page.tsx` | Detail batch: data, 2 grup, sesi per grup, foto, form edit grup, kunci batch, hapus | ADMIN |

Komponen bersama yang dipakai di semua halaman:

| Komponen | File | Tugas |
|---|---|---|
| Header + navigasi + lonceng | `components/layout/Header.tsx`, `components/layout/NotificationBell.tsx` | Menu, nama chamber aktif, badge notifikasi, dropdown riwayat |
| Provider sesi login | `components/auth/AuthProvider.tsx` | Menyimpan user + token CSRF, memberi `apiFetch` ke seluruh halaman |
| Grafik sensor gas | `components/charts/ChartPanel.tsx` | Grafik MQ-137/136/4 + tombol rentang waktu |
| Panel ekspor & riwayat | `components/layout/ExportPanel.tsx` | Tombol "Tabel Riwayat" (modal), preset rentang, unduh CSV |
| Kartu & notifikasi UI | `components/ui/MetricCard.tsx`, `SensorCard.tsx`, `SuccessNotice.tsx`, `ConfirmDialog.tsx` | Angka besar, kartu sensor, notifikasi نجاح, dialog konfirmasi |

---

## 5. Fitur detail, halaman demi halaman

### A. Masuk, keluar, dan hak akses

**Tujuan:** memastikan hanya orang yang berwenang yang bisa mengubah data.

| Bagian | File | Penjelasan |
|---|---|---|
| Form login | `app/login/page.tsx` | Mengirim email + password ke `POST /api/v1/auth/login`. |
| Penyimpanan sesi | `lib/auth/session.ts` | Token acak disimpan di database (`auth_sessions`) dan **hash-nya** ditaruh di cookie `esniffer_session` (umur 24 jam). |
| Penjaga akses | `lib/auth/guard.ts` | `requireAuth(request, ['ADMIN'])` → menolak 401 (belum masuk) atau 403 (peran kurang). Token juga boleh lewat header `Authorization: Bearer`. |
| Anti-pemalsuan (CSRF) | `lib/auth/session.ts` | Token CSRF = HMAC-SHA256 dari token sesi. Semua mutasi (POST/PATCH/DELETE) harus mengirim header `X-CSRF-Token` + `Origin` yang cocok. |
| Wrapper fetch | `components/auth/AuthProvider.tsx` | `apiFetch()` menyisipkan cookie + token CSRF otomatis — dipakai semua halaman. |
| Peran | `prisma/schema.prisma` → `User.role` | `ADMIN` boleh mengubah; `VIEWER` hanya membaca. |

**Alur:** buka `/` → belum masuk → arahkan ke `/login` → login berhasil → cookie tersimpan → `GET
/api/v1/auth/session` mengembalikan user → halaman boleh dirender.

---

### B. Dashboard chamber (`/chamber/CH-01`)

**Tujuan:** melihat kondisi chamber & sensor secara langsung, dan mengunduh data untuk analisis.

| Fitur | File | Alur & detail |
|---|---|---|
| **Angka terkini (kartu metrik)** | `app/chamber/[chamberId]/page.tsx`, `components/ui/MetricCard.tsx` | `useChamberLatest()` → `GET /api/v1/chambers/{id}/latest` → kartu: suhu, kelembapan, konsentrasi gas, status koneksi, kesegaran data. |
| **Kesegaran data (freshness)** | `hooks/useChamberLatest.ts` | Hitungan mundur tiap detik di browser; ambang **15 detik** (lihat `FRESHNESS_THRESHOLD_SECONDS`). |
| **Data langsung (SSE)** | `hooks/useChamberStream.ts`, `app/api/v1/chambers/[chamberId]/stream/route.ts` | Server-Sent Events memberi tick tiap ~0,5 detik. Bila SSE mati, polling REST 0,5 detik mengambil alih; saat SSE hidup, polling melambat jadi 5 detik agar tidak membebani server. |
| **Grafik sensor gas** | `components/charts/ChartPanel.tsx` | Judul "Pergerakan Sensor Gas Aktif"; 3 garis (MQ-137/136/4) + tombol rentang 30s…24h. Data diambil dari `/api/v1/chambers/{id}/series`. |
| **Tabel Riwayat (modal)** | `components/layout/ExportPanel.tsx`, `app/api/v1/chambers/[chamberId]/history/route.ts` | Membaca **riwayat tersimpan** (bukan hanya tick live) → tetap berguna saat alat mati. Paginasi **keyset** (kursor bertanda tangan), 15 baris/halaman, rentang maks **satu tahun kalender**. |
| **Filter rentang + preset** | `components/layout/ExportPanel.tsx` | Preset: Hari Ini, 1/6/12/24 Jam, 7 Hari, 30 Hari, 1 Tahun; plus dua input tanggal/jam kustom. Perubahan input memicu muat ulang otomatis (debounce 400 ms). |
| **Ekspor CSV** | `app/api/v1/chambers/[chamberId]/export/route.ts`, `lib/api/csv.ts` | Dua CSV berbeda: **riwayat sensor** (kolom snake_case + `is_baseline`) dan **metadata batch** (lihat §9). |
| **Panel chamber & device** | `app/api/v1/chambers/route.ts`, `app/api/v1/devices/route.ts` | Daftar chamber aktif + device beserta penugasannya ke chamber. |

---

### C. Daftar batch (`/batches`)

| Fitur | File | Alur & detail |
|---|---|---|
| Tabel batch | `app/batches/page.tsx` | `GET /api/v1/batches?limit=100`; kolom: ID, sumber, jam beli, jumlah & berat udang, status terkunci. |
| Pilih beberapa + **hapus massal** | `app/batches/page.tsx`, `app/api/v1/batches/bulk-delete/route.ts` | Centang beberapa baris → dialog konfirmasi → hapus (butuh `force=true` bila masih ada data turunan). |
| Status kunci | `prisma/schema.prisma` → `CollectionBatch.lockedAt` | Batch terkunci tidak bisa diubah (lihat §5.E). |

---

### D. Wizard batch baru (`/batches/new`) — 3 langkah

**Tujuan:** membiarkan operator mengisi data batch dengan urutan yang logis, tanpa membuat layar HP terasa penuh.

| Langkah | Isi | Field & validasi (sumber: `lib/batch-wizard.ts`, `lib/api/validation.ts`, `shared/dataset.ts`) |
|---|---|---|
| **1. Pengadaan** | Berangkat & sumber udang | `Tanggal dan jam berangkat (WIB)` — terisi otomatis dari jam perangkat, **wajib 05:00–08:00 WIB** dan sebelum jam beli; `Suhu cool box saat berangkat (°C)` — desimal bebas (acuan **0–4 °C**; di luar acuan hanya peringatan, data tetap tersimpan); `Jenis sumber` — dropdown Pasar (default) / Supermarket / Tambak; `Sumber` — teks bebas ≤ 100 karakter. |
| **2. Kondisi & Dokumentasi** | Pembelian, kedatangan, kondisi udang & bukti foto | `Tanggal dan jam beli (WIB)` dan `Tanggal dan jam tiba di lab (WIB)` — keduanya **wajib 05:00–08:00 WIB**, urutan berangkat < beli < tiba; centang **deviasi cold-chain** bila perjalanan (beli → tiba) > 3 jam; `Kondisi awal udang` (mati/hidup); `Jumlah total udang` bilangan bulat ≥ 1 (acuan 1–10 ekor, di luar itu hanya peringatan); `Panjang udang` angka desimal bebas rentang; `Berat total` 0–2000 g; `Suhu awal udang` angka desimal bebas rentang; `Suhu cool box saat di pasar` dan `saat di lab` juga desimal bebas (acuan 0–4 °C, peringatan saja); **foto kondisi awal udang + caption** (JPG/PNG ≤ 5 MB, caption wajib ≤ 140 karakter). |
| **3. Pengelompokan** | Dua grup & cara simpan | `SR` (ruang) & `SD` (dingin) - tiap grup punya: `Suhu udang` (nilai awal, bebas rentang), `Temuan visual` (normal/melanosis/damaged/mixed_species), `Berat sampel sebelum observasi` > 0 g, `Berat total udang` > 0 g (≤ 2000 g), `Jumlah udang per sesi` bilangan bulat ≥ 1 (acuan 1–10 ekor, di luar itu hanya peringatan), radio **Dalam chamber / Langsung di kulkas** (khusus grup dingin), dan foto grup. Nilai suhu/berat ini **hanya nilai awal**; data per tahap observasi disimpan per sesi (lihat §5.E). |

Fitur pendukung di halaman ini:

| Fitur | File | Detail |
|---|---|---|
| **Draf otomatis** | `lib/batch-draft.ts` | Isian skalar disimpan ke `localStorage` (kunci `esniffer:batch-draft-v2`), **masa berlaku 7 hari**, **per akun**, caption foto ikut, penulisan ber-debounce 800 ms. Kalau ada draf, muncul banner pemulihan + tombol "Buang draf". |
| **Gate antar langkah** | `app/batches/new/page.tsx` | Tombol "Lanjut" hanya lolos bila langkah berjalan valid; galat dilompat ke langkah & field yang benar. |
| **Waktu WIB** | `shared/dataset.ts` | Nilai di layar selalu WIB (`wibDateTimeLocal`), disimpan ke DB sebagai UTC (`wibInputToUtcIso`) — satu interpretasi, tidak ada ambigu zona. |
| **Kirim ke server** | `app/api/v1/batches/route.ts`, `app/api/v1/batches/[batchId]/groups/route.ts`, `app/api/v1/batches/[batchId]/photos/route.ts` | Urut: buat batch → buat 2 grup → unggah foto → redirect ke detail. |

---

### E. Detail batch (`/batches/{batchId}`)

| Fitur | File | Alur & detail |
|---|---|---|
| Ringkasan data | `app/batches/[batchId]/page.tsx` | Menampilkan seluruh isian batch (dari `GET /api/v1/batches/{id}`). Label observasi: `Suhu udang (°C)` dan `Berat total udang (g)` — diambil dari nilai awal grup (langkah 3 wizard). |
| **Dua grup + mode penyimpanan** | `app/batches/[batchId]/page.tsx` | Judul grup-cold menampilkan mode: "Suhu Dingin, chamber" atau "…langsung di kulkas". Untuk grup kulkas, **pemilih chamber disembunyikan** saat membuat sesi (agar tidak tercampur dengan data chamber). |
| **Edit data utuh (satu tombol)** | `app/batches/[batchId]/page.tsx`, `app/api/v1/batches/[batchId]/route.ts` (`PATCH`) | Tombol **"Edit data"** di kartu DATA PENCATATAN membuka satu form utuh berisi tiga bagian wizard sekaligus (**Pengadaan**, **Kondisi & dokumentasi**, **Pengelompokan** per grup — tanpa tab). `Jenis sumber` jadi dropdown; centang deviasi cold-chain otomatis bila durasi beli → tiba > 3 jam. Validasi memakai `validateStepA`/`validateStepB`/`validateGroupFields` dari `lib/batch-wizard.ts`. Kirim `PATCH /api/v1/batches/{id}` (payload lengkap; nilai tak diubah tetap dikirim dari data lama — *merge* di server). `sizeGrade` **dihitung ulang** dari jumlah ÷ berat × 1000; semua gate wizard ditegakkan ulang (urutan waktu, jendela 05:00–08:00, rentang nilai); batch terkunci ditolak 409. |
| **Sesi per tahap (modal "Tahap N")** | `app/api/v1/groups/[groupId]/sessions/route.ts` | Tombol "Start Sesi" membuka modal berjudul **"Tahap N"** (N = posisi timepoint dalam urutan grup: H0 → Tahap 1, H6 → Tahap 2, dst.). Isi: `Suhu udang (°C)` −2…30 dan `Berat total udang (g)` > 0 ≤ 2000 (opsional, titik desimal), lalu **Foto dokumentasi** + caption (bukan lagi "(opsional)" — opsional dari sifa wajibnya tetap: boleh kosong). Suhu/berat disimpan **per sesi** (`measurement_sessions.shrimp_temp_c` / `shrimp_weight_g`, CHECK range di DB). Sesi **dinyatakan complete** setelah checkbox "Cleaning 70%" (`PATCH /api/v1/sessions/{id}/complete`). |
| **Tabel riwayat tahap (selalu tampil)** | `app/batches/[batchId]/page.tsx` | Tiap kartu grup punya tabel: **Tahap | Timepoint | Suhu | Berat | Foto | Aksi**. Baris muncul begitu sesi dibuat (tanpa blok `<details>`). Kolom Tahap memuat nomor tahap **dan** rentang jam WIB dari `startedAtUtc`/`endedAtUtc` (mis. `Tahap 1. (08:00–08:15)`; sesi yang masih `open` ditulis `berjalan`), judul sel (`title`) menyebut tanggal + jam lengkap untuk sesi lintas hari. Kolom Aksi: ikon pensil = koreksi suhu/berat (`PATCH /api/v1/sessions/{id}`; nilai eksplisit `null` mengosongkan), ikon ulang = data bocor/kurang lengkap → buka form ulang (`/reopen`); baris yang masih `open` juga memuat checkbox **Cleaning 70%** + tombol **Complete**. Suhu/berat tampil 2 desimal gaya Indonesia (6,25 °C). **Durasi pengujian hanya diisi di modal tahap** (`duration_seconds`); tidak ada lagi isian durasi di baris pemilih timepoint/chamber. |
| **Penampil foto tahap** | `app/batches/[batchId]/page.tsx` | Tombol kamera di kolom Foto membuka modal penampil: gambar + caption bernomor (1 kolom di HP, 2 kolom ≥ sm); tutup dengan tombol bertanda aksesibel. |
| **Ulangi sesi** | `app/api/v1/sessions/[sessionId]/reopen/route.ts` | Sesi `incomplete` bisa diulang tanpa membuat ID baru. |
| **Foto per grup** | `app/api/v1/batches/[batchId]/photos/route.ts` | Foto disimpan di `batch_photos` dengan `group_id` opsional (foto grup) serta `session_id` opsional (foto tahap — taut ke sesi, gagal 404 bila sesi bukan milik batch ini). Foto tahap tetap ikut galeri batch + tampil di tabel tahap; caption bisa diedit (PATCH) dan dihapus (dialog konfirmasi). |
| **Edit grup (bagian dari Edit data)** | `app/api/v1/groups/[groupId]/route.ts` (`PATCH`) | Blok grup di dalam form Edit data utuh; field yang boleh diubah via API: `labTempC`, `labWeightBeforeG`, `labWeightAfterG`, `coldStorageMode` — `visualCheck` & `sampleShrimpCount` tampil-saja. |
| **Kunci batch** | `app/api/v1/batches/[batchId]/lock/route.ts` | Setelah dikunci, semua mutasi batch/grup/sesi/foto ditolak **409**. Syarat: tidak boleh ada sesi yang masih `open`. |
| **Hapus batch** | `app/api/v1/batches/[batchId]/route.ts` | Hapus batch + foto + grup (cascade di DB); dialog konfirmasi. |

---

### F. Notifikasi "sensor sudah stabil"

| Fitur | File | Alur & detail |
|---|---|---|
| Hitung kestabilan | `lib/stability.ts` | Jendela **10 menit terakhir**; tiap sensor diuji: rentang, CV, drift/10 mnt, suhu & kelembapan. Ambang **berbeda per kondisi penyimpanan** (lihat tabel §8). |
| Sweep worker | `worker/stability.ts` | Dipanggil tiap menit; membuat notifikasi `warmup_stable` **sekali per sesi** (unik pada `(session_id, kind)`; balapan P2002 ditangani → tidak ada duplikat). |
| Lonceng + badge | `components/layout/NotificationBell.tsx` | Badge jumlah belum dibaca; dropdown riwayat (paginasi keyset); tombol tandai semua dibaca. |
| Modal + audio | `components/layout/NotificationBell.tsx` | Notifikasi baru membuka modal yang **wajib ditutup manual**; ada toggle audio (file mp3 di `public/assets/`). Audio tidak autoplay sebelum interaksi pengguna (kebijakan browser). |

---

### G. Worker ingestion (alat → server)

| Fitur | File | Detail |
|---|---|---|
| Daemon MQTT | `worker/index.ts` | Proses Node terpisah; subscribe topic telemetry + status; antrean tak terbatas dengan **maks 5 tugas paralel** (sesuai pool koneksi DB); **ACK hanya setelah COMMIT**; QoS 1 + sesi persisten; reconnect & graceful shutdown. |
| Pipeline validasi | `worker/pipeline.ts` | Validasi bentuk pesan, mendeteksi duplikat `message_id` (→ `MESSAGE_ID_CONFLICT`), perangkat tak dikenal (`DEVICE_UNKNOWN`), topik salah, dan waktu pengukuran tak Compounds (`accepted_unresolved_time` → `chamberId=null`, ditandai `UNKNOWN`). |
| Penyimpanan | `worker/storage.ts` | Tulis ke `sensor_readings` + `ingest_outcomes` (catatan hasil tiap pesan) dalam satu transaksi. |
| Health worker | `worker/health.ts`, `app/api/v1/ingest/health/route.ts` | Endpoint kesehatan (siap/tidak) untuk monitoring. |

---

## 6. Peta API (34 endpoint)

Semua endpoint berada di `app/api/**/route.ts`, memakai kontrak seragam: **`{ data: ... }`** saat sukses,
**`{ error: { code, message, details? } }`** saat gagal (lihat `lib/api/errors.ts` + `lib/api/response.ts`).

| Kode status | Arti | Contoh |
|---|---|---|
| 400 | Permintaan tidak wajar | payload rusak |
| 401 | Belum masuk | cookie/token tidak ada |
| 403 | Peran kurang | VIEWER mencoba menulis |
| 404 | Tidak ada | batch/grup/sesi tidak ditemukan |
| 409 | Konflik | duplikat, batch terkunci |
| 413 | Terlalu besar | ekspor melebihi batas |
| 422 | Gagal validasi | nilai di luar rentang |
| 503 | Layanan sementara turun | database tidak terjangkau |

**Autentikasi & health**

| Endpoint | Metode | Peran | File |
|---|---|---|---|
| `/api/v1/auth/login` | POST | — | `app/api/v1/auth/login/route.ts` |
| `/api/v1/auth/logout` | POST | semua | `app/api/v1/auth/logout/route.ts` |
| `/api/v1/auth/session` | GET | semua | `app/api/v1/auth/session/route.ts` |
| `/api/health/live`, `/api/health/ready` | GET | — | `app/api/health/*/route.ts` |

**Pencatatan batch**

| Endpoint | Metode | Peran | File |
|---|---|---|---|
| `/api/v1/batches` | GET/POST | GET semua · POST ADMIN | `app/api/v1/batches/route.ts` |
| `/api/v1/batches/{batchId}` | GET/PATCH/DELETE | GET semua · PATCH/DELETE ADMIN (PATCH menolak batch terkunci 409) | `app/api/v1/batches/[batchId]/route.ts` |
| `/api/v1/batches/bulk-delete` | POST | ADMIN | `app/api/v1/batches/bulk-delete/route.ts` |
| `/api/v1/batches/{batchId}/groups` | POST | ADMIN | `app/api/v1/batches/[batchId]/groups/route.ts` |
| `/api/v1/batches/{batchId}/photos` | GET/POST/PATCH/DELETE | GET semua · lain ADMIN | `app/api/v1/batches/[batchId]/photos/route.ts` |
| `/api/v1/batches/{batchId}/lock` | POST | ADMIN | `app/api/v1/batches/[batchId]/lock/route.ts` |
| `/api/v1/batches/{batchId}/export` | GET | semua | `app/api/v1/batches/[batchId]/export/route.ts` |
| `/api/v1/groups/{groupId}` | GET/PATCH | GET semua · PATCH ADMIN | `app/api/v1/groups/[groupId]/route.ts` |

**Sesi observasi**

| Endpoint | Metode | Peran | File |
|---|---|---|---|
| `/api/v1/groups/{groupId}/sessions` | POST | ADMIN | `app/api/v1/groups/[groupId]/sessions/route.ts` |
| `/api/v1/sessions/{sessionId}` | PATCH | ADMIN (batch terkunci → 409, sesi `locked` → 409) | `app/api/v1/sessions/[sessionId]/route.ts` |
| `/api/v1/sessions/{sessionId}/complete` | PATCH | ADMIN | `app/api/v1/sessions/[sessionId]/complete/route.ts` |
| `/api/v1/sessions/{sessionId}/reopen` | POST | ADMIN | `app/api/v1/sessions/[sessionId]/reopen/route.ts` |

**Chamber, device, telemetry**

| Endpoint | Metode | Peran | File |
|---|---|---|---|
| `/api/v1/chambers` | GET/POST | GET semua · POST ADMIN | `app/api/v1/chambers/route.ts` |
| `/api/v1/chambers/{chamberId}` | GET | semua | `app/api/v1/chambers/[chamberId]/route.ts` |
| `/api/v1/chambers/{chamberId}/latest` | GET | semua | `…/latest/route.ts` |
| `/api/v1/chambers/{chamberId}/history` | GET | semua | `…/history/route.ts` |
| `/api/v1/chambers/{chamberId}/series` | GET | semua | `…/series/route.ts` |
| `/api/v1/chambers/{chamberId}/stream` | GET (SSE) | semua | `…/stream/route.ts` |
| `/api/v1/chambers/{chamberId}/export` | GET | semua | `…/export/route.ts` |
| `/api/v1/devices`, `/api/v1/devices/{id}`, `/api/v1/devices/{id}/readings` | GET | semua | `app/api/v1/devices/**` |
| `/api/v1/assignments`, `/api/v1/assignments/{id}/end` | GET/POST | ADMIN | `app/api/v1/assignments/**` |
| `/api/v1/ingest/health` | GET | — | `app/api/v1/ingest/health/route.ts` |

**Notifikasi**

| Endpoint | Metode | Peran | File |
|---|---|---|---|
| `/api/v1/notifications` | GET | semua | `app/api/v1/notifications/route.ts` |
| `/api/v1/notifications/unread-count` | GET | semua | `…/unread-count/route.ts` |
| `/api/v1/notifications/{id}/read` | PATCH | semua | `…/[notificationId]/read/route.ts` |
| `/api/v1/notifications/read-all` | PATCH | semua | `…/read-all/route.ts` |

---

## 7. Peta basis data (14 model)

Semua tabel PostgreSQL didefinisikan di `prisma/schema.prisma`; nama kolom DB memakai `snake_case`
(`@@map`), sedangkan di kode TypeScript memakai `camelCase`.

| Model | Tabel | Isi | Relasi penting |
|---|---|---|---|
| `User` | `users` | akun: email, hash password, peran (`ADMIN`/`VIEWER`) | punya `AuthSession` |
| `AuthSession` | `auth_sessions` | token sesi (hash), masa berlaku, ip/user-agent | → `User` |
| `Chamber` | `chambers` | kode & nama chamber | punya `SensorReading`, `SampleGroup`, `MeasurementSession` |
| `Device` | `devices` | kode MQTT, nama, status koneksi | punya `DeviceAssignment` |
| `DeviceAssignment` | `device_assignments` | device ↔ chamber **berjangka waktu** (`active_from`, `active_until`) | → `Device`, `Chamber` |
| `DeviceTimeReference` | `device_time_references` |patokan waktu untuk rekonstruksi timestamp | → `Device` |
| `SensorReading` | `sensor_readings` | satu reading sensor (suhu, RH, gas, kualitas waktu) | → `Chamber`, `Device` |
| `CollectionBatch` | `collection_batches` | batch pencatatan (waktu, sumber, jumlah/berat udang, status kunci) | punya `SampleGroup`, `BatchPhoto` |
| `SampleGroup` | `sample_groups` | grup SR/SD: kondisi simpan, mode cold, suhu & berat sampel, jumlah ekor | → `CollectionBatch`, `MeasurementSession` |
| `MeasurementSession` | `measurement_sessions` | satu sesi observasi (timepoint H0/H6/…, chamber, device, status) + data tahap: `shrimp_temp_c` −2…30, `shrimp_weight_g` > 0 ≤ 2000 (CHECK `shrimp_ranges`) | → `SampleGroup` |
| `BatchPhoto` | `batch_photos` | foto + caption, `group_id` opsional (foto grup), `session_id` opsional (foto tahap, `ON DELETE SET NULL`) | → `CollectionBatch`, `SampleGroup`, `MeasurementSession` |
| `HistorySequenceWatermark` | `history_sequence_watermark` | penanda urutan riwayat per chamber (untuk paginasi) | → `Chamber` |
| `IngestOutcome` | `ingest_outcomes` | catatan hasil tiap pesan MQTT (accepted/duplicate/rejected) | → `Device` |
| `Notification` | `notifications` | notifikasi operator (jenis, pesan, sudah dibaca) | → `User` |

**Aturan yang dijaga database (bukan hanya aplikasi):**

- `UNIQUE (session_id, kind)` pada `notifications` → satu notifikasi per jenis per sesi.
- `CHECK sample_groups_plain_fridge_no_chamber` → grup dingin mode "kulkas" **wajib tanpa chamber**.
- `CHECK` + `UNIQUE` pada tabel lain menjaga integritas meski ada bug di aplikasi.
- Index untuk pencarian yang sering dipakai: `notifications(user_id, created_at)`, `batch_photos(batch_id, group_id)`,
  `sensor_readings(chamber_id, measured_at)`.

> **Penting:** beberapa aturan **harus** hanya di API, bukan di database. Contohnya "grup dingin mode chamber
> wajib punya chamber" — karena chamber ditugaskan **saat sesi dimulai**, bukan saat grup dibuat. Kalau
> dipaksakan di DB, form wizard yang sah akan ditolak.

---

## 8. Aturan domain: file yang jadi sumber kebenaran

Kalau ada aturan yang dipakai di beberapa tempat, aturan itu ditulis **satu kali** di modul bersama.
Tabel ini penting: kalau mau mengubah suatu aturan, cari file-nya di kolom kiri — jangan menyalin logika.

| Topik | File sumber | Dipakai oleh |
|---|---|---|
| Aturan kolom wizard (langkah 1–3) | `lib/batch-wizard.ts` (`validateStepA`, `validateStepB`, `validateGroupFields`) | wizard + form edit di halaman detail |
| Aturan kolom grup (suhu/berat/visual) | `lib/batch-wizard.ts` (`validateGroupFields`) | wizard + form edit detail |
| Rentang angka & caption foto | `lib/api/validation.ts` | API |
| Enumerasi & serialisasi batch/grup | `lib/api/dataset.ts` (`parse*`, `serialize*`, `DB_TO_*`) | API + ekspor CSV |
| Jendela pembelian, urutan transported, cold-chain | `shared/dataset.ts` | API + worker |
| Ambang kestabilan sensor | `lib/stability.ts` | worker sweep |
| Format waktu WIB | `shared/dataset.ts` (`wibDateTimeLocal`, `wibInputToUtc`, `wibInputToUtcIso`) | wizard + API + CSV |
| Draf browser | `lib/batch-draft.ts` | wizard |

**Tabel ambang kestabilan** (dari `lib/stability.ts`; nilai "lolos" = **≤ ambang**):

| Sensor | Metrik | Suhu ruang | Dingin kulkas | Dingin chamber |
|---|---|---|---|---|
| MQ-137/136/4 | rentang ÷ rata-rata | ≤ 2 % | ≤ 5 % | ≤ 3 % |
| MQ-137/136/4 | CV (SD ÷ rata-rata) | ≤ 1 % | ≤ 3 % | ≤ 2 % |
| MQ-137/136/4 | drift per 10 menit | ≤ 1 % | ≤ 2 % | ≤ 1,5 % |
| DHT-22 suhu | rentang | ≤ 0,5 °C | ≤ 1 °C | ≤ 0,5 °C |
| DHT-22 RH | rentang | ≤ 2 % RH | ≤ 3 % RH | ≤ 2 % RH |
| DHT-22 RH | rata-rata | — | — | < 95 % RH |

Sesi dianggap stabil hanya bila **seluruh sensor lolos pada jendela 10 menit yang sama**, dengan minimal
30 sampel dan rentang waktu ≥ setengah jendela.

---

## 9. Data keluar: dua jenis CSV

| Jenis | Endpoint | Isi |
|---|---|---|
| **Metadata batch** | `GET /api/v1/batches/{batchId}/export` | Satu baris per batch berisi kolom form (tanggal & jam **dipecah**: `procured_date`, `procured_time_wib`, `arrived_date`, `arrived_time_wib`; `cooler_temp_market_c`, `cooler_temp_lab_c`; `photo_count`; dst). Definisi header: `lib/api/csv.ts` (`DATASET_METADATA_CSV_HEADERS`). |
| **Riwayat sensor** | `GET /api/v1/chambers/{chamberId}/export` | Satu baris per reading: waktu, suhu, RH, gas, dan `is_baseline` (true untuk pengukuran pertama sebuah sesi). |

Semua waktu di CSV ditulis dalam **WIB** hasil konversi dari UTC yang tersimpan di database
(`toWibParts` di `lib/api/csv.ts`), termasuk kasus lewat tengah malam.

---

## 10. Peta file & folder

| Folder/berkas | Isi |
|---|---|
| `app/` | Halaman & API routes (Next.js App Router). `app/api/v1/**` = REST API. |
| `components/` | Komponen React: `layout/` (header, lonceng, panel ekspor), `charts/` (grafik), `ui/` (kartu, notifikasi, dialog), `auth/` (provider sesi). |
| `hooks/` | `useChamberLatest.ts` (polling + freshness), `useChamberStream.ts` (SSE). |
| `lib/` | Logika bersama: `api/` (payload & respons API, CSV, riwayat), `auth/` (sesi, guard, password), `stability.ts`, `batch-draft.ts`, `batch-wizard.ts`, `db/` (klien Prisma), `logging/`, `dataset/`. |
| `shared/` | Aturan domain lintas runtime (server & browser): `dataset.ts`, `time.ts`, `topic.ts`, `status.ts`, `units.ts`, `pagination.ts`, `canonical.ts`, `telemetry-schema.ts`. |
| `worker/` | Daemon MQTT: `index.ts`, `pipeline.ts`, `storage.ts`, `stability.ts`, `health.ts`, `config.ts`. |
| `prisma/` | Skema (`schema.prisma`), migrasi (`migrations/`), seed (`seed.ts`). |
| `test/` | Test otomatis: `test/*.test.ts` (unit), `test/api/` (API), `test/db/` (database), `test/e2e/` (alur penuh), `test/deployment/`. |
| `scripts/` | Bantu operasional (`create-viewer.ts`). |
| `diki/` | Dokumen kerja proyek (panduan pemula, rencana revisi, checklist verifikasi manual, logbook). |
| `docs/` | Dokumen SKPL, gambar, dan panduan MCP. |
| `docker/`, `deploy/`, `E_Sniffer_ESP32/`, `esniffer_esp32_nextion/` | Wadah, deployment, dan firmware ESP32 (bukan bagian web). |

---

## 11. Menjalankan, mengisi data awal, dan menguji

```powershell
npm install                 # pasang dependensi
npx prisma migrate deploy   # terapkan skema database
npx prisma generate         # buat Prisma Client
npm run seed                # isi data contoh (admin + chamber + device)
npm run dev                 # jalankan web (http://localhost:3000)

npm run typecheck           # cek tipe TypeScript
npx eslint .                # cek kualitas kode
npm run test:unit           # test unit murni (tanpa database)
npm run test:db             # test database (jalankan serial)
npm run test:api            # test endpoint API (butuh server + database)
```

Worker dijalankan **terpisah** dari web (butuh broker MQTT & sertifikat TLS):

```powershell
node --experimental-strip-types worker/index.ts
```

Untuk versi kontainer, lihat `deploy/compose.production.yml` (peran runtime, secret MQTT, `WORKER_CONCURRENCY=5`,
`WORKER_MAX_QUEUE=500`); konfigurasi broker MQTT lokal ada di `docker/mosquitto/`.

Akun seed bawaan: `admin@esniffer.local` / `admin123` (ADMIN) dan `viewer@esniffer.local` / `viewer123`
(VIEWER) — **ganti password-nya sebelum dipakai di lingkungan nyata**.

---

## 12. Verifikasi independen dengan MCP REA

Dokumen ini disusun dari membaca kode. Sebagai pemeriksa silang, artefak **build yang benar-benar
ter-deploy** dianalisis dengan MCP [REA](https://github.com/morluto/rea) (Reverse Engineer Anything) —
alat yang bisa membaca hasil build tanpa perlu menjalankan aplikasinya.

**Perintah yang dipakai:**

```powershell
rea analyze-javascript-application "<path>/.next/server" --json > hasil.json
```

**Hasil faktual (21 Oktober 2026):**

| Ukuran | Nilai |
|---|---|
| Berkas relevan diperiksa | **583** (12,1 MB teks) |
| Berkas JavaScript ter-parse | **212** (0 kegagalan parse) |
| Simpul AST dikunjungi | **477.036** |
| Modul teridentifikasi | **95** |
| Temuan | **1.222** |
| Digest artefak | `161ff55ccce2c78408b253d9f80694e636714378d698a11b7ce2fb68ef6bdbf4` |
| Batasan analisis | 17 limitation (graf semantik dipangkas oleh plafon 20.000/100.000 node) |

**Yang terkonfirmasi dari artefak build** (bukan dari source): seluruh route API ada sebagai
`app/api/v1/**/route.js` - 34 endpoint, termasuk `notifications/read-all`, `batches/bulk-delete`,
`groups/[groupId]/sessions`, `chambers/[chamberId]/stream`. Kata kunci fitur yang muncul di bundel:
`stability` 8.826, `chamber` 4.217, `batches` 2.718, `notification` 1.246, `reopen` 259,
`bulk-delete` 216, `unread` 247, `ingest` 242, `mq137/136/4` 92 masing-masing, `csv` 38, `warmup` 32,
`supermarket` 12, `wizard` 8, `draft` 4.

**Pelajaran penting untuk pemula:** nama tabel database (`sample_groups`, `batch_photos`) **tidak
muncul** di analisis REA — karena Prisma Borde sending SQL ke mesin query native, bukan menyematkan
SQL di JavaScript. Artinya: analisis artefak build sangat berguna untuk **memetakan fitur & endpoint**,
tapi **tidak** menggantikan membaca skema (`prisma/schema.prisma`) untuk memahami data. Dua sumber ini
saling melengkapi.

MCP REA sudah terhubung ke proyek ini (lihat `docs/Panduan_Menghubungkan_MCP_REA.md`).

---

## 13. Kesalahan umum & solusinya

| Gejala | Penyebab | Solusi |
|---|---|---|
| Halaman "Memuat…" tak pernah selesai | `/api/v1/auth/session` gagal / database mati | cek `npm run dev` + `docker compose ps`; lihat `GET /api/health/ready` |
| Login ditolak | user belum di-seed | `npm run seed` |
| "Gagal memuat chamber" | belum ada chamber aktif | seed sudah membuat CH-01/CH-02; cek `GET /api/v1/chambers?active=true` |
| Tombol "Lanjut" tidak bergerak | field wajib di langkah itu belum valid | pesan merah muncul per field; perbaiki dulu |
| "Harus di antara 05:00–08:00 WIB" | jam berangkat/beli/tiba di luar jendela (jam perangkat) | setel jam perangkat; jam device = sumber nilai default |
| "Di luar acuan 0–4 °C — data tetap bisa disimpan" (kuning) | suhu cool box menyimpang dari protokol cold-chain | bukan galat: data tetap tersimpan; ukur ulang dengan termometer terkalibrasi bila perlu |
| "Di luar acuan 1–10 ekor — data tetap bisa disimpan" (kuning) | jumlah udang di luar kebiasaan protokol | bukan galat: periksa apakah jumlah ekor memang sebanyak itu |
| "Harus berupa angka" / "di luar kapasitas kolom" | isian tidak numerik atau melebihi 999.99 (kapasitas kolom desimal) | isi angka dengan titik desimal, mis. 2.75 |
| Batch terkunci tidak bisa diubah | `lockedAt` terisi | buka batch baru atau hapus (kalau memang dibatalkan) |
| Notifikasi tidak muncul | worker tidak berjalan / sensor belum stabil 10 menit | jalankan worker; cek `GET /api/v1/ingest/health` |
| Tabel riwayat kosong | rentang terlalu sempit | pilih preset "Hari Ini" atau "1 Tahun"; data dibaca dari DB, bukan dari tick live |
| Gagal parse Prisma saat `npm run build` | Prisma Client belum di-generate untuk Node aktif | `npx prisma generate` |

---

## 14. Glosarium

| Istilah | Penjelasan teknis singkat |
|---|---|
| **Keyset pagination** | Paginasi berbasis kursor bertanda tangan, bukan `OFFSET` → cepat dan stabil saat data bertambah. |
| **Watermark** | Penanda urutan terakhir yang sudah terbaca; data di atasnya masih tampil di grafik. |
| **CSRF** | Token yang membuktikan permintaan berasal dari aplikasi kita, bukan situs lain. |
| **Idempoten** | Operasi yang boleh diulang tanpa efek samping ganda (mis. tandai notifikasi dibaca). |
| **Deviasi** | Penyimpangan yang dicatat/disetujui, bukan error (mis. perjalanan > 3 jam). |
| **CHECK constraint** | Aturan yang dipaksakan database, bukan aplikasi. |
| **SSE** | Server-Sent Events: kanal satu arah dari server ke browser untuk data langsung. |
| **Migration** | Berkas perubahan skema database yang diterapkan berurutan. |
| **Keyset/kursor bertanda tangan** | Kursor berisi filter + `HMAC`, jadi tidak bisa dipalsukan. |

---

*Dokumen ini dibuat dan diverifikasi pada 21 Oktober 2026 (commit `a2900f4`). Numerik & nama file
mengacu pada kondisi repo saat itu. Bila ada fitur baru, perbarui bagian 4–7 dan isi ulang tabel di
bagian 12 dengan analisis REA agar tetap akurat.*
