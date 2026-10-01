# SKPL Tahap Awal e-Sniffer Udang

Dokumen Spesifikasi Kebutuhan Perangkat Lunak ini mendefinisikan perilaku yang dapat diuji. Arsitektur dan kontrak rinci ada di [03-technical-design.md](./03-technical-design.md); temuan baseline ada di [01-audit-existing.md](./01-audit-existing.md).

## 1. Ruang lingkup

Tahap awal mencakup:

- pendataan chamber, perangkat, dan periode penempatan perangkat;
- penerimaan paket telemetry MQTT;
- validasi, deduplikasi, dan penyimpanan pengukuran;
- pembacaan nilai terbaru, riwayat, agregasi grafik, dan ekspor CSV;
- status koneksi perangkat dan kesegaran data yang dipisahkan;
- autentikasi minimum untuk seluruh akses data serta otorisasi admin untuk mutasi.

Di luar ruang lingkup awal: klasifikasi kesegaran berbasis AI, alarm bisnis, aktuator, eksperimen/batch, multi-tenant, dan RBAC kompleks. Fitur tersebut hanya boleh masuk melalui keputusan ruang lingkup baru.

## 2. Aktor dan istilah

| Istilah/aktor | Definisi |
|---|---|
| Perangkat | Mikrokontroler terdaftar yang mengirim satu paket multi-sensor per siklus |
| Operator | Pengguna terautentikasi yang membaca dashboard/data |
| Admin | Pengguna terautentikasi dengan hak mengelola chamber, perangkat, dan penempatan |
| Worker | Proses Node.js terpisah yang subscribe MQTT dan menulis ke database |
| `measured_at` | Waktu UTC pengukuran yang diketahui dari jam tepercaya atau rekonstruksi tervalidasi; nullable bila tidak diketahui |
| `received_at` | Waktu server menerima pesan, selalu UTC |
| `measurement_time_quality` | `SYNCED`, `RECONSTRUCTED`, atau `UNKNOWN`; menentukan kelayakan latest/history chamber |
| Koneksi | Keadaan online/offline/unknown dari status/LWT MQTT |
| Freshness | Umur `measured_at` terbaru yang diketahui dan valid; `UNKNOWN` bila waktu ukur tidak diketahui |
| Duplikat identik | `(device_id,message_id)` sudah committed dan hash payload canonical sama |
| Konflik ID | `(device_id,message_id)` sama tetapi hash payload canonical berbeda |

## 3. Asumsi terkontrol

- A-01: satu perangkat hanya memiliki satu penempatan aktif pada satu waktu.
- A-02: satu paket memuat kelima parameter dari satu siklus; nilai gagal adalah `null` dengan quality, tidak pernah diganti nol.
- A-03: nilai MQ-137, MQ-136, dan MQ-4 tetap raw sampai proses kalibrasi disepakati.
- A-04: satu chamber memiliki maksimal satu perangkat aktif pada tahap awal. Ini perlu konfirmasi; model dan API tetap dapat menampung lebih dari satu.
- A-05: interval 5 detik adalah baseline **usulan**, bukan SLA.
- A-06: toleransi jam, batas sensor, threshold stale/offline, rentang API, dan retensi di bawah adalah **usulan/TBD** sampai diuji dengan perangkat dan kapasitas VPS.
- A-07: **usulan baseline**, bukan keputusan pengguna: akun lokal dengan session opaque dan dua hak kasar `viewer`/`admin`. Provider OIDC eksternal tetap alternatif terbuka.
- A-08: `received_at` tidak pernah dipromosikan menjadi waktu pengukuran tepercaya. Reading tanpa waktu yang dapat dibuktikan tetap device-scoped dan belum dipetakan ke chamber.

## 4. Kebutuhan fungsional

### KF-ADM-001 — Pendataan chamber

