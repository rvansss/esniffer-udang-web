-- Section transport dihapus (lihat D-04): yang dicatat cukup waktu beli
-- dan waktu tiba di lab. Kolom berangkat beserta aturannya dihapus;
-- jangkar cold-chain pindah ke tiba dikurangi beli.
--
-- Semua baris yang ada sudah memenuhi beli < tiba (diverifikasi sebelum
-- migrasi), sehingga CHECK baru langsung tervalidasi, bukan NOT VALID.
ALTER TABLE "collection_batches" DROP CONSTRAINT "collection_batches_purchase_within_trip";
ALTER TABLE "collection_batches"
  ADD CONSTRAINT "collection_batches_arrival_after_purchase"
  CHECK ("procured_at_utc" < "arrived_at_utc");
ALTER TABLE "collection_batches" DROP COLUMN "departed_at_utc";
