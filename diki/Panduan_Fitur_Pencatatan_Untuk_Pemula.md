# Panduan Fitur Pencatatan Dataset — Bahasa Awam

Dokumen ini menjelaskan fitur pencatatan dari nol untuk orang yang
belum pernah melihat proyek ini. Istilah teknis selalu disertai arti
sederhananya saat pertama muncul.

---

## 1. Fitur ini untuk apa?

Peneliti udang mencatat perjalanan sampel di kertas/catatan terpisah,
sementara data sensor tersimpan di sistem lain — keduanya sulit
disambungkan. Fitur pencatatan menyatukan keduanya: **satu halaman web
untuk mencatat semua kegiatan, yang otomatis tersambung ke data sensor.**

Hasil akhirnya dua hal:
- **Data tampil di halaman web** — semua isian form Anda terbaca di
  section **Data Pencatatan** halaman detail, tanpa perlu mengunduh apa pun.
- **Dua file opsional untuk diunduh** — **Metadata** (ringkasan kegiatan:
  belanja di mana, berat berapa, suhu berapa, kapan diukur) dan
  **CSV Data** (angka-angka sensor per detik, siap diolah untuk penelitian).

---

## 2. Kata-kata yang akan sering ditemui

| Istilah di layar | Artinya |
|---|---|
| Batch | Satu kali belanja udang di pasar. Kode otomatis, contoh `BT-20261005-01`. |
| Grup SR / SD | Udang dibagi dua: SR = disimpan suhu ruang, SD = disimpan dingin (kulkas). |
| Timepoint | Jam pengukuran ke berapa. `H0` = jam ke-0 (awal), `H6` = jam ke-6, `D1` = hari ke-1. |
| Sesi | Satu kali proses ukur (±15 menit) pada satu timepoint. Punya status: `open` (sedang berjalan), `complete` (selesai + data tertaut), `incomplete` (selesai tapi tak ada data masuk). |
| Baseline | Pembacaan sensor saat chamber masih kosong (tanpa udang), untuk pembanding. |
| Warmup | Pemanasan sensor 30 menit sebelum mengukur agar hasilnya stabil. |
| Cleaning | Membersihkan chamber dengan alkohol 70% setelah mengukur. |
| Lock (kunci) | Menandai batch selesai. Setelah dikunci, data tidak bisa diubah lagi. |
| Caption | Keterangan singkat tiap foto (mis. "di pasar", "sebelum chamber"); wajib diisi. |
| Deviasi | Pengakuan bahwa cold-chain sempat jebol (>3 jam); dicentang agar tetap tercatat jujur. |
| Chamber | Wadah/ruang tempat udang diukur sensornya. |

---

## 3. Langkah memakai (urut)

### Langkah 0 — Buka halamannya
Login, klik foto profil kanan atas → muncul menu berisi **Pencatatan**
dan **Keluar** (dipisah garis) → klik Pencatatan. Anda melihat daftar
batch dikelompokkan per pasar beserta tanggal belinya
(mungkin masih kosong — tidak apa-apa).

### Langkah 1 — Buat batch baru (form 3 tahap)
Klik **＋Batch Baru**, isi berurutan (tanda `*` merah = wajib):

1. **Pengadaan**: tanggal dan jam berangkat dari lab + suhu cool box saat
   berangkat, lalu jenis sumber (dropdown Pasar/Supermarket/Tambak) dan
   nama sumber (teks bebas). *Jam berangkat harus 05:00–08:00 WIB; kalau
   diisi jam 10, form menolak dan menjelaskan kenapa.*
2. **Kondisi & Dokumentasi**: tanggal dan jam beli + tanggal dan jam tiba
   di lab (durasi tampil otomatis; >3 jam wajib centang deviasi), kondisi
   awal (Mati/Hidup), jumlah ekor, panjang udang, berat total, suhu awal,
   suhu cool box saat di pasar dan saat di lab, lalu foto kondisi awal
   udang (tiap foto wajib beri caption; boleh tambah bertahap, foto lama
   tidak hilang). *Jam beli dan jam tiba juga wajib 05:00–08:00 WIB dengan
   urutan berangkat < beli < tiba. Tombol **Isi otomatis (data tes)**
   boleh dipakai untuk latihan — periksa dulu angkanya sebelum Simpan.*
