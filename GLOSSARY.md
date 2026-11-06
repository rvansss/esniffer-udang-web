# Pencatatan dataset E-Sniffer Udang

Istilah pengadaan dan pengujian udang untuk pengumpulan dataset.

## Bahasa domain

**Batch**: Sekumpulan udang dari satu kegiatan pembelian, dengan satu jenis udang dan lokasi pembelian yang sama.

**Grup SR/SD**: Pembagian sampel batch berdasarkan penyimpanan suhu ruang (SR) atau suhu dingin (SD). Keduanya diuji menggunakan chamber.

**Tahap pengukuran**: Observasi pada waktu tertentu, misalnya H0 atau H6, yang memiliki pengukuran berat dan suhu udang tersendiri. Suhu diukur per ekor pada sampel grup (acuan 1–10 ekor, di luar itu tetap dicatat dengan peringatan); yang disimpan sebagai suhu tahap adalah rata-ratanya.

**Jumlah udang per sesi**: Banyaknya udang sampel yang diuji pada setiap tahap sebuah grup (acuan 1–10 ekor; nilai lain tetap tersimpan dan hanya diberi peringatan). Ditetapkan sekali saat pengelompokan batch (terpisah untuk SR dan SD) dan dipakai lagi sebagai panjang baris pengukuran suhu tiap tahap.

**Baseline**: Pembacaan udara bersih pada dua menit pertama sesi sebelum pembacaan sampel.

**Caption foto**: Keterangan wajib (maksimal 140 karakter) untuk setiap foto dokumentasi, ditulis dengan format `kegiatan-udang<no>-tahap<no>-sr/sd`, misalnya `suhu-udang1-tahap1-sr`. Kegiatan adalah jenis dokumentasi (mis. `suhu`, `berat`, `visual`), `udang<no>` adalah nomor udang, `tahap<no>` adalah urutan tahap pengukuran, dan akhiran `sr` berarti suhu ruang sedangkan `sd` berarti suhu dingin. Foto tanpa tahap (kondisi awal, pengelompokan) cukup `kegiatan-udang<no>`.

**Lolos kualitas ML**: Data yang memenuhi aturan kelengkapan, konsistensi, waktu, dan kualitas sensor untuk ekspor dataset. Status ini tidak menyatakan tingkat kesegaran udang.