- **Prioritas:** Must.
- **Deskripsi:** admin dapat membuat, melihat, dan menonaktifkan chamber tanpa menghapus riwayat.
- **Prasyarat:** admin terautentikasi.
- **Aturan:** kode chamber unik; nama wajib; chamber yang direferensikan reading tidak boleh hard-delete.
- **Keluaran:** resource chamber dan audit timestamp.
- **Kondisi gagal:** input invalid 422, kode konflik 409, tanpa hak 401/403.
- **Kriteria penerimaan:** pembuatan kode unik berhasil; duplikat ditolak; nonaktif tidak menghapus reading.

### KF-ADM-002 — Registrasi dan penempatan perangkat

- **Prioritas:** Must.
- **Deskripsi:** admin mendaftarkan identitas perangkat dan menempatkannya ke chamber dengan waktu efektif.
- **Prasyarat:** chamber dan perangkat ada; admin terautentikasi.
- **Aturan:** periode satu perangkat tidak boleh overlap; perubahan membuat periode baru, bukan menulis ulang riwayat.
- **Keluaran:** device dan assignment bertimestamp UTC.
- **Kondisi gagal:** perangkat/kamar tidak ada 404; overlap 409; waktu invalid 422.
- **Kriteria penerimaan:** pemindahan menutup assignment lama; paket terlambat hanya dipetakan berdasarkan waktu ukur known ke assignment yang cocok, sedangkan waktu unknown tidak diberi lokasi.

### KF-ING-001 — Menyimpan satu paket valid

- **Prioritas:** Must.
- **Deskripsi:** worker menerima satu paket telemetry valid dan menyimpannya sebagai satu `sensor_reading` atomik.
- **Prasyarat:** perangkat aktif, topic diizinkan, assignment pada waktu ukur ditemukan.
- **Aturan:** lima nilai divalidasi per sensor; `received_at` dibuat server; ACK aplikasi sukses hanya setelah commit.
- **Keluaran:** satu row, pembaruan aktivitas perangkat, ACK `accepted`.
- **Kondisi gagal:** lihat KF-ING-002 dan KNF-REL-001.
- **Kriteria penerimaan:** paket valid menghasilkan tepat satu row dengan device/chamber/timestamp/quality yang benar.

### KF-ING-002 — Validasi dan penolakan permanen

- **Prioritas:** Must.
- **Deskripsi:** worker menolak topic, identitas, schema, tipe, ukuran, timestamp, atau assignment yang tidak valid.
- **Prasyarat:** worker menerima publikasi.
- **Aturan:** error struktur (JSON/schema/identity/tipe/ukuran) menolak seluruh paket; kegagalan akuisisi satu sensor yang dinyatakan secara valid menyimpan sensor tersebut sebagai `null` plus quality tanpa menolak sensor lain; raw ADC bukan ppm.
- **Keluaran:** ACK aplikasi `rejected` dengan kode aman untuk error permanen; log terstruktur tanpa secret.
- **Kondisi gagal:** error internal/DB tidak boleh disalahklasifikasikan permanen.
- **Kriteria penerimaan:** payload struktural invalid dan perangkat tak dikenal tidak membuat row serta memperoleh reason code permanen; paket yang valid secara struktur dengan satu `sensor_error` membuat satu row dengan hanya sensor itu bernilai null.

### KF-ING-003 — Idempotensi

- **Prioritas:** Must.
- **Deskripsi:** retry paket yang sama tidak membuat pengukuran tambahan.
- **Prasyarat:** `device_id` dan `message_id` tersedia.
- **Aturan:** uniqueness database `(device_id, message_id)` adalah pengaman akhir; `message_id` tidak berubah saat retry; SHA-256 atas JSON canonical disimpan. Lookup record committed dilakukan setelah identity/topic minimum tervalidasi tetapi sebelum pemeriksaan status device, assignment, dan umur backlog.
- **Keluaran:** pesan pertama `accepted`; retry dengan hash sama `duplicate`; ID sama dengan hash berbeda `rejected/MESSAGE_ID_CONFLICT`.
- **Kondisi gagal:** race harus berakhir sebagai accepted+duplicate untuk isi identik; konflik isi tidak boleh mendapat ACK duplicate berhasil.
- **Kriteria penerimaan:** tiga publikasi identik menghasilkan satu row; payload berbeda dengan ID sama tidak mengubah row dan ditolak permanen; retry committed tetap mendapat `duplicate` setelah device dipindah atau dinonaktifkan.

