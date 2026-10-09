-- #7: suhu transport dihapus; suhu cukup dicatat di pengadaan (awal)
-- dan kelompok (akhir).
ALTER TABLE "collection_batches" DROP COLUMN "temp_start_c";
ALTER TABLE "collection_batches" DROP COLUMN "temp_end_c";

-- #9: berat lab dipecah menjadi sebelum dan sesudah observasi.
-- Nilai lama = berat saat tiba di lab = sebelum observasi (jujur);
-- sesudah observasi belum pernah diukur pra-revisi → NULL.
-- "sebelum" NOT NULL (semua baris lama punya nilai valid),
-- "sesudah" nullable (tulisan baru tetap wajib lewat validasi aplikasi).
ALTER TABLE "sample_groups" ADD COLUMN "lab_weight_before_g" DECIMAL(8, 2);
ALTER TABLE "sample_groups" ADD COLUMN "lab_weight_after_g" DECIMAL(8, 2);
UPDATE "sample_groups" SET "lab_weight_before_g" = "lab_weight_g";
ALTER TABLE "sample_groups" ALTER COLUMN "lab_weight_before_g" SET NOT NULL;
ALTER TABLE "sample_groups" DROP CONSTRAINT "sample_groups_weights_positive";
ALTER TABLE "sample_groups" DROP COLUMN "lab_weight_g";
ALTER TABLE "sample_groups"
  ADD CONSTRAINT "sample_groups_weights_positive"
  CHECK ("lab_weight_before_g" > 0 AND "lab_weight_after_g" > 0 AND "sample_weight_g" > 0);
