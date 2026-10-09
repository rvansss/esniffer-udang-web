-- Kolom panjang udang (sentimeter, desimal) di batch dan kelompok,
-- diukur dari bekas potongan kepala sampai ujung ekor (telson).
--
-- Kolom sengaja NULLABLE: baris pra-revisi tidak punya data panjang dan
-- tidak ada sumber jujur untuk backfill (lihat D-01b). Tulisan baru tetap
-- wajib lewat validasi aplikasi. Tanpa default agar NULL selalu berarti
-- "tidak diukur", bukan angka karangan.
ALTER TABLE "collection_batches"
  ADD COLUMN "shrimp_length_cm" DECIMAL(5, 2);
ALTER TABLE "sample_groups"
  ADD COLUMN "shrimp_length_cm" DECIMAL(5, 2);
