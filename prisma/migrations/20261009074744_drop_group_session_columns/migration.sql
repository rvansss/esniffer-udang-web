-- Berat sesi dan panjang grup dihapus dari step Pengelompokan
-- (keputusan revisi susulan): tidak lagi dikumpulkan, sehingga
-- kolomnya dihapus agar tidak ada kolom mati yang menyesatkan.
ALTER TABLE "sample_groups" DROP CONSTRAINT "sample_groups_weights_positive";
ALTER TABLE "sample_groups" DROP COLUMN "sample_weight_g";
ALTER TABLE "sample_groups" DROP COLUMN "shrimp_length_cm";
ALTER TABLE "sample_groups"
  ADD CONSTRAINT "sample_groups_weights_positive"
  CHECK ("lab_weight_before_g" > 0 AND "lab_weight_after_g" > 0);
