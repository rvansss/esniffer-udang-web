/** Konversi dan format WIB yang tidak bergantung pada zona waktu browser/server. */
export const WIB_TIME_ZONE = 'Asia/Jakarta';
export const WIB_OFFSET_MINUTES = 7 * 60;

const pad = (n: number): string => String(n).padStart(2, '0');

export function toWibParts(value: Date): { date: string; time: string } {
  const shifted = new Date(value.getTime() + WIB_OFFSET_MINUTES * 60_000);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`,
  };
}

/** Timestamp ISO ber-offset WIB; milidetik dan instant sumber tetap utuh. */
export function toWibIso(value: Date): string {
  return new Date(value.getTime() + WIB_OFFSET_MINUTES * 60_000)
    .toISOString().replace('Z', '+07:00');
}

/** Nilai input datetime-local berlabel WIB, sampai menit. */
export function wibDateTimeLocal(value: Date): string {
  const { date, time } = toWibParts(value);
  return `${date}T${time.slice(0, 5)}`;
}

export function formatWibTime(
  value: Date,
  { seconds = true, label = true }: { seconds?: boolean; label?: boolean } = {},
): string {
  const { time } = toWibParts(value);
  return `${seconds ? time : time.slice(0, 5)}${label ? ' WIB' : ''}`;
}

/**
 * Rentang jam ringkas untuk tabel tahap: `08:00–08:15`. Jam selesai yang belum
 * ada diganti `nullLabel` (tabel memakai "berjalan" untuk sesi yang masih open).
 */
export function formatWibClockRange(
  startedAtUtc: string,
  endedAtUtc: string | null | undefined,
  nullLabel = '…',
): string {
  const start = formatWibTime(new Date(startedAtUtc), { seconds: false, label: false });
  const end = endedAtUtc
    ? formatWibTime(new Date(endedAtUtc), { seconds: false, label: false })
    : nullLabel;
  return `${start}–${end}`;
}

/** Format UI: DD/MM/YYYY HH:mm WIB, dengan detik opsional. */
export function formatWibDateTime(value: Date, seconds = false): string {
  const { date } = toWibParts(value);
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} ${formatWibTime(value, { seconds })}`;
}
