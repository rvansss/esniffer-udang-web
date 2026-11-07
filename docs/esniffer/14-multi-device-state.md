# 14 — State Multi-Perangkat & Identitas Operator (Fase 0)

Status: **selesai diimplementasikan** · Migrasi: `20261116120000_operator_state_multidevice`

## 1. Masalah yang diselesaikan

Aplikasi memakai **satu akun** yang dipakai bergiliran oleh beberapa operator, diakses dari
perangkat berbeda (browser HP dan laptop). Sebelum fase ini, tiga hal hanya hidup di
`localStorage` browser masing-masing:

| State | Sebelum | Akibat |
|---|---|---|
| Kalibrasi dua tahap | `esniffer:calibration:run-v2:<batch>:<group>` | Dimulai di HP, laptop menampilkan "belum kalibrasi" → harus mengulang 35 menit |
| Draf wizard batch baru | satu kunci global `esniffer:batch-draft-v5` | Tidak bisa dilanjutkan di perangkat lain; dua operator di satu browser saling menimpa |
| Isian modal tahap (suhu/berat/foto) | state React | Hilang saat tab dibuang/reload (sering di HP) |

Selain itu, `warmupDone: true` dikirim hardcode oleh UI dan hanya diperiksa sebagai boolean,
sehingga **klaim "kalibrasi selesai" tidak bisa diaudit** di dataset.

## 2. Keputusan

1. **Server adalah satu-satunya sumber kebenaran** untuk state pra-sesi. Klien hanya menggambar.
2. **Waktu mulai absolut, bukan sisa detik.** Yang disimpan `startedAtUtc` per langkah; sisa waktu
   dihitung dari jam server di perangkat mana pun.
3. **Jam server yang menetapkan waktu.** Klien tidak pernah mengirim timestamp kalibrasi
   (`lib/dataset/calibration.ts` memakai `nowMs()` di `lib/runtime/clock.ts`).
4. **Optimistic concurrency** untuk draf: setiap penyimpanan membawa `version`; versi basi ditolak
   `409 DRAFT_VERSION_CONFLICT` beserta data terbaru — draf tidak pernah tertimpa diam-diam.
5. **Identitas operator terpisah dari akun.** Akun tetap satu; nama operator + perangkat dicatat di
   baris dataset (prinsip ALCOA "attributable" tanpa memecah akun lebih dulu).

## 3. Skema

```
auth_sessions        + device_id, device_label, user_agent, last_ip, operator_name
group_calibrations     batch_id, group_id (unique), steps JSONB, completed_at_utc,
                       version, updated_by_user_id, updated_by_operator, updated_by_device
batch_drafts           owner_id, owner_operator, owner_device_id/label, label, step,
                       payload JSONB, status OPEN|CONSUMED|DISCARDED, version, consumed_batch_id
measurement_sessions + calibration_completed_at_utc, calibration_version,
                       created_by_operator/device, completed_by_operator/device
collection_batches   + operator_label, created_by_device
```

`steps` berbentuk `[{ key: 'closed'|'measure', durationMins, startedAtUtc }]`; divalidasi di
`lib/calibration.ts` (bukan constraint DB) agar bentuknya bisa berkembang tanpa migrasi.

## 4. Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/groups/:groupId/calibration` | Status kalibrasi (VIEWER boleh) |
| PUT | `/api/v1/groups/:groupId/calibration` | `{action:'start', durations:[30,5]}` · `{action:'advance', stepIndex, durationMins}` · `{action:'reset'}` (ADMIN) |
| DELETE | `/api/v1/groups/:groupId/calibration` | Reset |
| GET | `/api/v1/batch-drafts` | Draf terbuka akun ini (≤ 7 hari, ≤ 20 draf) |
| POST | `/api/v1/batch-drafts` | Buat draf (payload disaring, maks 64 KB) |
| GET/PUT/DELETE | `/api/v1/batch-drafts/:id` | Baca / simpan (butuh `version`) / buang |
| POST | `/api/v1/batch-drafts/:id/consume` | Tandai draf menjadi batch (idempoten) |
| GET | `/api/v1/auth/devices` | Daftar sesi aktif + label perangkat + operator |
| DELETE | `/api/v1/auth/devices/:sessionId` | Cabut satu perangkat |
| PATCH | `/api/v1/auth/operator` | Ganti nama operator perangkat ini |

`GET /api/v1/batches/:batchId` kini menyertakan `calibration` per grup, jadi halaman detail tidak
menembak endpoint per grup.

## 5. Perilaku yang berubah

- **Sesi live** (`POST /groups/:groupId/sessions`) menolak 422 bila kalibrasi belum selesai menurut
  jam server; `warmupDone` diturunkan dari baris kalibrasi, dan `calibrationCompletedAtUtc`
  tersimpan per sesi.
- **Sesi rentang waktu** (`autoBackfill`) tetap tidak menuntut kalibrasi (retrospektif).
- Halaman detail batch **memuat ulang tiap 15 detik** saat tab terlihat + saat tab kembali aktif,
  dijeda ketika ada modal/busy. Status kalibrasi yang dimulai di HP muncul di laptop tanpa reload.
- Setelah sesi live dibuat, kalibrasi di-reset **di server** (tahap berikutnya wajib kalibrasi ulang).
- Draf wizard: autosave 800 ms ke server, daftar "lanjutkan draf" lintas perangkat, konflik versi
  diselesaikan manual (muat versi terbaru / buang), draf yang menjadi batch berstatus `CONSUMED`.
- Foto tetap tidak ikut draf (`File` tidak bisa diserialisasi); caption ikut tersimpan.

## 6. Kebijakan sesi (menjawab "berapa sesi per login")

- Satu login = **satu baris `auth_sessions`** dengan `device_id` sendiri. Tiga perangkat = tiga sesi.
- Login ulang di perangkat yang sama **mencabut sesi lama perangkat itu** (tidak menumpuk).
- Batas `MAX_SESSIONS_PER_USER` (default 10, lihat `.env.example`); sesi tertua dicabut otomatis.
- TTL sesi tetap 24 jam absolut; `last_used_at` di-throttle 5 menit.
- Setiap perangkat bisa dicabut sendiri lewat panel operator di header (tanpa mengeluarkan semua).

## 7. Yang sengaja belum dikerjakan (Fase 1)

- **Lease/klaim kerja per batch** — mencegah dua operator memulai timepoint berbeda tanpa sadar.
- **Auto-complete di worker** — saat ini countdown penyelesaian sesi hanya berjalan selama halaman
  batch terbuka di salah satu perangkat.
- **Audit log append-only** untuk semua mutasi dataset.
- **Idempotency key** untuk pembuatan sesi/foto (retry jaringan).
- **Object storage** untuk foto (kini di `public/uploads` satu node).

## 8. Verifikasi

- `npm run typecheck`, `npm run lint`, `npm run build` — lulus.
- `npm run test:unit` (216), `npm run test:api` (157), `npm run test:db` (53) — lulus.
- `npm run db:drift` — hanya menyisakan drift lama pada `batch_photos` (indeks `session_id`),
  tidak terkait perubahan ini.
- Test kunci: `test/api/calibration.test.ts` (jam server dipatok, lintas sesi login),
  `test/api/batch-drafts.test.ts` (konflik versi, handover operator), `test/api/auth-devices.test.ts`
  (perangkat, operator, batas sesi).
