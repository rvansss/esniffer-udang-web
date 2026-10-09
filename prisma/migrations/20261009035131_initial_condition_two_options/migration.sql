-- Kondisi awal disederhanakan menjadi 2 pilihan (hidup/mati, lihat D-02).
--
-- Baris lama bernilai FRESH_DEAD dipetakan ke DEAD (udang yang dibeli mati;
-- tidak ada informasi yang hilang karena FRESH_DEAD adalah sub-kasus mati).
-- Nilai enum dihapus dengan pola buat-ganti-hapus karena PostgreSQL tidak
-- mengizinkan DROP VALUE di dalam transaksi (migrasi Prisma transaksional).
UPDATE "collection_batches"
   SET "initial_condition" = 'DEAD'
 WHERE "initial_condition" = 'FRESH_DEAD';

ALTER TYPE "InitialCondition" RENAME TO "InitialCondition_old";
CREATE TYPE "InitialCondition" AS ENUM ('DEAD', 'ALIVE');
ALTER TABLE "collection_batches"
  ALTER COLUMN "initial_condition" TYPE "InitialCondition"
  USING "initial_condition"::text::"InitialCondition";
DROP TYPE "InitialCondition_old";