3. Klik **Lanjut ke Pengelompokan**, isi kedua kartu — **Suhu Ruang
   (25 ± 2 °C)** dan **Suhu Dingin (4 ± 1 °C)** — (suhu tusuk, temuan
   visual, ekor per sesi, berat sebelum + sesudah observasi). Berat
   sebelum observasi diisi sendiri-sendiri di tiap kartu; angkanya
   sering sama karena ditimbang sekali saat tiba, tapi tidak saling
   menyalin otomatis — periksa sebelum Simpan.

Klik **Simpan batch** → Anda dibawa ke halaman detail batch.

### Langkah 2 — Lengkapi di halaman detail
- **Data Pencatatan** (bagian teratas) — semua isian form Anda tampil
  di layar: pengadaan (beli, tiba, durasi, pasar, berat, suhu, dll.) dan
  pengelompokan per grup (suhu, temuan visual, berat sebelum/sesudah).
  Tanda "—" berarti kolom itu memang tidak diisi. Karena data sudah tampil
  di sini, **mengunduh metadata bersifat opsional** — unduh bila perlu
  mengirim/menganalisis di luar aplikasi.
- **Foto**: bila belum upload di form, tambah di sini (tombol Upload).
  Maksimal 10 foto @5 MB, format JPG/PNG; tiap foto wajib ber-caption,
  caption foto lama bisa dilengkapi lewat tombol OK di tiap foto.
- **Sesi ukur** (di tiap kartu grup, jadwal timepoint tertera di judul
  kartu): pilih **Chamber** dan **Device** dulu (wajib diisi bila ingin
  data sensor tertaut otomatis — kosong berarti sesi tanpa data),
  centang *Warmup 30 mnt* → **Start Sesi**. Checkbox hanya menyalakan
  tombol; status berubah hanya setelah tombol diklik.
- Sesi yang sedang berjalan tampil di bagian **Sesi berjalan**; yang
  sudah selesai masuk **Riwayat** (terlipat).
- Setelah mengukur, centang *Cleaning 70%* → **Complete**:
  - berhasil + ada data → `complete`,
  - selesai tapi tak ada data masuk → `incomplete` (bukan salah Anda
    menekan tombol — artinya sensor memang tidak mengirim; klik
    **Ulangi** pada baris itu untuk mengukur ulang timepoint yang sama).
- Ulangi untuk timepoint berikutnya. Dropdown hanya menawarkan
  timepoint yang belum dipakai (H0, H6, … untuk suhu ruang;
  H0, D1, D2, … untuk dingin).

### Langkah 3 — Kunci dan unduh
- Bila semua sesi selesai dan minimal 1 foto sudah ada, klik
  **Kunci Batch**. Setelah terkunci, tidak ada yang bisa diubah —
  ini segel bahwa dataset sudah final.
- Semua isian form sudah tampil di section **Data Pencatatan**, jadi
  unduhan bersifat opsional. Bila perlu, klik **Unduh Metadata**
  (isian form Anda) dan **Unduh CSV Data** (angka sensor); buka
  keduanya di Excel untuk memeriksa.
- Bedanya: Metadata = cerita sampel (1 baris per sesi, selalu ada);
  CSV Data = angka sensor per detik (hanya ada bila sensor mengirim
  saat sesi). Keduanya tertaut oleh kode batch yang sama.

### Langkah 4 — Menghapus (bila salah buat)
- Hapus hanya lewat **centang di halaman daftar**: tandai 1 atau
  banyak batch → tombol **Hapus (N)** → popup konfirmasi bertema
  (bukan popup browser biasa) → selesai.
- Di halaman detail tidak ada tombol hapus batch; yang ada hanya
  tombol **× di tiap foto** untuk menghapus foto satu per satu
  (dengan konfirmasi juga).
- Aturannya: batch terkunci tak bisa dihapus; batch yang masih punya
  data tertaut menanyakan dulu "hapus dan putuskan tautannya?".
  Data sensornya sendiri tidak hilang — hanya tautannya yang dilepas.