### KF-ING-004 — Timestamp, backlog, dan penempatan historis

- **Prioritas:** Must.
- **Deskripsi:** worker membedakan waktu ukur diketahui, direkonstruksi, dan tidak diketahui tanpa memakai receipt time sebagai pengganti diam-diam.
- **Prasyarat:** payload lolos validasi.
- **Aturan:** waktu sinkron memakai timestamp perangkat; rekonstruksi hanya boleh memakai `boot_id`, uptime sampling, dan anchor UTC+uptime dari boot yang sama beserta uncertainty yang diterima; bila bukti tidak cukup maka `measured_at=null`, `measurement_time_quality=UNKNOWN`, dan chamber/assignment null. Reading unknown-time dikecualikan dari latest, freshness, grafik, dan history chamber sampai rekonsiliasi tervalidasi. New message dengan waktu diketahui harus berada dalam batas backlog dan memiliki assignment historis; new message dari device disabled ditolak. Retry committed mengikuti KF-ING-003 sebelum aturan ini.
- **Keluaran:** reading dengan measurement time quality, metadata rekonstruksi, dan assignment snapshot hanya bila dapat dibuktikan; atau reading device-scoped unresolved.
- **Kondisi gagal:** timestamp masa depan, anchor beda boot, uncertainty berlebih, backlog expired, atau assignment historis tidak ditemukan ditolak permanen untuk pesan baru. Waktu tidak diketahui dapat diterima sebagai `accepted_unresolved_time`, bukan diklaim berlokasi.
- **Kriteria penerimaan:** backlog known-time masuk ke lokasi historis benar dan tidak mengganti latest yang lebih baru; backlog tanpa waktu tepercaya tersimpan unresolved dan tidak muncul pada latest/freshness/grafik chamber; retry committed setelah pindah/disable tetap menunjuk row lama.

### KF-LAT-001 — Nilai terbaru

- **Prioritas:** Must.
- **Deskripsi:** operator memperoleh pengukuran terbaru per perangkat pada chamber beserta quality, unit, waktu, koneksi, dan freshness.
- **Prasyarat:** operator terautentikasi.
- **Aturan:** latest hanya memakai reading dengan `measured_at` diketahui dan assignment resolved; tidak ada pembacaan direpresentasikan `null`, bukan nol; status request, koneksi, freshness, dan quality per sensor adalah dimensi berbeda.
- **Keluaran:** JSON typed.
- **Kondisi gagal:** chamber tidak ada 404; database tidak tersedia 503.
- **Kriteria penerimaan:** API dapat merepresentasikan kombinasi online+stale, offline+fresh, dan satu sensor gagal sementara sensor lain valid; unresolved-time count tidak dijadikan latest.

### KF-HIS-001 — Riwayat berhalaman

- **Prioritas:** Must.
- **Deskripsi:** operator membaca pengukuran dalam rentang UTC dengan cursor pagination stabil.
- **Prasyarat:** operator terautentikasi; chamber ada.
- **Aturan:** urutan total `(measured_at DESC, received_at DESC, history_sequence DESC)`; halaman pertama membekukan `snapshot_watermark=max(history_sequence)`; halaman berikut hanya membaca `history_sequence<=watermark`. Cursor opaque+signed mengikat watermark, posisi terakhir, versi urutan, dan hash seluruh filter. Filter device opsional; limit/rentang dibatasi; cursor tidak memakai offset.
- **Keluaran:** readings, `next_cursor`, dan metadata snapshot watermark.
- **Kondisi gagal:** query invalid 400/422; rentang terlalu besar 422.
- **Kriteria penerimaan:** paging tidak menduplikasi/melewatkan row dalam snapshot ketika telemetry live, backlog, atau rekonsiliasi unknown-time masuk di tengah pagination; data baru sengaja baru terlihat pada pagination baru.

