-- Foto batch dinormalisasi ke tabel batch_photos agar tiap foto bisa
-- membawa caption (lihat D-03): pasar vs sebelum chamber vs sesudahnya.
--
-- Baris lama dipindahkan dari array photo_urls dengan caption kosong (''):
-- caption akan diisi operator lewat halaman detail (PATCH /photos).
-- ID dibuat deterministik dari md5(batch_id || url) agar migrasi tidak
-- butuh ekstensi pgcrypto yang belum terpasang di database ini.
-- Array dihapus belakangan agar kegagalan di tengah tidak menghilangkan data.
CREATE TABLE "batch_photos" (
  "id" UUID NOT NULL,
  "batch_id" VARCHAR(16) NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "caption" VARCHAR(140) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "batch_photos_batch_id_url_key" ON "batch_photos"("batch_id", "url");
CREATE INDEX "batch_photos_batch_id_sort_order_idx" ON "batch_photos"("batch_id", "sort_order");
ALTER TABLE "batch_photos"
  ADD CONSTRAINT "batch_photos_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "collection_batches"("batch_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "batch_photos" ("id", "batch_id", "url", "caption", "sort_order", "created_at")
SELECT (
    substr(d, 1, 8) || '-' || substr(d, 9, 4) || '-' ||
    substr(d, 13, 4) || '-' || substr(d, 17, 4) || '-' || substr(d, 21, 12)
  )::UUID,
  "batch_id", u."url", '', (u."ord" - 1)::INTEGER, CURRENT_TIMESTAMP
FROM "collection_batches",
LATERAL (
  SELECT "url", "ord", md5("batch_id" || "url") AS d
  FROM unnest("photo_urls") WITH ORDINALITY AS t("url", "ord")
) AS u;

ALTER TABLE "collection_batches" DROP COLUMN "photo_urls";
