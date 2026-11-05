CREATE TYPE "ShrimpType" AS ENUM ('VANAME', 'WINDU');
ALTER TABLE "collection_batches" ADD COLUMN "shrimp_type" "ShrimpType";
-- Historical measurements remain intact; new observations belong to sessions.
ALTER TABLE "sample_groups" ALTER COLUMN "lab_temp_c" DROP NOT NULL;
ALTER TABLE "sample_groups" ALTER COLUMN "lab_weight_before_g" DROP NOT NULL;

CREATE INDEX "measurement_sessions_chamber_id_started_at_utc_idx" ON "measurement_sessions"("chamber_id", "started_at_utc");