### KF-HIS-002 — Seri grafik teragregasi

- **Prioritas:** Must.
- **Deskripsi:** operator mendapat bucket waktu untuk metric yang dipilih.
- **Prasyarat:** operator terautentikasi.
- **Aturan:** bucket tervalidasi/whitelist; jumlah titik maksimal; nilai gagal tidak dihitung sebagai nol; hanya reading known-time+resolved yang diagregasi; UTC menjadi basis bucket.
- **Keluaran:** seri timestamp dan agregat dengan count/quality.
- **Kondisi gagal:** metric/bucket/rentang invalid 422; DB gagal 503.
- **Kriteria penerimaan:** grafik rentang yang sama dapat direkonstruksi sesudah refresh.

### KF-EXP-001 — Ekspor CSV

- **Prioritas:** Must.
- **Deskripsi:** operator mengunduh riwayat raw sesuai chamber, device, dan rentang.
- **Prasyarat:** operator terautentikasi.
- **Aturan:** CSV chamber di-stream dari reading known-time+resolved, header konsisten, UTC ISO-8601, null tetap kosong plus kolom quality dan measurement-time quality, batas row/rentang diterapkan, formula injection dinetralisasi.
- **Keluaran:** `text/csv` dengan filename aman.
- **Kondisi gagal:** query invalid 422; melebihi batas 413/422; DB gagal 503.
- **Kriteria penerimaan:** file dapat dibuka, jumlah row sesuai API, dan nilai gagal tidak menjadi 0.

### KF-STS-001 — Koneksi dan freshness

- **Prioritas:** Must.
- **Deskripsi:** sistem melaporkan connection state dari online/status/LWT dan freshness dari umur pengukuran secara independen.
- **Prasyarat:** status MQTT atau reading pernah diterima.
- **Aturan:** status membawa `boot_id`, `session_id`, sequence koneksi/status, uptime, dan optional trusted event time; heartbeat live memperbarui `last_seen_at`; pemrosesan retained status tidak memperbarui `last_seen_at`. Retained online setelah worker restart hanya snapshot dan menghasilkan `unknown` sampai heartbeat/telemetry live. LWT hanya berlaku untuk session yang cocok dan offline tidak menghapus latest.
- **Keluaran:** `connection.state/evidence/session`, `last_seen_at`, `status_processed_at`, serta `freshness.state/age_seconds` yang terpisah.
- **Kondisi gagal:** status ambigu tetap `unknown`, bukan dipaksa online.
- **Kriteria penerimaan:** online+stale, offline+fresh, dan retained-online-setelah-restart menghasilkan state berbeda; receipt retained tidak memajukan `last_seen_at`.

### KF-UI-001 — State dashboard eksplisit

- **Prioritas:** Must.
- **Deskripsi:** dashboard mengomposisikan request state, connection, freshness, dan quality per sensor; state-state tersebut bukan satu enum yang saling meniadakan.
- **Prasyarat:** kontrak latest/history tersedia.
- **Aturan:** polling latest tunggal; history diambil dari server; kegagalan tidak menghapus data terakhir tetapi memberi indikator stale/error.
- **Keluaran:** state UI yang dapat dibedakan secara visual dan aksesibel.
- **Kondisi gagal:** timeout/API error menampilkan unavailable/retrying dengan data terakhir bertimestamp bila ada.
- **Kriteria penerimaan:** tiap dimensi dapat dipicu fixture/test, termasuk online+stale, offline+fresh, dan satu sensor gagal, tanpa default nol palsu.

### KF-AUT-001 — Akun lokal dan session web (usulan baseline)

