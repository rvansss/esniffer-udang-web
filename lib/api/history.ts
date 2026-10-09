/**
 * Bentuk baris tabel Riwayat telemetri.
 * API history mengembalikan nilai bersarang (`values.temperatureC.value`);
 * mapper di bawah meratakannya agar render tidak bergantung pada `any`.
 */
export interface HistoryRow {
  id: string;
  measuredAt: string | null;
  temperatureC: number | null;
  humidityPercent: number | null;
  mq137Raw: number | null;
  mq136Raw: number | null;
  mq4Raw: number | null;
  measurementTimeQuality: string;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sensorValue(row: Record<string, unknown>, key: string): number | null {
  const cell = row[key];
  if (typeof cell !== 'object' || cell === null) {
    return null;
  }
  return finiteNumberOrNull((cell as { value?: unknown }).value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Meratakan satu entri respons API history. Mengembalikan null bila entri
 * bukan objek atau tanpa id, sehingga baris rusak terlewati, bukan crash.
 */
export function toHistoryRow(item: unknown): HistoryRow | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const row = item as Record<string, unknown>;
  if (typeof row.id !== 'string') {
    return null;
  }
  const values =
    typeof row.values === 'object' && row.values !== null
      ? (row.values as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    measuredAt: textOrNull(row.measuredAt),
    temperatureC: sensorValue(values, 'temperatureC'),
    humidityPercent: sensorValue(values, 'humidityPercent'),
    mq137Raw: sensorValue(values, 'mq137Raw'),
    mq136Raw: sensorValue(values, 'mq136Raw'),
    mq4Raw: sensorValue(values, 'mq4Raw'),
    measurementTimeQuality:
      typeof row.measurementTimeQuality === 'string' ? row.measurementTimeQuality : 'UNKNOWN',
  };
}

/**
 * Mengambil kursor halaman berikut dari payload API history.
 * Nilai hilang atau bukan string dibaca sebagai tidak ada halaman lanjut.
 */
export function nextCursorOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const meta = (payload as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) {
    return null;
  }
  const cursor = (meta as { nextCursor?: unknown }).nextCursor;
  return typeof cursor === 'string' && cursor !== '' ? cursor : null;
}

/**
 * Meratakan seluruh payload respons API history. Payload bukan array
 * menghasilkan daftar kosong; entri rusak dilewati satu per satu.
 */
export function toHistoryRows(payload: unknown): HistoryRow[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: HistoryRow[] = [];
  for (const item of data) {
    const row = toHistoryRow(item);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
}