---

## 4. Aturan main yang dijaga sistem untuk Anda

Anda tidak perlu menghafal ini — sistem yang menegakkannya:

- ID batch/grup/sesi dibuat otomatis, tidak perlu diketik (ID sesi kini
  memuat nomor batch sehingga dua batch di hari yang sama tak bertabrakan).
- Timepoint tidak bisa ganda atau mundur (H6 dulu baru H0 ditolak);
  dropdown hanya berisi yang masih bisa dipakai.
- Sesi tidak bisa dimulai tanpa warmup, tidak bisa selesai tanpa cleaning;
  tombolnya abu-abu sampai checkbox dicentang.
- Sesi `incomplete` bisa diulang lewat tombol Ulangi; sesi `complete`
  tidak bisa dibuka lagi.
- Batch tidak bisa dikunci bila sesi belum selesai atau belum ada foto.
- Setelah dikunci, semua tombol ubah hilang.

---

## 5. Kalau ada yang aneh

| Gejala | Artinya | Yang dilakukan |
|---|---|---|
| Tombol Lanjut tidak jalan + tulisan merah | Ada isian belum benar | Baca tulisan merahnya, betulkan field itu |
| Kolom timepoint/jam kosong di CSV metadata | Grup itu belum punya sesi (`no_session`) | Buat sesi di halaman detail, unduh ulang |
| CSV data hanya header | Belum ada data sensor masuk saat sesi | Pastikan Mosquitto + worker jalan saat mengukur |
| Tombol Start/Complete abu-abu | Checkbox warmup/cleaning belum dicentang | Centang dulu, tombol menyala sendiri (centang saja tanpa klik tombol tidak mengubah apa-apa) |
| Status sesi `incomplete` | Sesi selesai tapi tak ada data sensor masuk di waktunya | Klik **Ulangi** di baris itu, pastikan Mosquitto + worker jalan saat mengukur |
| Login gagal terus padahal password benar | Kemungkinan: salah ketik/CapsLock; akun terkunci 15 menit setelah 5x salah (pesannya tetap generik); password admin di database tertimpa oleh test; atau Anda membuka server/salinan yang salah | Coba maksimal 4x, pastikan URL-nya `localhost:3000` dari folder proyek ini; kalau terkunci tunggu 15 menit; kalau baru menjalankan test, minta teknisi mereset password admin, jangan ditebak terus |
| `Gagal memuat (500)` atau simpan batch 500 generik setelah migrasi database | Dev server masih memegang Prisma client lama di memori | Tutup `npm run dev` (Ctrl+C), jalankan ulang, tunggu `✓ Ready`, coba lagi |
| Muncul chamber asing di menu (mis. "DBG ...") | Sisa data uji/debug yang tertinggal di database | Abaikan/hapus bila Anda yang buat via test; chamber asli hanya CH-01 dan CH-02 |
| Worker diam tanpa log setelah warning | Broker Mosquitto belum jalan atau port dipakai service lain | Nyalakan broker manual dulu, pastikan berakhir `running`, baru start worker |
| Halaman form berantakan | Cache browser lama | Buka jendela incognito baru |

---

## 6. Contoh alur lengkap (bayangan)

> Senin pagi Anda beli 12 ekor (485 gram) di Pasar Ciroyom jam 07:00,
> sampai lab jam 08:45 (1 jam 45 menit — aman).
> Di form: tahap Pengadaan terisi (termasuk tiba + cool box), tahap Pengelompokan membagi
> dua grup. Sore harinya Anda ukur H0 (ruang + dingin), besok pagi H6,
> dan seterusnya sampai busuk. Setelah semua selesai + foto lengkap,
> batch dikunci. Selama proses, Anda bisa kapan saja memeriksa ulang
> semua isian lewat section Data Pencatatan di halaman detail; peneliti
> menerima dua file: metadata (cerita sampel)
> dan CSV data (angka sensor) — keduanya tertaut oleh kode batch yang sama.

---

## 7. Kenapa tiap kolom ada (alasan per field)

