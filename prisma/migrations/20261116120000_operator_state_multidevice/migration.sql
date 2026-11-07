-- Fase 0 state multi-perangkat + identitas operator.
--
-- Satu akun dipakai bergiliran oleh beberapa operator di beberapa perangkat.
-- Tiga hal yang tadinya hanya hidup di browser (localStorage) dipindahkan ke
-- server supaya bisa dilanjutkan dari perangkat lain:
--   1. auth_sessions.device_id / device_label / operator_name — perangkat dan
--      operator yang sedang memakai akun bersama bisa dibedakan & dicabut;
--   2. group_calibrations — kalibrasi dua tahap dengan waktu mulai absolut;
--   3. batch_drafts — draf wizard batch baru dengan versi (optimistic
--      concurrency) sehingga tidak tertimpa diam-diam dari perangkat lain.
--
-- Kolom operator_* sengaja berupa label bebas, bukan FK ke users: akunnya
-- tetap satu, dan justru label itulah yang membedakan orang di dataset
-- (prinsip ALCOA "attributable" tanpa memecah akun lebih dulu).

-- 1. Identitas perangkat & operator pada sesi autentikasi.
ALTER TABLE "auth_sessions"
  ADD COLUMN "device_id" VARCHAR(64),
  ADD COLUMN "device_label" VARCHAR(80),
  ADD COLUMN "user_agent" VARCHAR(255),
  ADD COLUMN "last_ip" VARCHAR(64),
  ADD COLUMN "operator_name" VARCHAR(80);

CREATE INDEX "auth_sessions_user_id_device_id_idx" ON "auth_sessions"("user_id", "device_id");

-- 2. Jejak kalibrasi pada sesi pengukuran & pencatat pada batch.
ALTER TABLE "measurement_sessions"
  ADD COLUMN "calibration_completed_at_utc" TIMESTAMPTZ(3),
  ADD COLUMN "calibration_version" INTEGER,
  ADD COLUMN "created_by_operator" VARCHAR(80),
  ADD COLUMN "created_by_device" VARCHAR(80),
  ADD COLUMN "completed_by_operator" VARCHAR(80),
  ADD COLUMN "completed_by_device" VARCHAR(80);

ALTER TABLE "collection_batches"
  ADD COLUMN "operator_label" VARCHAR(80),
  ADD COLUMN "created_by_device" VARCHAR(80);

-- 3. Kalibrasi dua tahap per grup.
CREATE TABLE "group_calibrations" (
  "id" UUID NOT NULL,
  "batch_id" VARCHAR(16) NOT NULL,
  "group_id" VARCHAR(24) NOT NULL,
  "steps" JSONB NOT NULL,
  "completed_at_utc" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID,
  "updated_by_operator" VARCHAR(80),
  "updated_by_device" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "group_calibrations_pkey" PRIMARY KEY ("id"),
  -- Bentuk minimal JSON dijaga di DB; validasi isi per langkah ada di
  -- lib/calibration.ts supaya bentuknya bisa berkembang tanpa migrasi.
  CONSTRAINT "group_calibrations_steps_shape" CHECK (
    jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") >= 1
  ),
  CONSTRAINT "group_calibrations_version_positive" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "group_calibrations_group_id_key" ON "group_calibrations"("group_id");
CREATE INDEX "group_calibrations_batch_id_idx" ON "group_calibrations"("batch_id");

ALTER TABLE "group_calibrations"
  ADD CONSTRAINT "group_calibrations_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "collection_batches"("batch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_calibrations"
  ADD CONSTRAINT "group_calibrations_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "sample_groups"("group_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Draf wizard batch baru.
CREATE TABLE "batch_drafts" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "owner_operator" VARCHAR(80) NOT NULL,
  "owner_device_id" VARCHAR(64),
  "owner_device_label" VARCHAR(80),
  "label" VARCHAR(120) NOT NULL DEFAULT '',
  "step" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "consumed_batch_id" VARCHAR(16),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "batch_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_drafts_status_valid" CHECK ("status" IN ('OPEN', 'CONSUMED', 'DISCARDED')),
  CONSTRAINT "batch_drafts_step_range" CHECK ("step" >= 0 AND "step" <= 2),
  CONSTRAINT "batch_drafts_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "batch_drafts_payload_object" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX "batch_drafts_owner_id_status_updated_at_idx" ON "batch_drafts"("owner_id", "status", "updated_at");

ALTER TABLE "batch_drafts"
  ADD CONSTRAINT "batch_drafts_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_drafts"
  ADD CONSTRAINT "batch_drafts_consumed_batch_id_fkey"
  FOREIGN KEY ("consumed_batch_id") REFERENCES "collection_batches"("batch_id") ON DELETE SET NULL ON UPDATE CASCADE;