- **Prioritas:** Must sebelum production; solusi teknis masih usulan.
- **Deskripsi:** pengguna masuk dengan akun lokal dan menerima session opaque yang dapat dicabut.
- **Prasyarat:** pemilik sistem menyetujui baseline lokal atau menggantinya dengan OIDC sebelum implementasi.
- **Aturan:** tidak ada registrasi publik; password hanya berupa hash kuat dari library terawat; session token acak hanya disimpan hashed, cookie `HttpOnly`/`Secure`; role hanya `VIEWER`/`ADMIN`; login diberi rate limit/lockout; admin awal dibuat lewat prosedur bootstrap terkontrol.
- **Keluaran:** user/session aktif dengan expiry, last-used, dan revocation.
- **Kondisi gagal:** user disabled, session expired/revoked, atau credential salah tidak memperoleh akses.
- **Kriteria penerimaan:** token mentah tidak tersimpan di DB/log; revoke/disable memutus akses; viewer/admin matrix lulus. Jika OIDC dipilih, test ekuivalen wajib dan dependensi IdP/callback/claim mapping didokumentasikan.

### KF-API-001 — Administrasi perangkat

- **Prioritas:** Must.
- **Deskripsi:** admin dapat list/create/update/disable perangkat dan membuat assignment; operator hanya dapat membaca list yang diperlukan dashboard.
- **Prasyarat:** session valid.
- **Aturan:** ID MQTT unik dan immutable setelah provision; disable memblokir ingestion baru tanpa menghapus history.
- **Keluaran:** resource atau status mutasi.
- **Kondisi gagal:** konflik 409; invalid 422; tidak berhak 403.
- **Kriteria penerimaan:** viewer tidak dapat mutasi; pesan baru dari perangkat disabled ditolak worker, sedangkan retry identik atas pesan yang sudah committed tetap mendapat ACK duplicate sesuai KF-ING-003.

## 5. Kebutuhan nonfungsional

### KNF-REL-001 — Database tidak tersedia

- **Prioritas:** Must.
- **Deskripsi:** ingestion dan API gagal secara eksplisit serta dapat pulih ketika PostgreSQL sementara tidak tersedia.
- **Prasyarat:** batas retry, timeout, dan antrean telah dikonfigurasi.
- **Aturan:** worker melakukan retry dengan exponential backoff+jitter; tidak mengirim ACK aplikasi sukses; device mempertahankan antrean lokal; web memberi 503 terstruktur.
- **Keluaran:** tidak ada kehilangan diam-diam atau sukses palsu.
- **Kondisi gagal:** antrean device penuh harus memiliki kebijakan eksplisit dan counter drop.
- **Kriteria penerimaan:** DB dimatikan lalu dipulihkan; paket akhirnya tersimpan sekali.

### KNF-REL-002 — Restart worker/broker

- **Prioritas:** Must.
- **Deskripsi:** ingestion melanjutkan pemrosesan aman setelah worker atau broker restart.
- **Prasyarat:** client ID stabil, persistence broker, dan limit antrean aktif.
- **Aturan:** worker memakai client ID stabil dan persistent session; broker persistence aktif; shutdown berhenti menerima kerja baru dan menunggu transaksi aktif; idempotensi melindungi redelivery.
- **Keluaran:** konsumsi berlanjut setelah restart.
- **Kondisi gagal:** backlog melebihi limit menghasilkan alert/metric, bukan pertumbuhan tanpa batas.
- **Kriteria penerimaan:** restart worker dan broker saat traffic tidak menghasilkan duplicate row atau kehilangan paket yang masih dalam batas antrean.

### KNF-SEC-001 — Keamanan MQTT

- **Prioritas:** Must.
- **Deskripsi:** hanya device dan worker yang terautentikasi dapat menggunakan topic yang diizinkan.
- **Prasyarat:** sertifikat, credential unik, dan mapping identity–device diprovision.
- **Aturan:** listener perangkat memakai TLS, anonymous off, credential unik per perangkat, ACL publish hanya topic miliknya dan subscribe hanya ACK/status terkait; secret tidak berada di firmware repository atau log.
- **Keluaran:** koneksi sah diterima.
- **Kondisi gagal:** publish topic perangkat lain ditolak broker.
- **Kriteria penerimaan:** pengujian ACL lintas perangkat gagal sebagaimana diharapkan.

