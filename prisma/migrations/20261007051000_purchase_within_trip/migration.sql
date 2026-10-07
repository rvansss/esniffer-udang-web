-- Makna "Waktu berangkat" diperbaiki: berangkat = berangkat DARI lab menuju
-- pasar, sehingga belanja terjadi di tengah perjalanan dan waktunya wajib
-- berada di antara berangkat dan tiba. Aturan lama (berangkat > beli) kini
-- justru menolak data yang benar, jadi cek diganti menjadi
-- berangkat < beli < tiba.
--
-- NOT VALID: dua baris batch pengembangan lama dibuat dengan aturan lama dan
-- sengaja dibiarkan apa adanya; aturan baru ditegakkan untuk baris baru
-- maupun baris yang disentuh ulang.
ALTER TABLE "collection_batches" DROP CONSTRAINT "collection_batches_transport_order";

ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_purchase_within_trip"
    CHECK ("departed_at_utc" < "procured_at_utc" AND "procured_at_utc" < "arrived_at_utc")
    NOT VALID;