**Pengadaan** — mencatat asal-usul sampel sebelum diapa-apakan:
- *Tanggal dan jam berangkat* — titik tolak perjalanan ke pasar; wajib
  05:00–08:00 WIB dan sebelum jam beli. Dicatat agar durasi di luar pasar
  (perjalanan pergi) tidak hilang.
- *Suhu cool box saat berangkat* — kondisi awal rantai dingin sebelum es
  mulai bekerja; menerima −10 sampai 10 °C.
- *Tanggal dan jam beli* — titik nol umur sampel; wajib 05:00–08:00 WIB
  karena protokol menyeragamkan kesegaran awal (belanja siang = sampel
  lebih tua = data tak sebanding).
- *Sumber* — nama lokasi, teks bebas karena daftar pasar bisa berubah.
- *Jenis sumber* — dropdown Pasar/Supermarket/Tambak; tiga kemungkinan
  yang diakui protokol, dengan Pasar sebagai default.
- *Jumlah ekor* — memastikan stok cukup untuk 2 grup + cadangan;
  minimal 10.
- *Ukuran (ekor/kg)* — terhitung otomatis dari ekor ÷ berat × 1000,
  tidak diisi di form; laju busuk tergantung ukuran agar perbandingan
  antar batch adil.
- *Panjang udang (cm)* — diukur dari bekas potongan kepala sampai ujung
  ekor (telson); desimal boleh (mis. 12,5).
- *Berat total* — angka dasar normalisasi (emisi gas per gram);
  wajib timbang digital, bukan kira-kira.
- *Suhu awal udang* — suhu tubuh sampel sebelum masuk cold-chain;
  termometer tusuk, bukan suhu udara; menerima −10 sampai 10 °C.
- *Kondisi awal* — hanya dua pilihan: Mati atau Hidup.
- *Foto kondisi awal udang* — bukti visual + bahan pelabelan di masa
  depan; tiap foto wajib ber-caption (mis. di pasar, sebelum chamber)
  agar keadaannya jelas.

**Tiba & cool box** — membuktikan cold-chain tidak putus:
- *Tanggal dan jam tiba* — durasi beli–tiba harus ≤3 jam; lebih dari itu wajib
  diakui sebagai deviasi (jujur tercatat, bukan ditolak diam-diam).
  Urutannya: berangkat dari lab → beli di pasar → tiba kembali ke lab,
  jadi berangkat < beli < tiba, dan ketiganya di jendela 05:00–08:00 WIB.
- *Suhu cool box saat di pasar & saat di lab* — suhu *udara box* di dua
  titik berbeda; protokol menjaga 0–4 °C, tetapi input menerima angka
  desimal apa pun agar kondisi nyata di lapangan tetap tercatat: nilai di
  luar 0–4 °C hanya memunculkan peringatan kuning, bukan galat.

**Pengelompokan (diisi 2x: Suhu Ruang dan Suhu Dingin)** — mencatat perlakuan tiap kelompok:
- *Suhu tusuk saat tiba* — titik nol kurva pembusukan masing-masing grup.
- *Temuan visual* — dropdown tertutup (normal/melanosis/rusak/campur)
  agar kategorinya konsisten untuk analisis; kalau bukan normal,
  tulis detailnya di catatan seleksi + foto ulang.
- *Berat sebelum observasi* — total saat tiba; dibandingkan berat pasar
  untuk deteksi susut (>5% = peringatan). Angkanya sering sama di kedua
  kartu karena ditimbang sekali sebelum dibagi, tapi diisi manual
  per kartu (tanpa penyalinan otomatis) supaya tiap kartu berdiri
  sendiri dan bebas salah salin.
- *Berat sesudah observasi* — total setelah sesi terakhir kartu itu;
  diisi per kartu karena hasilnya bisa beda per perlakuan.
- *Ekor per sesi* — hitungan (bukan timbangan), 3–5 ekor per sesi ukur
  agar massa emisi konsisten (diisi paling dulu di tiap kartu).

### Verdict: tepat, tidak perlu dikurangi

- **Tidak ada yang perlu dibuang** — tiap kolom dipakai: pengadaan →
  identitas + normalisasi, tiba + cool box → bukti cold-chain, pengelompokan →
  kontrol eksperimen. Menghapus satu saja menghilangkan jawaban atas
  pertanyaan peneliti ("berapa gram?", "suhu berapa?", "kapan?").
