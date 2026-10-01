-- ==============================================================================
-- Migration: 20260930_init
-- Sesuai docs/esniffer/03-technical-design.md Section 5 & docs/esniffer/04-implementation-plan.md
-- Termasuk ekstensi btree_gist, SQL CHECK constraints, dan trigger konsistensi
-- ==============================================================================

-- 1. Ekstensi btree_gist untuk constraint non-overlapping assignment
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Enums
CREATE TYPE "ConnectionState" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE');
CREATE TYPE "ConnectionEvidence" AS ENUM ('NONE', 'LIVE_STATUS', 'LIVE_TELEMETRY', 'RETAINED_SNAPSHOT', 'LWT');
CREATE TYPE "SensorQuality" AS ENUM ('OK', 'SENSOR_ERROR', 'OUT_OF_RANGE', 'MISSING');
CREATE TYPE "MeasurementTimeQuality" AS ENUM ('SYNCED', 'RECONSTRUCTED', 'UNKNOWN');
CREATE TYPE "IngestionSource" AS ENUM ('MQTT', 'PROMETHEUS_IMPORT');
CREATE TYPE "UserRole" AS ENUM ('VIEWER', 'ADMIN');

-- 3. Tabel Chambers
CREATE TABLE "chambers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chambers_pkey" PRIMARY KEY ("id")
);

-- 4. Tabel Devices
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "mqtt_device_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connection_state" "ConnectionState" NOT NULL DEFAULT 'UNKNOWN',
    "connection_evidence" "ConnectionEvidence" NOT NULL DEFAULT 'NONE',
    "current_boot_id" UUID,
    "current_session_id" UUID,
    "current_connection_seq" BIGINT,
    "current_status_sequence" BIGINT,
    "last_seen_at" TIMESTAMPTZ(3),
    "last_status_event_at" TIMESTAMPTZ(3),
    "last_status_processed_at" TIMESTAMPTZ(3),
    "firmware_version" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- 5. Tabel Device Assignments
CREATE TABLE "device_assignments" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "active_from" TIMESTAMPTZ(3) NOT NULL,
    "active_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_assignments_valid_range" CHECK ("active_until" IS NULL OR "active_until" > "active_from")
);

-- Constraint non-overlapping assignment per perangkat menggunakan btree_gist
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_no_overlap"
    EXCLUDE USING gist (
        "device_id" WITH =,
        tstzrange("active_from", COALESCE("active_until", 'infinity'::timestamptz), '[)') WITH &&
    );

-- 6. Tabel Device Time References
CREATE TABLE "device_time_references" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "boot_id" UUID NOT NULL,
    "reference_key" VARCHAR(128) NOT NULL,
    "anchor_utc" TIMESTAMPTZ(3) NOT NULL,
    "anchor_uptime_ms" BIGINT NOT NULL,
    "uncertainty_ms" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_time_references_pkey" PRIMARY KEY ("id")
);

-- 7. Tabel Sensor Readings
CREATE TABLE "sensor_readings" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "chamber_id" UUID,
    "assignment_id" UUID,
    "message_id" VARCHAR(128) NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "boot_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "sample_uptime_ms" BIGINT,
    "measured_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measurement_time_quality" "MeasurementTimeQuality" NOT NULL,
    "time_reference_id" UUID,
    "time_uncertainty_ms" INTEGER,
    "history_sequence" BIGINT,
    "ingestion_source" "IngestionSource" NOT NULL DEFAULT 'MQTT',
    "temperature_c" DECIMAL(7,3),
    "temperature_quality" "SensorQuality" NOT NULL,
    "humidity_percent" DECIMAL(6,3),
    "humidity_quality" "SensorQuality" NOT NULL,
    "mq137_raw" DECIMAL(14,3),
    "mq137_quality" "SensorQuality" NOT NULL,
    "mq136_raw" DECIMAL(14,3),
    "mq136_quality" "SensorQuality" NOT NULL,
    "mq4_raw" DECIMAL(14,3),
    "mq4_quality" "SensorQuality" NOT NULL,
    "raw_payload" JSONB NOT NULL,

    CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("id")
);

