# 15 — Sinkronisasi Waktu Kalibrasi Antarperangkat

Status: **selesai diimplementasikan** · Tanpa migrasi (skema tidak berubah)

## 1. Masalah

Kalibrasi dikerjakan lintas perangkat: HP di chamber, laptop di lab, satu akun dipakai bergiliran.
Dua keluhan muncul saat tombol "Mulai kalibrasi" ditekan di laptop:

| Perangkat | Tampilan saat itu | Seharusnya |
|---|---|---|
| Laptop (yang menekan tombol) | `30:20` | `30:00` atau kurang |
| HP (tidak disentuh) | `29:15`, dan baru benar setelah halaman di-refresh | angka yang sama dengan laptop, tanpa refresh |

Dua gejala itu punya dua penyebab berbeda.

## 2. Akar masalah

1. **Jam perangkat dipakai untuk menghitung.** Server menyimpan WAKTU MULAI ABSOLUT
   (`group_calibrations.steps[].startedAtUtc`) dari `nowMs()` di `lib/runtime/clock.ts`, tetapi klien
   menghitung sisa dengan `Date.now()` perangkatnya sendiri. Waktu mulai yang sama dibaca oleh dua jam
   yang berbeda selisihnya menjadi dua hitungan yang berbeda:
   - laptop `30:20` → jam laptop **tertinggal 20 detik** dari server;
   - HP `29:15` → jam HP **mendahului 45 detik**.
   `calibrationStepRemainingMs()` juga tidak membatasi hasilnya ke durasi langkah, sehingga sisa bisa
   melebihi 30 menit.
2. **Tidak ada kanal real-time untuk state kalibrasi.** Satu-satunya sinkronisasi adalah polling detail
   batch tiap 15 detik (`app/batches/[batchId]/page.tsx`). SSE yang ada hanya untuk reading chamber
   (`GET /api/v1/chambers/:chamberId/stream`), bukan untuk kalibrasi.

## 3. Keputusan

1. **Jam server dipakai di klien.** Setiap respons JSON sukses membawa header `x-server-time` (epoch ms)
   dari `jsonResponse()`; `apiFetch` di `AuthProvider` mencatatnya ke `lib/client-clock.ts`, dan semua
   hitungan di halaman memakai `serverNowMs()` lewat hook `useServerNow()`. Body respons API tidak
   berubah, jadi kontrak data tetap.
2. **Offset dihitung dari titik tengah permintaan.** `offset = jam server − (kirim + terima)/2`, sampel
   dengan RTT terkecil dipertahankan, sampel lebih tua dari 2 menit diganti, dan nilai di luar batas
   wajar (7 hari) diabaikan. Keterlambatan jaringan jadi tidak menggeser hitungan.
3. **Sisa waktu di-clamp ke durasi langkah** (`Math.min(total, …)`), jadi perangkat yang jamnya belum
   tersinkron tidak pernah menampilkan angka lebih besar dari durasi.
4. **Perubahan state kalibrasi didorong SSE**, bukan menunggu polling. Payload membawa jam server juga,
   sehingga perangkat yang baru menerima state langsung menghitung dari waktu yang sama.

## 4. Endpoint & modul

| Item | Keterangan |
|---|---|
| Header respons `x-server-time` | epoch ms pada setiap respons JSON sukses (`lib/api/response.ts`) |
| `GET /api/v1/batches/:batchId/calibration/stream` | SSE; event `snapshot` (saat dibuka) dan `state` (saat berubah); `data: { serverTimeUtc, calibrations: { [groupId]: CalibrationWire \| null } }`; VIEWER boleh membaca |
| `lib/client-clock.ts` | `applyServerTime`, `applyServerTimeFromHeader`, `serverNowMs`, `subscribeClientClock`, `resetClientClockForTests` |
| `hooks/useServerNow.ts` | "sekarang" versi server yang di-tick tiap detik (dipakai halaman detail batch) |
| `hooks/useBatchCalibrationStream.ts` | langganan SSE + status `connecting/live/offline/unsupported`, sambung ulang 2 detik |
| `components/auth/AuthProvider.tsx` | `apiFetch` menyimpan sampel jam dari `x-server-time` |

Stream memeriksa `group_calibrations` tiap 1 detik dan hanya mengirim event saat sidik jari state
(`groupId:version`) berubah; heartbeat `: ping` tiap 15 detik menjaga proxy tidak menutup koneksi diam
(nginx `proxy_read_timeout 60s`, `proxy_buffering off`). Saat SIGTERM stream ditutup lewat
`onWebShutdown`, sama seperti stream chamber.

## 5. Perilaku setelah perbaikan

- Klik "Mulai kalibrasi" di perangkat mana pun → semua perangkat menampilkan sisa yang sama (selisih
  tampilan maksimal satu detik) dan tidak pernah melebihi durasi langkah.
- Perangkat lain menerima state baru dalam ±1 detik tanpa refresh. Bila SSE putus, polling detail batch
  15 detik tetap merekonsiliasi semuanya, dan hitungan tetap benar karena jamnya sudah tersinkron.
- Reset di satu perangkat dikirim sebagai `null` untuk grup itu, sehingga perangkat lain kembali ke
  "Kalibrasi belum dimulai".
- Countdown RECORDING sesi dan auto-complete memakai jam yang sama, jadi tidak lagi menyelesaikan sesi
  terlalu cepat/terlambat karena jam perangkat.

## 6. Batas yang disengaja

- Tidak ada validasi server tambahan "sesi tidak boleh selesai lebih awal" — di luar keluhan ini, dan
  jam tersinkron sudah menutup penyebab praktisnya.
- Bila `EventSource` tidak didukung/diblokir, UI tetap berjalan dengan polling (status `unsupported`).
- Panel operator di header dihapus terpisah; lihat [14 — State Multi-Perangkat](./14-multi-device-state.md) §6.

## 7. Verifikasi

- `npm run typecheck`, `npm run lint` — lulus (satu warning lama `uploadPhotos` di
  `test/api/dataset-batches.test.ts` sudah ada sebelum perubahan ini).
- `npm run test:unit` — 225 lulus, termasuk `test/client-clock.test.ts` (offset, sampel RTT, sampel basi,
  nilai rusak) dan clamp di `test/calibration.test.ts`.
- `npm run test:api` — 162 lulus, termasuk `test/api/calibration-stream.test.ts` (401/404, snapshot berisi
  semua grup + `serverTimeUtc`, kalibrasi dari perangkat lain langsung didorong, reset dikirim `null`) dan
  pemeriksaan header `x-server-time` di `test/api/calibration.test.ts`.
- Uji manual dua perangkat: laptop menekan Mulai → HP ikut menghitung tanpa refresh; angka sama dan tidak
  melebihi durasi; maju langkah 2 di HP → laptop ikut; reset di laptop → HP kembali "belum dimulai".
