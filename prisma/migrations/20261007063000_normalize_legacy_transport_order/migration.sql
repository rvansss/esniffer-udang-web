-- Aturan urutan (berangkat < beli < tiba) ditambahkan dengan NOT VALID, tetapi
-- NOT VALID hanya menunda pemeriksaan baris lama saat ADD CONSTRAINT; SETIAP
-- UPDATE pada baris lama tetap diperiksa ulang oleh PostgreSQL. Dua batch
-- pengembangan yang dibuat dengan aturan lama karena itu tidak bisa lagi
-- menerima foto, dikunci, atau diubah apa pun (UPDATE gagal 23514).
--
-- Normalisasi timestamp agar koheren dengan aturan baru: berangkat didorong ke
-- 15 menit sebelum belanja dan tiba ke 15 menit sesudah belanja, hanya untuk
-- baris yang masih melanggar urutan.
UPDATE "collection_batches"
   SET "departed_at_utc" = LEAST("departed_at_utc", "procured_at_utc" - INTERVAL '15 minutes'),
       "arrived_at_utc"   = GREATEST("arrived_at_utc", "procured_at_utc" + INTERVAL '15 minutes')
 WHERE NOT (
   "departed_at_utc" < "procured_at_utc"
   AND "procured_at_utc" < "arrived_at_utc"
 );