### KNF-SEC-002 — Keamanan HTTP dan data

- **Prioritas:** Must.
- **Deskripsi:** data hanya dibaca pengguna sah dan mutasi hanya dilakukan admin.
- **Prasyarat:** provider/session auth dipilih dan reverse proxy dipercaya dikonfigurasi.
- **Aturan:** semua endpoint domain memerlukan auth; mutasi perlu admin dan perlindungan CSRF; input divalidasi; rate/body/range limit; database tidak dipublish ke internet; credential tidak memakai `NEXT_PUBLIC_*`.
- **Keluaran:** 401/403/422 yang konsisten.
- **Kondisi gagal:** request anonim atau hak kurang ditolak sebelum query/mutasi.
- **Kriteria penerimaan:** suite auth membuktikan read dan mutation matrix.

### KNF-DAT-001 — Waktu dan integritas riwayat

- **Prioritas:** Must.
- **Deskripsi:** histori dapat dilacak konsisten lintas zona waktu dan tidak rusak oleh mutasi master data.
- **Prasyarat:** server/device memakai kebijakan sinkronisasi waktu dan backup target tersedia.
- **Aturan:** semua epoch time database `timestamptz` UTC; unknown measurement time tetap null dan tidak diganti receipt time; assignment/reading tidak hard-delete; perubahan administrasi bertimestamp; backup dipulihkan dalam uji berkala.
- **Keluaran:** histori dapat ditelusuri.
- **Kondisi gagal:** overlap assignment dan delete referenced record ditolak.
- **Kriteria penerimaan:** restore ke lingkungan uji menghasilkan count dan constraint yang sesuai.

### KNF-OBS-001 — Observability minimum

- **Prioritas:** Should.
- **Deskripsi:** kondisi ingestion, API, broker, database, dan backup dapat didiagnosis tanpa membuka secret.
- **Prasyarat:** format log/metric dan retention operasional ditetapkan.
- **Aturan:** logger terpusat mengeluarkan JSON terstruktur dengan `service`, `operation`, `outcome`, `reason_code`, `duration_ms`, serta `request_id` untuk HTTP atau `device_id`+`message_id` untuk telemetry bila relevan. `DEBUG` untuk diagnosis per pesan dan nonaktif default di produksi; `INFO` untuk lifecycle, perubahan status penting, dan ringkasan berkala; `WARN` untuk kondisi tidak normal yang tertangani; `ERROR` untuk kegagalan operasi yang perlu diperiksa. Keberhasilan tiap paket memakai counter/latency metric, bukan INFO per langkah; retry duplicate normal tidak otomatis WARN. Error lengkap dicatat sekali di batas penanganan dan outage identik dibatasi/ringkas. Metric mencakup accepted, unresolved-time, duplicate, ID conflict, rejected per reason, DB errors, reconnect, retained replay, queue pressure, dan latency. Liveness hanya menilai proses/event loop dan tetap sehat saat dependency sementara gagal; readiness gagal bila dependency wajib atau subscription belum siap.
- **Keluaran:** operator dapat membedakan invalid data dari outage.
- **Kondisi gagal:** liveness gagal hanya bila proses tidak mampu berjalan; readiness tidak boleh hijau bila dependency kritis gagal.
- **Kriteria penerimaan:** startup/shutdown, putus/pulih MQTT, telemetry rejected, konflik ID, kegagalan DB/API/CSV, dan mutasi admin penting tercatat pada level tepat dengan korelasi yang sama sepanjang satu operasi. Fault injection DB/broker tidak membanjiri log; liveness tetap 200 selama proses sehat dan readiness berubah 503 lalu pulih.

### KNF-LOG-001 — Perlindungan dan pengelolaan log

