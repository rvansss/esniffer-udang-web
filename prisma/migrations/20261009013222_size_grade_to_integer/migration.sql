-- Kolom ukuran beralih dari kategori teks ke integer (ekor per kg,
-- sesuai masukan dosen akademik pada review fitur pencatatan).
--
-- Baris lama di-backfill jujur dari data yang sudah tercatat, tanpa
-- mengarang angka: ekor × 1000 / berat gram (mis. 12 ekor / 480 g → 25/kg).
-- NULLIF menjaga pembagi nol; bila ada baris yang beratnya nol, migrasi
-- gagal keras di sini dan harus ditangani manual, bukan diam-diam menjadi NULL.
ALTER TABLE "collection_batches"
  ALTER COLUMN "size_grade" TYPE INTEGER
  USING (ROUND("shrimp_count" * 1000.0 / NULLIF("total_weight_g", 0)))::INTEGER;