- **Duplikasi semu bukan duplikasi nyata** — Berat sebelum/sesudah muncul
  di CSV per baris grup (tiap baris mandiri); keduanya momen timbang
  berbeda (tiba vs sesudah observasi), bukan pengulangan.
- **Catatan sejarah** — usulan agar berat sebelum observasi otomatis
  menyalin antarkartu sempat dipakai, lalu dihapus atas revisi pembimbing:
  tiap kartu kini diisi manual agar tiap angka benar-benar berasal dari
  timbangan kartu itu (lebih jujur secara data, sedikit lebih banyak ketik).

---

## 8. Membaca tiga file unduhan (kamus kolom + alur data)

### 8.1 Alur lengkap: dari alat sampai file, dalam 6 langkah

1. **Alat mengirim** — tiap 5 detik, alat (mis. `esp32-001`) mengirim
   satu pesan JSON lewat MQTT ke topik
   `esniffer/v1/devices/esp32-001/telemetry`. Isinya: ID pesan unik
   (`message_id`, bentuk `boot_id:nomor_urut`), waktu ukur (`measured_at`,
   jam di alat, UTC), dan 5 angka sensor (suhu, kelembaban, MQ-137,
   MQ-136, MQ-4) masing-masing dengan nilai + status kualitas.
2. **Worker mencatat** — program worker yang siaga 24 jam menerima pesan,
   memeriksa keaslian dan kelengkapannya (ID alat cocok, format benar,
   waktu masuk akal, alat terdaftar dan dipasangkan ke chamber), lalu
   menyimpannya sebagai satu baris di tabel `sensor_readings` database.
   Pesan yang gagal pemeriksaan ditolak dan dihitung di endpoint
   kesehatan ingest (bukan hilang diam-diam).
3. **Waktu diterima dicatat** — saat baris tersimpan, database menulis
   `received_at` (jam server). Selisih `received_at` − `measured_at`
   (biasanya di bawah 1 detik, contoh riil 0,754 detik) adalah jeda
   jaringan + pemrosesan.
4. **Penautan sesi** — saat Anda menekan Complete pada suatu sesi,
   sistem mengaitkan baris-baris sensor yang waktunya jatuh di jendela
   sesi itu ke `session_id`/`batch_id` (proses backfill). Dua menit
   pertama tiap sesi ditandai `is_baseline` = TRUE: itu rekaman chamber
   masih kosong sebagai pembanding, dan rata-ratanya mengisi kolom
   `baseline_mq137/136/4` di metadata.
5. **Tampilan web** — dashboard, grafik, tabel riwayat, dan SSE membaca
   dari tabel yang sama. Grafik dan tabel riwayat hanya menampilkan
   baris yang waktunya valid (`SYNCED`/`RECONSTRUCTED`) dan bernomor
   urut di bawah watermark (batas urutan; sisanya ikut pemuatan
   berikutnya — lihat badge `Watermark #N` di tabel riwayat).
6. **Unduhan** — ketiga tombol unduh hanya membungkus isi database ke
   format CSV. Maksimal 50.000 baris per unduhan; file selalu diawali
   baris header (nama kolom).

### 8.2 File 1: CSV telemetri chamber (tombol "Unduh CSV" di dashboard)

Satu baris = satu pesan alat (contoh riil: 3 baris, tiap 5 detik).
Urutan kolom dan artinya:

- *chamber_code* (`CH-01`) — ruangan/chamber tempat alat dipasang.
- *device_id* (`esp32-001`) — nama alat pengirim.
- *message_id* (`d3b04033-…:0000000357`) — ID unik pesan;
  bagian sebelum titik dua adalah ID nyala alat (`boot_id`, berganti
  tiap alat restart), sesudahnya nomor urut pesan. Nomor berurutan
  (…357, …358, …359) berarti tidak ada pesan yang hilang di antaranya.
- *measured_at* (`2026-10-14T02:38:50.000Z`) — jam alat mengukur, UTC
  (tambah 7 jam = WIB). Huruf `Z` artinya zona UTC.