- **Prioritas:** Must.
- **Deskripsi:** log mendukung diagnosis tanpa membuka kredensial atau menumbuhkan penyimpanan tanpa batas.
- **Prasyarat:** logger dan konfigurasi retensi/rotasi tersedia.
- **Aturan:** jangan catat password, token, cookie, `DATABASE_URL`, kredensial MQTT, atau payload sensor lengkap secara default. Field dari input eksternal divalidasi dan dibatasi panjangnya sebelum dicatat; detail DEBUG tetap melalui redaksi yang sama. Log container dirotasi dan diberi retensi terukur.
- **Keluaran:** event yang aman dan dapat dicari memakai ID korelasi.
- **Kondisi gagal:** serialisasi objek error/header mentah yang memuat secret atau log identik tanpa batas dilarang.
- **Kriteria penerimaan:** pengujian dengan nilai canary pada secret, header, dan payload membuktikan nilainya tidak muncul di log; panjang field dan volume saat outage tetap di bawah batas yang ditetapkan.

### KNF-KOD-001 — Kualitas fungsi dan aturan domain

- **Prioritas:** Must.
- **Deskripsi:** fungsi implementasi memiliki satu tanggung jawab yang dapat dijelaskan serta input/output yang jelas.
- **Prasyarat:** kontrak validasi, normalisasi, deduplikasi, timestamp, dan error tersedia.
- **Aturan:** aturan domain yang sama didefinisikan sekali dan dipakai oleh jalur yang memerlukannya; tanggung jawab berbeda tetap terpisah. Hindari kode mati, import/dependency/helper tanpa pemakai, wrapper tanpa manfaat, abstraksi hipotetis, dan fungsi besar yang menyembunyikan banyak tahap.
- **Keluaran:** modul kecil yang mengikuti batas tanggung jawab pada rancangan teknis.
- **Kondisi gagal:** dua jalur memberi hasil berbeda untuk input domain yang sama atau helper ditambahkan tanpa pemakai.
- **Kriteria penerimaan:** review kode menelusuri setiap fungsi/aturan ke pemakai dan kebutuhan; fixture yang sama menghasilkan keputusan domain yang konsisten pada worker dan API.

### KNF-EFI-001 — Efisiensi terukur tanpa mengubah integritas

- **Prioritas:** Must untuk guardrail; target latency tetap usulan/TBD pada KNF-PER-001.
- **Deskripsi:** jumlah I/O, concurrency, antrean, dan polling dibatasi sesuai pola kerja nyata.
- **Prasyarat:** pola query, urutan ACK, dan beban pilot dapat diukur.
- **Aturan:** tidak ada koneksi Prisma per request/pesan, N+1, query ulang tanpa kebutuhan, atau polling ganda. Terapkan indeks sesuai filter dan total order; batasi payload, rentang/row, concurrency dan queue. Batching hanya setelah urutan, transaksi, deduplikasi, dan ACK setelah commit terbukti tetap benar. Algoritma yang kompleks harus menjelaskan kebutuhan, manfaat, dan batas; klaim percepatan membutuhkan perbandingan pengukuran relevan.
- **Keluaran:** query plan, batas konfigurasi, dan laporan pengukuran bila ada optimasi.
- **Kondisi gagal:** optimasi menghasilkan ACK sebelum commit, mengubah latest/backlog, atau melanggar pagination snapshot.
- **Kriteria penerimaan:** uji integrasi memastikan invariants tetap benar; profil query/load menunjukkan tidak ada N+1 atau poll ganda; setiap klaim performa menyertakan beban, lingkungan, dan sebelum/sesudah.

### KNF-PER-001 — Target performa awal (usulan/TBD)

- **Prioritas:** Should.
- **Deskripsi:** sistem memiliki guardrail performa awal yang kemudian dikalibrasi pada beban dan VPS nyata.
- **Prasyarat:** jumlah perangkat, spesifikasi VPS, dan pola query dikonfirmasi.
- **Usulan:** payload ≤4 KiB; interval nominal 5 detik; latest p95 ≤500 ms; history/series p95 ≤2 s untuk rentang yang diizinkan; maksimum 1.000 titik grafik; maksimal 500 row per page.
- **Aturan:** target tetap berstatus TBD sampai hasil load test disetujui; limit server tidak dapat dinaikkan oleh client.
- **Keluaran:** hasil load test dengan latency, throughput, error, dan penggunaan resource.
- **Kondisi gagal:** API membatasi kerja dengan 413/422/429, bukan menghabiskan resource.
- **Kriteria penerimaan:** load test pada hardware target memenuhi angka yang telah dikonfirmasi. Angka ini belum merupakan SLA.

