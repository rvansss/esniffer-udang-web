-- Revisi validasi input pengukuran: rentang domain yang memblokir simpan
-- dihapus. Penyimpangan dari acuan protokol (suhu cool box 0–4 °C, jumlah
-- udang 1–10 ekor) kini hanya peringatan di UI, sehingga angka lapangan tetap
-- bisa tercatat.
--
-- Yang tetap dijaga DB hanyalah nilai yang tak bermakna secara fisik
-- (jumlah udang tidak mungkin 0 atau negatif) dan lebar kolom masing-masing:
-- suhu/panjang memakai DECIMAL(5,2) sehingga kapasitasnya otomatis terbatas.

-- Jumlah udang per batch: minimum 10 ekor bukan lagi aturan domain.
ALTER TABLE "collection_batches" DROP CONSTRAINT "collection_batches_shrimp_count_min";
ALTER TABLE "collection_batches"
  ADD CONSTRAINT "collection_batches_shrimp_count_positive"
  CHECK ("shrimp_count" >= 1);

-- Suhu cool box (berangkat, pasar, lab): batas -10..10 °C dihapus. Acuan
-- 0–4 °C hanya peringatan di UI; kolom DECIMAL(5,2) yang membatasi kapasitas.
ALTER TABLE "collection_batches" DROP CONSTRAINT "collection_batches_cooler_range";

-- Jumlah udang per sesi grup: domain 3–5 ekor dihapus (dulu juga dijaga di API).
ALTER TABLE "sample_groups" DROP CONSTRAINT "sample_groups_shrimp_count_range";
ALTER TABLE "sample_groups"
  ADD CONSTRAINT "sample_groups_shrimp_count_positive"
  CHECK ("sample_shrimp_count" >= 1);

-- Suhu udang per tahap observasi bebas rentang (-2..30 °C dihapus); batas
-- berat total udang sesi tetap dipertahankan karena bukan bagian revisi ini.
ALTER TABLE "measurement_sessions" DROP CONSTRAINT "measurement_sessions_shrimp_range";
ALTER TABLE "measurement_sessions"
  ADD CONSTRAINT "measurement_sessions_shrimp_weight_range"
  CHECK ("shrimp_weight_g" > 0 AND "shrimp_weight_g" <= 2000);