- *received_at* (`…02:38:50.754Z`) — jam server menyimpan. Pada contoh,
  jedanya 0,754 detik: normal untuk MQTT jarak jauh + pemrosesan.
- *measurement_time_quality* (`SYNCED`) — `SYNCED` = jam alat tepercaya
  (sudah sinkron NTP); `RECONSTRUCTED` = jam dihitung ulang dari acuan
  (tetap valid); `UNKNOWN` = tanpa jam (tidak ikut file ini maupun grafik).
- Tiap sensor memakai 3 kolom: nilai, satuan, kualitas.
  *temperature_c_value* (`27.4`), *temperature_c_unit* (`°C`),
  *temperature_c_quality* (`OK`); *humidity_percent_value* (`48.4`),
  *humidity_percent_unit* (`%RH`), *humidity_percent_quality* (`OK`);
  *mq137_raw_value* (`236`), *mq136_raw_value* (`2465`),
  *mq4_raw_value* (`410`), satuannya `raw` (angka mentah ADC 0–4095,
  bukan ppm — kalibrasi ppm hanya tampil di layar alat Nextion).
  Kualitas `OK` = angka valid; selain itu (`SENSOR_ERROR`,
  `OUT_OF_RANGE`, `MISSING`) nilainya kosong dan kualitasnya menjelaskan
  kenapa.
- *ingestion_source* (`MQTT`) — jalur masuk data (`MQTT` = dari alat
  live; `PROMETHEUS_IMPORT` = dari impor lama).

### 8.3 File 2: CSV data batch (tombol "Unduh CSV Data" di detail batch)

Satu baris = satu pesan alat yang sudah tertaut ke sesi batch ini
(contoh riil: 3 baris sesi H0). Urutan kolom dan artinya:

- *timestamp_utc* — sama dengan `measured_at`: jam ukur, UTC.
- *session_id* (`SES-20261…`) — sesi yang mengklaim baris ini
  (ditulis saat Complete, lihat langkah 4 di 8.1).
- *batch_id* (`BT-202610…`) — kode belanja; pengait antar file.
- *source_type* (`market`) — asal udang (`market`/`farm`).
- *storage_condition* (`room_temp`) — perlakuan grup
  (`room_temp` = suhu ruang, `cold` = dingin).
- *timepoint_code* (`H0`) — jam pengukuran ke berapa.
- *elapsed_hours* (`0`) — umur sampel dalam jam pada timepoint itu.
- *mq137_raw* (`269`), *mq136_raw* (`2548`), *mq4_raw* (`451`),
  *temp_chamber_c* (`25.9`), *rh_chamber_pct* (`51.4`) — angka sensor
  (sel kosong = sensor gagal pada pesan itu, lihat kualitas di file 1).
- *is_baseline* (`TRUE`/`FALSE`) — `TRUE` = direkam dalam 2 menit
  pertama sesi saat chamber masih kosong (pembanding); `FALSE` = udang
  sudah di dalam. Pada contoh: 2 baris pertama TRUE, baris ketiga FALSE,
  artinya operator memasukkan udang sekitar 10 detik setelah sesi jalan.

### 8.4 File 3: metadata batch (tombol "Unduh Metadata" di detail batch)

Satu baris = satu sesi (atau satu grup bila grup itu belum punya sesi;
kolom sesinya lalu kosong dengan penanda `no_session`). Selalu ada
isinya walau sensor belum mengirim apa pun, karena berasal dari
formulir Anda + hasil backfill. Kolom berurutan:

- Blok batch (isian Pengadaan): *batch_id*, *departed_date* +
  *departed_time_wib* (jam berangkat, dipecah tanggal & jam WIB),
  *procured_date* + *procured_time_wib* (jam beli, WIB), *market_source*,
  *source_type*, *shrimp_count* (`12`), *size_grade* (`25`, ekor/kg,
  terhitung otomatis), *shrimp_length_cm* (`12.5`), *total_weight_g*
  (`480`), *initial_condition* (`dead`), *initial_temp_c* (`2.5`),
  *arrived_date* + *arrived_time_wib* (jam tiba, WIB),
  *cooler_temp_departure_c* (`1.0`), *cooler_temp_market_c* (`1.2`),
  *cooler_temp_lab_c* (`3.6`), *ice_to_shrimp_ratio* (`2:1`),
  *rejection_notes* (kosong = tidak ada penolakan), *photo_count* (`2`),
  *locked_at* (kosong = batch masih terbuka). Batch lama yang dibuat sebelum
  kolom keberangkatan ada akan mengosongkan sel *departed* dan
  *cooler_temp_departure_c* — bukan nilai karangan.