## 6. Matriks kebutuhan ke komponen dan pengujian

| Kebutuhan | Komponen utama | Skenario uji |
|---|---|---|
| KF-ADM-001 | Next.js API, Prisma, PostgreSQL | T-ADM-01 create/duplicate/disable chamber |
| KF-ADM-002 | Admin API, Prisma | T-ADM-02 pindah chamber dan larang overlap |
| KF-ING-001 | Firmware, broker, worker, DB | T-ING-01 satu paket valid tersimpan |
| KF-ING-002 | Broker ACL, validator worker | T-ING-02 error struktur ditolak; T-ING-03 satu sensor gagal disimpan; T-ING-04 perangkat tak dikenal |
| KF-ING-003 | Worker, hash+unique constraint | T-ING-05 tiga pesan identik; T-ING-07 ID sama isi berbeda; T-ING-08 retry setelah pindah; T-ING-09 retry committed setelah disable |
| KF-ING-004 | Worker, anchor waktu, assignment, query latest | T-ING-06 backlog known-time; T-ING-10 backlog tanpa waktu tepercaya |
| KF-LAT-001 | API, Prisma, dashboard | T-API-01 latest typed/no-data/error |
| KF-HIS-001 | API, DB index, dashboard | T-HIS-01 snapshot pagination; T-HIS-02 refresh; T-HIS-04 backlog masuk di tengah pagination |
| KF-HIS-002 | API agregasi, chart | T-HIS-03 bucket dan null handling |
| KF-EXP-001 | API streaming | T-EXP-01 CSV range/quality/formula safety |
| KF-STS-001 | Firmware status, broker LWT, worker, UI | T-STS-01 matriks connection × freshness; T-STS-02 retained online setelah restart |
| KF-UI-001 | Dashboard | T-UI-01 kombinasi request × connection × freshness × per-sensor quality |
| KF-API-001 | API admin, worker | T-SEC-01 viewer dilarang mutasi; T-SEC-02 device disabled ditolak |
| KF-AUT-001 | Auth service, User, AuthSession | T-AUT-01 login/revoke/expiry/disable; T-AUT-02 token tidak tersimpan mentah |
| KNF-REL-001 | Device queue, worker, DB | T-REL-01 database mati lalu pulih |
| KNF-REL-002 | Broker persistence, worker | T-REL-02 worker restart; T-REL-03 broker restart |
| KNF-SEC-001 | Mosquitto TLS/ACL | T-SEC-03 akses topic perangkat lain ditolak |
| KNF-SEC-002 | Reverse proxy/auth/API | T-SEC-04 anonymous/CSRF/rate/body limits |
| KNF-DAT-001 | PostgreSQL, backup | T-DAT-01 constraint waktu; T-DAT-02 restore drill |
| KNF-OBS-001 | Semua proses | T-OBS-01 fault terlihat tanpa secret |
| KNF-LOG-001 | Logger, runtime, Compose | T-LOG-01 redaksi/field limit; T-LOG-02 rotasi dan outage rate limit |
| KNF-KOD-001 | Shared domain, worker, API | T-KOD-01 review pemakai dan konsistensi fixture lintas jalur |
| KNF-EFI-001 | DB, worker, API, dashboard | T-EFI-01 query/pool/poll review; T-EFI-02 batching menjaga commit dan ACK |
| KNF-PER-001 | End-to-end | T-PER-01 load test setelah target dikonfirmasi |

Skenario minimum awal dan tambahan review tercakup oleh T-ING-01 sampai T-ING-10, T-STS-02, T-HIS-02/T-HIS-04, T-REL-01/02, dan T-SEC-03.
