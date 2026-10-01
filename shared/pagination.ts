/**
 * Kontrak Snapshot Pagination & Keyset Cursor
 * Sesuai KF-HIS-001, Review Note 1, dan docs/esniffer/03-technical-design.md Section 5.5 & 7.5
 *
 * PERINGATAN INTEGRITAS DATABASE (Review Note 1):
 * 1. Di PostgreSQL, sequence generator (`nextval`) TIDAK MENGIKUTI URUTAN COMMIT.
 *    Alokasi nomor sequence bersifat independen dari urutan commit transaksi concurrent.
 *
 * 2. Skenario Anomali Late-Commit:
 *    - Waktu t1: Transaksi A mengalokasikan sequence 100.
 *    - Waktu t2: Transaksi B mengalokasikan sequence 101.
 *    - Waktu t3: Transaksi B commit. Row 101 kini committed dan visible. Transaksi A masih in-flight.
 *    - Waktu t4: Klien membaca Halaman 1. Server mengambil watermark:
 *                `snapshotWatermark = max(history_sequence)` = 101.
 *                Halaman 1 mengembalikan reading <= watermark.
 *    - Waktu t5: Transaksi A akhirnya commit dengan sequence 100.
 *    - Waktu t6: Klien meminta Halaman 2 menggunakan cursor Halaman 1 (watermark=101).
 *                Karena sequence 100 <= 101, Transaksi A memenuhi kriteria watermark.
 *                Jika sort position (measuredAt, receivedAt, 100) berada di rentang Halaman 2,
 *                data A muncul di tengah traversal; jika berada di rentang Halaman 1 yang sudah
 *                terlewat, data A terlewat sepenuhnya dari pagination ini!
 *
 * 3. Mekanisme Visibility untuk Mengamankan Watermark:
 *    - Opsi A (Active Transaction Boundary): Watermark tidak sekadar `max(history_sequence)`,
 *      tetapi `COALESCE(min(in_flight_sequence) - 1, max(committed_sequence))`,
 *      atau berbasis PostgreSQL transaction snapshot (`pg_snapshot` / `txid_snapshot`).
 *    - Opsi B (Commit-Time Allocation): Nomor `history_sequence` hanya dialokasikan tepat
 *      pada saat transaksi commit di bawah mutual exclusion / sequence counter commit.
 *
 * 4. STATUS FASE 1:
 *    Jaminan transaksi ini BELUM TERVERIFIKASI pada kode unit test in-memory Fase 1
 *    dan WAJIB diuji secara nyata dengan PostgreSQL concurrency test pada Fase 2 (T-HIS-04).
 */

import { createHmac } from 'node:crypto';

export interface CursorPayload {
  v: 1;
  fh: string; // Filter hash
  wm: string; // Snapshot watermark (BigInt as string)
  ma: string; // Last measured_at (RFC 3339)
  ra: string; // Last received_at (RFC 3339)
  hs: string; // Last history_sequence (BigInt as string)
}

export interface PaginationFilter {
  chamberId: string;
  deviceId?: string;
  from: string;
  to: string;
  order: 'DESC';
}

export class PaginationCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaginationCursorError';
  }
}

/**
 * Menghitung hash representatif dari filter query untuk mencegah penggunaan cursor lintas filter
 */
export function computeFilterHash(filter: PaginationFilter): string {
  const norm = `${filter.chamberId}|${filter.deviceId || ''}|${filter.from}|${filter.to}|${filter.order}`;
  return createHmac('sha256', 'esniffer-filter-key').update(norm).digest('hex').slice(0, 16);
}

/**
 * Mendapatkan secret key penandatanganan cursor.
 * Gagal dengan jelas (throw error) pada produksi jika konfigurasi wajib CURSOR_SIGNING_SECRET tidak disetel.
 */
export function getCursorSigningSecret(): string {
  const secret = process.env.CURSOR_SIGNING_SECRET;
  if (!secret || secret.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing mandatory environment variable: CURSOR_SIGNING_SECRET in production');
    }
    return 'dev-cursor-secret-change-in-production';
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('CURSOR_SIGNING_SECRET must be at least 32 characters in production');
  }
  return secret;
}

/**
 * Melakukan encode dan HMAC signing pada cursor tuple
 */