- Blok grup (isian Pengelompokan): *group_id*, *storage_condition*,
  *target_temp_c*, *lab_temp_c* (`6.4`), *visual_check* (`normal`),
  *lab_weight_before_g* (`472`), *lab_weight_after_g* (`469.2`),
  *sample_shrimp_count* (`4`).
- Blok sesi: *session_id*, *timepoint_code* (`H0`, `D1`),
  *elapsed_hours* (`0`, `24`), *started_at_utc*, *ended_at_utc*,
  *session_status* (`complete`), *warmup_done*/*cleaning_done* (`TRUE`
  berarti checkbox dicentang saat aksi), *baseline_mq137* (`247.542`),
  *baseline_mq136* (`2484.417`), *baseline_mq4* (`421.875`) — rata-rata
  2 menit baseline sesi itu (lihat 8.1 langkah 4). Pada contoh, baris H0
  belum punya baseline (sesi baru berjalan) sedangkan baris D1 sudah.

### 8.5 Dua keanehan tampilan Excel (satu sudah diperbaiki kode)

- `27.4 Â°C` — file CSV lama berkode UTF-8 murni (simbol `°` dua byte)
  dibuka Excel sebagai ANSI sehingga `°` tampil sebagai `Â°`. Datanya
  selalu benar; sejak perbaikan ini semua unduhan CSV diawali penanda
  BOM UTF-8 sehingga Excel Windows langsung membacanya benar tanpa
  dialog impor. File lama yang sudah terlanjur diunduh tetap dibuka
  lewat Data → From Text/CSV → encoding UTF-8, atau di Google Sheets.
- `2:01` pada rasio es — isi aslinya teks `2:1`, tapi Excel menebaknya
  sebagai jam (02:01). Datanya benar; ubah format kolom itu ke Text
  atau awali dengan petik saat mengolah.

---

### 8.6 Revisi pembimbing putaran 2 (14 butir) — perubahan UI & CSV yang perlu diketahui

Ringkasan ini agar Anda tidak bingung bila istilah di layar beda dengan catatan/versi lama.

#### 8.6.1 Wizard batch baru: 3 langkah (butir 12)
| Sebelum | Sekarang |
|---|---|
| 2 tahap: Pengadaan → Pengelompokan | 3 tahap: **Pengadaan** → **Kondisi & Dokumentasi** → **Pengelompokan** |
| Semua field logistik + kondisi di 1 tahap | **Pengadaan**: beli/tiba, jenis sumber (Pasar/Tambak/Supermarket), sumber teks |
| — | **Kondisi & Dokumentasi**: kondisi awal, jumlah, ukuran, panjang, berat total, **suhu udang sebelum observasi** (butir 8), **cool box di pasar & di lab** (butir 7), foto dokumentasi + caption |
| — | **Pengelompokan**: bagi SR/SD, pilih **chamber/non-chamber** (butir 1), foto per grup + caption (butir 2) |

#### 8.6.2 Label & istilah yang diganti (butir 5, 6, 7, 8, 11)
| Lama | Baru | Kenapa |
|---|---|---|
| 1 kolom datetime beli/tiba | **Pecah 2 kolom**: tanggal + jam WIB | CSV ML-ready, jam device otomatis (butir 5) |
| Jenis sumber: Pasar/Tambak | **Pasar / Tambak / Supermarket** (butir 6) | Variasi asal lengkap |
| Cool box min/max | **Cool box di pasar** / **Cool box di lab** (butir 7) | 2 titik pengukuran nyata |
| "Suhu dalam udang saat tiba" | **"Suhu udang sebelum observasi"** (butir 8) | Saat masuk chamber, bukan tiba lab |
| "Sumber pasar" | **"Sumber"** (butir 12) | Bukan cuma pasar (ada supermarket) |
| "Suhu Dingin (4 ± 1 °C)" | **"Dingin non-chamber (4 ± 1 °C)"** / **"Dingin, chamber (4 ± 1 °C)"** (butir 1, 11) | Mode penyimpanan terlihat di judul grup |

#### 8.6.3 Fitur baru di halaman detail batch
- **Edit per section** (butir 3): tombol Edit per kartu grup → form modal (suhu, berat sebelum/sesudah, foto). Terditolak bila batch terkunci.
- **Foto per grup** (butir 2): upload di step Pengelompokan + detail, badge SR/SD di daftar foto.
- **Notifikasi lonceng** (butir 9): ikon header + badge unread, dropdown riwayat, modal wajib tutup, audio `Better Call Saul Ringtone.mp3` (toggle). Muncul saat sensor stabil jendela 10 menit.
- **Filter tabel riwayat** (butir 10): input dari/sampai + preset Hari ini / 7 hari / 30 hari / 1 tahun.
- **Judul grafik** (butir 11): "Pergerakan Sensor Gas Aktif".
- **Wizard step nav mobile** (butir 14): sticky bawah, target sentuh ≥44 px, kamera langsung `capture="environment"`.

#### 8.6.4 Header CSV ekspor metadata yang berubah (butir 5, 7)
| Lama | Baru |
|---|---|
| `procured_at_utc` (UTC) | `procured_date`, `procured_time_wib`, `arrived_date`, `arrived_time_wib` |
| `cooler_temp_min_c`, `cooler_temp_max_c` | `cooler_temp_market_c`, `cooler_temp_lab_c` |
| `source_type`: `market`/`farm` | `market`/`farm`/`supermarket` (lowercase) |

> ⚠️ **Template Excel / skrip analisis lama perlu disesuaikan** — header dan urutan kolom berubah. Data lama tetap terbaca (nilai UTC sumber kebenaran), hanya header ekspor yang beda.

#### 8.6.5 Revisi wizard terbaru (keberangkatan & rentang suhu)

| Lama | Baru |
|---|---|
| Jendela waktu 06:00–08:00 WIB | **05:00–08:00 WIB** untuk berangkat, beli, dan tiba |
| Belum ada kolom keberangkatan | `departed_date`, `departed_time_wib`, `cooler_temp_departure_c` (baris lama = sel kosong) |
| Suhu cool box 0–4 °C, suhu awal udang −2…30 °C | Keduanya menerima **desimal bebas rentang** (form & API); acuan 0–4 °C untuk cool box hanya peringatan, CHECK DB rentang dihapus |
| Jumlah udang minimal 10 ekor, per sesi 3–5 ekor | Bilangan bulat **≥ 1 tanpa batas atas**; acuan 1–10 ekor hanya peringatan |
| Panjang udang 1–50 cm | Angka desimal **bebas rentang** |
| "Jenis sumber" berupa radio | **Dropdown** dengan Pasar sebagai pilihan awal |
| Beli & tiba di step 1 | Beli & tiba pindah ke step 2 (Kondisi & Dokumentasi); step 1 berisi keberangkatan + sumber |

#### 8.6.5 Enam cek manual cepat (verifikasi UI)
1. `/batches/new` → jam beli `10:00` → **Lanjut** tertahan + merah "jam beli 06:00–08:00".
2. Jenis sumber pilih **Supermarket** → tersimpan & tampil di daftar batch.
3. Step Pengelompokan → grup dingin → **Langsung di kulkas** → chamber tersembunyi.
4. Detail batch → **Edit** kartu grup → ubah suhu → Simpan → notif sukses pojok kanan bawah.
5. Dashboard → Tabel Riwayat → preset **7 hari** → angka muncul tanpa alat.
6. Sesi + alat → stabil → lonceng bunyi + modal → tutup → badge unread hilang.

---

*Terakhir disinkronkan: 19 Oktober 2026 | Kode: `main` commit `bc73ad6` (merge fase 4)*
