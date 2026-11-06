"use client";

import { formatMean, observationTempMean } from '../../lib/batch-wizard.ts';

const rowInputCls =
  'w-full px-2.5 py-2 rounded-lg bg-black/25 border border-white/15 text-sm font-mono text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 [color-scheme:dark]';
const summaryInputCls =
  'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-sm font-mono text-white/70 cursor-not-allowed opacity-70';

/**
 * Pengukuran suhu tiap ekor untuk satu tahap observasi (modal pra-sesi).
 *
 * Jumlah baris mengikuti jumlah udang per sesi grup, dan kolom ringkasan
 * "Suhu udang (°C)" sengaja disabled: nilainya diturunkan dari baris di
 * atasnya, bukan diketik, supaya angka yang tersimpan di sesi selalu
 * konsisten dengan pengukuran yang terlihat. Aturan turunannya ada di
 * `observationTempMean` (lib) agar sama dengan yang dipakai saat submit.
 */
export default function ObservationTempFields({ count, values, onChangeRow }: {
  count: number;
  values: readonly string[];
  onChangeRow: (index: number, value: string) => void;
}) {
  const mean = observationTempMean(values, count);
  return (
    <fieldset className="space-y-2">
      <legend className="text-[12px] font-mono text-white/75 mb-1">Suhu udang per ekor (°C)</legend>
      <p className="text-[11px] font-mono text-white/45">
        {count > 0
          ? `Ukur suhu tiap udang pada sampel sesi ini (${count} ekor, sesuai jumlah udang per sesi grup).`
          : 'Jumlah udang per sesi grup ini belum terbaca sehingga baris pengukuran tidak bisa dibuat.'}
      </p>
      {count === 0 ? (
        <p className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] font-mono">
          Periksa pengelompokan batch (ikon pensil) sebelum memulai sesi ini.
        </p>
      ) : (
        <ol className="space-y-2" aria-label={`${count} pengukuran suhu per ekor`}>
          {Array.from({ length: count }, (_, index) => {
            const row = index + 1;
            return (
              <li
                key={row}
                // Jumlah udang per sesi tidak lagi dibatasi 3–5 ekor; baris di
                // luar viewport ditunda paint-nya agar daftar panjang tetap
                // ringan tanpa mengubah DOM atau urutan fokus.
                style={{ contentVisibility: 'auto', containIntrinsicSize: '44px' }}
                className="grid grid-cols-[minmax(64px,auto)_1fr] items-center gap-2"
              >
                <span className="text-[12px] font-mono text-white/70">Udang {row}</span>
                <input
                  id={`obs-temp-${row}`}
                  type="number"
                  step="any"
                  lang="en"
                  inputMode="decimal"
                  placeholder="°C"
                  aria-label={`Suhu udang ${row} (°C)`}
                  value={values[index] ?? ''}
                  onChange={(e) => onChangeRow(index, e.target.value)}
                  className={rowInputCls}
                />
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <label htmlFor="pre-temp" className="block text-[12px] font-mono text-white/75 mb-1">
          Suhu udang (°C)
        </label>
        <input
          id="pre-temp"
          type="text"
          disabled
          value={formatMean(mean)}
          aria-describedby="pre-temp-hint"
          className={summaryInputCls}
        />
        <p id="pre-temp-hint" className="text-[11px] font-mono text-white/45 mt-1">
          {count > 0
            ? `Otomatis: rata-rata dari ${count} pengukuran per ekor.`
            : 'Otomatis terisi setelah baris pengukuran per ekor tersedia.'}
        </p>
      </div>
    </fieldset>
  );
}
