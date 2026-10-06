-- CreateEnum
CREATE TYPE "CollectionSourceType" AS ENUM ('MARKET', 'FARM');

-- CreateEnum
CREATE TYPE "InitialCondition" AS ENUM ('FRESH_DEAD', 'DEAD', 'ALIVE');

-- CreateEnum
CREATE TYPE "StorageCondition" AS ENUM ('ROOM_TEMP', 'COLD');

-- CreateEnum
CREATE TYPE "VisualCheck" AS ENUM ('NORMAL', 'MELANOSIS', 'DAMAGED', 'MIXED_SPECIES');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'COMPLETE', 'INCOMPLETE', 'LOCKED');

-- AlterTable
ALTER TABLE "sensor_readings" ADD COLUMN     "batch_id" VARCHAR(16),
ADD COLUMN     "is_baseline" BOOLEAN,
ADD COLUMN     "session_id" UUID,
ADD COLUMN     "timepoint_code" VARCHAR(8);

-- CreateTable
CREATE TABLE "collection_batches" (
    "id" UUID NOT NULL,
    "batch_id" VARCHAR(16) NOT NULL,
    "procured_at_utc" TIMESTAMPTZ(3) NOT NULL,
    "market_source" VARCHAR(100) NOT NULL,
    "source_type" "CollectionSourceType" NOT NULL DEFAULT 'MARKET',
    "shrimp_count" INTEGER NOT NULL,
    "size_grade" VARCHAR(32) NOT NULL,
    "total_weight_g" DECIMAL(8,2) NOT NULL,
    "initial_condition" "InitialCondition" NOT NULL,
    "initial_temp_c" DECIMAL(5,2) NOT NULL,
    "departed_at_utc" TIMESTAMPTZ(3) NOT NULL,
    "arrived_at_utc" TIMESTAMPTZ(3) NOT NULL,
    "cooler_temp_min_c" DECIMAL(5,2) NOT NULL,
    "cooler_temp_max_c" DECIMAL(5,2) NOT NULL,
    "ice_to_shrimp_ratio" VARCHAR(8) NOT NULL DEFAULT '2:1',
    "temp_start_c" DECIMAL(5,2) NOT NULL,
    "temp_end_c" DECIMAL(5,2) NOT NULL,
    "rejection_notes" VARCHAR(500),
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operator_id" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_groups" (
    "id" UUID NOT NULL,
    "group_id" VARCHAR(24) NOT NULL,
    "batch_id" VARCHAR(16) NOT NULL,
    "chamber_id" UUID,
    "storage_condition" "StorageCondition" NOT NULL,
    "target_temp_c" DECIMAL(5,2) NOT NULL,
    "lab_temp_c" DECIMAL(5,2) NOT NULL,
    "visual_check" "VisualCheck" NOT NULL,
    "lab_weight_g" DECIMAL(8,2) NOT NULL,
    "sample_shrimp_count" INTEGER NOT NULL,
    "sample_weight_g" DECIMAL(8,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_sessions" (
    "id" UUID NOT NULL,
    "session_id" VARCHAR(32) NOT NULL,
    "group_id" VARCHAR(24) NOT NULL,
    "batch_id" VARCHAR(16) NOT NULL,
    "chamber_id" UUID,
    "device_id" UUID,
    "timepoint_code" VARCHAR(8) NOT NULL,
    "elapsed_hours" INTEGER NOT NULL,
    "started_at_utc" TIMESTAMPTZ(3) NOT NULL,
    "ended_at_utc" TIMESTAMPTZ(3),
    "baseline_mq137" DECIMAL(14,3),
    "baseline_mq136" DECIMAL(14,3),
    "baseline_mq4" DECIMAL(14,3),
    "warmup_done" BOOLEAN NOT NULL DEFAULT false,
    "cleaning_done" BOOLEAN NOT NULL DEFAULT false,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_batches_batch_id_key" ON "collection_batches"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sample_groups_group_id_key" ON "sample_groups"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "sample_groups_batch_id_storage_condition_key" ON "sample_groups"("batch_id", "storage_condition");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_sessions_session_id_key" ON "measurement_sessions"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_sessions_group_id_timepoint_code_key" ON "measurement_sessions"("group_id", "timepoint_code");

-- CreateIndex
CREATE INDEX "sensor_readings_session_id_measured_at_idx" ON "sensor_readings"("session_id", "measured_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_readings_batch_id_timepoint_code_idx" ON "sensor_readings"("batch_id", "timepoint_code");

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "measurement_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "collection_batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_groups" ADD CONSTRAINT "sample_groups_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "collection_batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_groups" ADD CONSTRAINT "sample_groups_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "sample_groups"("group_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "collection_batches"("batch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==============================================================================
-- CHECK constraints domain dataset (PRD §5.4). Prisma tidak mendukung CHECK
-- lintas-field, mengikuti pola 20260930_init.
-- market_source SENGAJA tanpa CHECK enum: teks bebas sesuai revisi (bukan dropdown).
-- ==============================================================================
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_batch_id_format"
    CHECK ("batch_id" ~ '^BT-[0-9]{8}-[0-9]{2}$');
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_market_source_nonempty"
    CHECK (char_length("market_source") BETWEEN 1 AND 100);
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_shrimp_count_min"
    CHECK ("shrimp_count" >= 10);
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_total_weight_positive"
    CHECK ("total_weight_g" > 0);
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_transport_order"
    CHECK ("departed_at_utc" > "procured_at_utc" AND "arrived_at_utc" > "departed_at_utc");
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_cooler_range"
    CHECK ("cooler_temp_min_c" BETWEEN 0 AND 4 AND "cooler_temp_max_c" BETWEEN 0 AND 4);

ALTER TABLE "sample_groups" ADD CONSTRAINT "sample_groups_shrimp_count_range"
    CHECK ("sample_shrimp_count" BETWEEN 3 AND 5);
ALTER TABLE "sample_groups" ADD CONSTRAINT "sample_groups_weights_positive"
    CHECK ("lab_weight_g" > 0 AND "sample_weight_g" > 0);

ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_timepoint_format"
    CHECK ("timepoint_code" ~ '^(H[0-9]+|D[0-9]+)$');
ALTER TABLE "measurement_sessions" ADD CONSTRAINT "measurement_sessions_elapsed_nonneg"
    CHECK ("elapsed_hours" >= 0);