-- SQL CHECK constraints untuk Sensor Readings
ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_reading_time_quality" CHECK (
    (
        "measurement_time_quality" IN ('SYNCED', 'RECONSTRUCTED')
        AND "measured_at" IS NOT NULL
        AND "chamber_id" IS NOT NULL
        AND "assignment_id" IS NOT NULL
        AND "history_sequence" IS NOT NULL
    ) OR (
        "measurement_time_quality" = 'UNKNOWN'
        AND "measured_at" IS NULL
        AND "chamber_id" IS NULL
        AND "assignment_id" IS NULL
        AND "history_sequence" IS NULL
    )
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_reconstructed_reference" CHECK (
    ("measurement_time_quality" = 'RECONSTRUCTED' AND "time_reference_id" IS NOT NULL AND "time_uncertainty_ms" IS NOT NULL)
    OR ("measurement_time_quality" != 'RECONSTRUCTED')
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_temperature_quality" CHECK (
    ("temperature_quality" = 'OK' AND "temperature_c" IS NOT NULL)
    OR ("temperature_quality" != 'OK' AND "temperature_c" IS NULL)
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_humidity_quality" CHECK (
    ("humidity_quality" = 'OK' AND "humidity_percent" IS NOT NULL)
    OR ("humidity_quality" != 'OK' AND "humidity_percent" IS NULL)
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_mq137_quality" CHECK (
    ("mq137_quality" = 'OK' AND "mq137_raw" IS NOT NULL)
    OR ("mq137_quality" != 'OK' AND "mq137_raw" IS NULL)
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_mq136_quality" CHECK (
    ("mq136_quality" = 'OK' AND "mq136_raw" IS NOT NULL)
    OR ("mq136_quality" != 'OK' AND "mq136_raw" IS NULL)
);

ALTER TABLE "sensor_readings" ADD CONSTRAINT "chk_mq4_quality" CHECK (
    ("mq4_quality" = 'OK' AND "mq4_raw" IS NOT NULL)
    OR ("mq4_quality" != 'OK' AND "mq4_raw" IS NULL)
);

-- 8. Tabel Users & AuthSessions
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- 9. Tabel Watermark & Monotonic Counter untuk Pagination
CREATE TABLE "history_sequence_watermark" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "current_sequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "history_sequence_watermark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "single_watermark_row" CHECK ("id" = 1)
);

INSERT INTO "history_sequence_watermark" ("id", "current_sequence") VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;

-- 10. Indices
CREATE UNIQUE INDEX "chambers_code_key" ON "chambers"("code");
CREATE UNIQUE INDEX "devices_mqtt_device_id_key" ON "devices"("mqtt_device_id");
CREATE INDEX "device_assignments_device_id_active_from_idx" ON "device_assignments"("device_id", "active_from" DESC);
CREATE INDEX "device_assignments_chamber_id_active_from_idx" ON "device_assignments"("chamber_id", "active_from" DESC);
CREATE INDEX "device_time_references_device_id_boot_id_anchor_uptime_ms_idx" ON "device_time_references"("device_id", "boot_id", "anchor_uptime_ms");
CREATE UNIQUE INDEX "device_time_references_device_id_boot_id_reference_key_key" ON "device_time_references"("device_id", "boot_id", "reference_key");
CREATE UNIQUE INDEX "sensor_readings_history_sequence_key" ON "sensor_readings"("history_sequence");
CREATE INDEX "sensor_readings_chamber_id_measured_at_received_at_history__idx" ON "sensor_readings"("chamber_id", "measured_at" DESC, "received_at" DESC, "history_sequence" DESC);
CREATE INDEX "sensor_readings_device_id_measured_at_received_at_history_s_idx" ON "sensor_readings"("device_id", "measured_at" DESC, "received_at" DESC, "history_sequence" DESC);
CREATE INDEX "sensor_readings_assignment_id_measured_at_idx" ON "sensor_readings"("assignment_id", "measured_at" DESC);
CREATE INDEX "sensor_readings_boot_id_sample_uptime_ms_idx" ON "sensor_readings"("boot_id", "sample_uptime_ms");
CREATE UNIQUE INDEX "sensor_readings_device_id_message_id_key" ON "sensor_readings"("device_id", "message_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- 11. Foreign Keys
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_time_references" ADD CONSTRAINT "device_time_references_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "device_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_time_reference_id_fkey" FOREIGN KEY ("time_reference_id") REFERENCES "device_time_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 12. Trigger Konsistensi Device/Chamber Assignment pada Sensor Reading
CREATE OR REPLACE FUNCTION check_sensor_reading_assignment()
RETURNS TRIGGER AS $$
DECLARE
    v_device_id UUID;
    v_chamber_id UUID;
BEGIN
    IF NEW.assignment_id IS NOT NULL THEN
        SELECT device_id, chamber_id INTO v_device_id, v_chamber_id
        FROM device_assignments
        WHERE id = NEW.assignment_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Assignment % does not exist', NEW.assignment_id;
        END IF;

        IF NEW.device_id != v_device_id THEN
            RAISE EXCEPTION 'Reading device_id % does not match assignment device_id %', NEW.device_id, v_device_id;
        END IF;

        IF NEW.chamber_id IS DISTINCT FROM v_chamber_id THEN
            RAISE EXCEPTION 'Reading chamber_id % does not match assignment chamber_id %', NEW.chamber_id, v_chamber_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sensor_reading_assignment_consistency
BEFORE INSERT OR UPDATE ON "sensor_readings"
FOR EACH ROW
EXECUTE FUNCTION check_sensor_reading_assignment();
