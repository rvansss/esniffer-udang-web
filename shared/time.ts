/**
 * Evaluasi timestamp telemetry dan aturan rekonstruksi waktu
 * Sesuai KF-ING-004, Review Note 2, dan docs/esniffer/03-technical-design.md Section 6.3
 */

import {
  type MeasurementTimeQuality,
  type TelemetryPayloadInput,
  type TimeReference,
  type AckRejectReason,
} from './types.ts';

export const DEFAULT_MAX_FUTURE_TOLERANCE_MS = 2 * 60 * 1000; // +2 menit
export const DEFAULT_MAX_BACKLOG_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
export const DEFAULT_MAX_UNCERTAINTY_MS = 5000; // 5 detik

export class TimeValidationError extends Error {
  public readonly reasonCode: AckRejectReason;
  constructor(message: string, reasonCode: AckRejectReason = 'TIMESTAMP_INVALID') {
    super(message);
    this.name = 'TimeValidationError';
    this.reasonCode = reasonCode;
  }
}

export interface TimeConfig {
  maxFutureToleranceMs?: number;
  maxBacklogMs?: number;
  maxUncertaintyMs?: number;
}

export interface TimeEvaluationResult {
  quality: MeasurementTimeQuality;
  measuredAt: Date | null;
  uncertaintyMs: number | null;
  referenceKey: string | null;
  isEligibleForChamber: boolean;
}

export interface StoredAnchor extends TimeReference {
  boot_id: string;
}

/**
 * Mengevaluasi waktu pengukuran pada payload telemetry:
 * 1. Jika clock_synced=true: gunakan measured_at langsung, validasi batas masa depan dan backlog.
 * 2. Jika clock_synced=false: coba rekonstruksi jika ada anchor dari boot_id yang sama dan memenuhi kriteria.
 * 3. Jika tidak ada anchor valid: return UNKNOWN, measuredAt=null (JANGAN fallback ke received_at).
 */
export function evaluateTelemetryTime(
  payload: TelemetryPayloadInput,
  serverReceivedAt: Date = new Date(),
  storedAnchor?: StoredAnchor | null,
  config: TimeConfig = {}
): TimeEvaluationResult {
  const maxFuture = config.maxFutureToleranceMs ?? DEFAULT_MAX_FUTURE_TOLERANCE_MS;
  const maxBacklog = config.maxBacklogMs ?? DEFAULT_MAX_BACKLOG_MS;
  const maxUncertainty = config.maxUncertaintyMs ?? DEFAULT_MAX_UNCERTAINTY_MS;

  const nowMs = serverReceivedAt.getTime();

  // Kasus 1: Jam perangkat tersinkronisasi saat sampling
  if (payload.clock_synced) {
    if (!payload.measured_at) {
      throw new TimeValidationError('measured_at is required when clock_synced is true', 'TIMESTAMP_INVALID');
    }
    const measuredDate = new Date(payload.measured_at);
    const measuredMs = measuredDate.getTime();

    if (Number.isNaN(measuredMs)) {
      throw new TimeValidationError(`Invalid measured_at timestamp: "${payload.measured_at}"`, 'TIMESTAMP_INVALID');
    }

    if (measuredMs > nowMs + maxFuture) {
      throw new TimeValidationError(
        `measured_at is too far in the future (+${Math.round((measuredMs - nowMs) / 1000)}s > ${maxFuture / 1000}s limit)`,
        'TIMESTAMP_INVALID'
      );
    }

    if (measuredMs < nowMs - maxBacklog) {
      throw new TimeValidationError(
        `measured_at is older than allowed backlog limit (${Math.round((nowMs - measuredMs) / 1000)}s > ${maxBacklog / 1000}s limit)`,
        'BACKLOG_EXPIRED'
      );
    }

    return {
      quality: 'SYNCED',
      measuredAt: measuredDate,
      uncertaintyMs: null,
      referenceKey: payload.time_reference?.reference_id ?? null,
      isEligibleForChamber: true,
    };
  }

  // Kasus 2: Jam perangkat tidak tersinkronisasi saat sampling (clock_synced=false)
  // Periksa apakah ada anchor yang valid: dari payload sendiri atau storedAnchor
  const candidateAnchor: StoredAnchor | null =
    payload.time_reference
      ? { ...payload.time_reference, boot_id: payload.boot_id }
      : (storedAnchor ?? null);

  if (candidateAnchor) {
    // Syarat Rekonstruksi:
    // 1. boot_id harus SAMA PERSIS
    // 2. uncertainty dalam batas
    // 3. uptime sampling harus valid terhadap anchor uptime
    const sameBoot = candidateAnchor.boot_id === payload.boot_id;
    const uncertaintyAcceptable = candidateAnchor.uncertainty_ms <= maxUncertainty;

    if (sameBoot && uncertaintyAcceptable) {
      const anchorUtcMs = new Date(candidateAnchor.anchor_utc).getTime();
      if (!Number.isNaN(anchorUtcMs)) {
        const deltaMs = payload.sample_uptime_ms - candidateAnchor.anchor_uptime_ms;
        const reconstructedMs = anchorUtcMs + deltaMs;

        // Validasi future dan backlog pada waktu hasil rekonstruksi
        if (reconstructedMs > nowMs + maxFuture) {
          throw new TimeValidationError('Reconstructed time is too far in the future', 'TIMESTAMP_INVALID');
        }

        if (reconstructedMs < nowMs - maxBacklog) {
          throw new TimeValidationError('Reconstructed time is older than allowed backlog limit', 'BACKLOG_EXPIRED');
        }

        return {
          quality: 'RECONSTRUCTED',
          measuredAt: new Date(reconstructedMs),
          uncertaintyMs: candidateAnchor.uncertainty_ms,
          referenceKey: candidateAnchor.reference_id,
          isEligibleForChamber: true,
        };
      }
    }
  }

  // Kasus 3: Tidak ada anchor valid untuk rekonstruksi -> UNKNOWN
  // CATATAN KRITIS: JANGAN PERNAH menyalin serverReceivedAt ke measuredAt!
  return {
    quality: 'UNKNOWN',
    measuredAt: null,
    uncertaintyMs: null,
    referenceKey: null,
    isEligibleForChamber: false,
  };
}

/**
 * Aturan Visibilitas:
 * Reading hanya dapat tampil pada tampilan chamber (latest, freshness, grafik, history)
 * bila waktunya diketahui (SYNCED / RECONSTRUCTED) dan telah terpetakan ke chamber.
 */
export function isReadingEligibleForChamber(
  quality: MeasurementTimeQuality,
  chamberId: string | null | undefined
): boolean {
  return quality !== 'UNKNOWN' && typeof chamberId === 'string' && chamberId.length > 0;
}