export function encodeCursor(
  payload: CursorPayload,
  secretKey: string = getCursorSigningSecret()
): string {
  const jsonStr = JSON.stringify(payload);
  const dataB64 = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secretKey).update(dataB64).digest('hex').slice(0, 16);
  return `${dataB64}.${signature}`;
}

/**
 * Melakukan verifikasi HMAC dan decode cursor tuple
 */
export function decodeCursor(
  cursorStr: string,
  expectedFilter: PaginationFilter,
  secretKey: string = getCursorSigningSecret()
): CursorPayload {
  if (!cursorStr || typeof cursorStr !== 'string') {
    throw new PaginationCursorError('Cursor must be a non-empty string');
  }

  const parts = cursorStr.split('.');
  if (parts.length !== 2) {
    throw new PaginationCursorError('Malformed cursor token format');
  }

  const [dataB64, signature] = parts;
  const expectedSig = createHmac('sha256', secretKey).update(dataB64).digest('hex').slice(0, 16);

  if (signature !== expectedSig) {
    throw new PaginationCursorError('Cursor signature mismatch or tampered cursor');
  }

  let payload: CursorPayload;
  try {
    const jsonStr = Buffer.from(dataB64, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr) as CursorPayload;
  } catch {
    throw new PaginationCursorError('Failed to parse cursor payload');
  }

  if (payload.v !== 1 || !payload.wm || !payload.hs || !payload.ma || !payload.ra) {
    throw new PaginationCursorError('Invalid cursor payload structure');
  }

  // Verifikasi kesesuaian filter hash
  const currentFh = computeFilterHash(expectedFilter);
  if (payload.fh !== currentFh) {
    throw new PaginationCursorError('Cursor filter mismatch: filter parameters have changed');
  }

  return payload;
}

/**
 * Evaluasi snapshot pagination:
 * Memeriksa apakah reading berada di dalam snapshot watermark yang dibekukan pada halaman pertama.
 *
 * CATATAN PENTING:
 * Ini hanya menjamin isolasi dari record yang sequence-nya dialokasikan setelah watermark.
 * Penanganan transaksi late-commit (sequence lebih kecil yang commit belakangan)
 * memerlukan mekanisme visibility database pada Fase 2.
 */
export function isReadingInSnapshot(
  readingHistorySequence: bigint,
  snapshotWatermark: bigint
): boolean {
  return readingHistorySequence <= snapshotWatermark;
}

export interface SortTuple {
  measuredAt: Date;
  receivedAt: Date;
  historySequence: bigint;
}

/**
 * Membandingkan tuple total order (measuredAt DESC, receivedAt DESC, historySequence DESC).
 * Mengembalikan true jika candidate berada SESUDAH cursor position (yaitu candidate lebih kecil nilainya dalam sort DESC).
 */
export function isCandidateAfterCursor(
  candidate: SortTuple,
  cursor: SortTuple
): boolean {
  // 1. measuredAt DESC
  if (candidate.measuredAt.getTime() < cursor.measuredAt.getTime()) return true;
  if (candidate.measuredAt.getTime() > cursor.measuredAt.getTime()) return false;

  // 2. receivedAt DESC (tie-breaker 1)
  if (candidate.receivedAt.getTime() < cursor.receivedAt.getTime()) return true;
  if (candidate.receivedAt.getTime() > cursor.receivedAt.getTime()) return false;

  // 3. historySequence DESC (tie-breaker 2 unik)
  return candidate.historySequence < cursor.historySequence;
}

/**
 * Model konseptual untuk perhitungan Safe Snapshot Watermark terhadap Transaksi In-Flight:
 * Menghitung batas sequence teraman dengan memperhatikan transaksi yang sedang berjalan.
 * Jika ada transaksi in-flight dengan sequence minimum `minInFlightSeq`,
 * maka safe watermark harus dibatasi ke `minInFlightSeq - 1n` agar transaksi yang commit
 * belakangan tidak menyusup ke dalam snapshot pagination yang sedang aktif.
 */
export function calculateSafeWatermark(
  maxCommittedSeq: bigint | null,
  minInFlightSeq: bigint | null
): bigint | null {
  if (maxCommittedSeq === null) return null;
  if (minInFlightSeq !== null && minInFlightSeq <= maxCommittedSeq) {
    // Ada transaksi in-flight dengan sequence lebih kecil atau sama dengan maxCommitted
    return minInFlightSeq > 1n ? minInFlightSeq - 1n : 0n;
  }
  return maxCommittedSeq;
}
