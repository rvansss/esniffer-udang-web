"use client";

import { formatMean, meanFormNumber, type WizardErrors } from '../../lib/batch-wizard.ts';

const rowInputCls = 'w-full px-2 py-2 rounded-lg bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';
const summaryInputCls = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white/70 cursor-not-allowed [color-scheme:dark]';
const labelCls = 'flex flex-col gap-1 text-[13px] font-mono text-white/85';

/**
 * Pengukuran suhu & panjang tiap ekor udang (revisi wizard: Kondisi Udang).
 *
 * Pengukuran per ekor adalah sumber masukan; dua kolom yang sudah ada di
 * kontrak data (`initialTempC`, `shrimpLengthCm`) hanya menyimpan satu nilai
 * untuk seluruh batch, jadi kolomnya diisi otomatis dari rata-rata dan
 * di-disabled agar angka yang tersimpan selalu konsisten dengan baris di atas.
 * Berat sengaja tidak per ekor: ditimbang sekaligus untuk semua udang.
 */
export default function ShrimpMeasurementFields({ count, temperatures, lengths, errors, onChangeRow }: {
  count: number;
  temperatures: readonly string[];
  lengths: readonly string[];
  errors: WizardErrors;
  onChangeRow: (index: number, patch: { temperature?: string; length?: string }) => void;
}) {
  const meanTemp = meanFormNumber(temperatures.slice(0, count));
  const meanLength = meanFormNumber(lengths.slice(0, count));
  return <fieldset className="space-y-3">
    <legend className="text-[13px] font-mono font-semibold text-white/85">Pengukuran per ekor udang *</legend>
    <p className="text-xs font-mono text-white/60">
      Ukur suhu dan panjang tiap udang. Berat ditimbang sekaligus untuk seluruh udang, jadi tetap satu kolom total di atas.
    </p>
    {count === 0
      ? <p className="text-xs font-mono text-amber-200">Isi jumlah total udang (minimal 1 ekor) agar kolom suhu dan panjang tiap ekor muncul.</p>
      : <ol className="space-y-2 max-h-80 overflow-y-auto pr-1" aria-label={`Pengukuran ${count} ekor udang`}>
      {Array.from({ length: count }, (_, index) => {
        const row = index + 1;
        const tempKey = `shrimpTemp-${row}`;
        const lengthKey = `shrimpLength-${row}`;
        const hasError = Boolean(errors[tempKey] || errors[lengthKey]);
        return <li
          key={row}
          // Baris di luar viewport ditunda paint-nya: jumlah ekor tidak lagi
          // dibatasi 10–100, jadi daftar panjang tetap responsif tanpa
          // mengubah DOM atau urutan fokus.
          style={{ contentVisibility: 'auto', containIntrinsicSize: '52px' }}
          className="grid grid-cols-[minmax(56px,auto)_1fr_1fr] items-center gap-2"
        >
          <span className="text-[12px] font-mono text-white/70">Udang {row}</span>
          <input
            id={tempKey}
            type="number"
            required
            step="any"
            lang="en"
            inputMode="decimal"
            placeholder="°C"
            aria-label={`Suhu udang ${row} (°C)`}
            aria-invalid={!!errors[tempKey]}
            aria-describedby={errors[tempKey] ? `${tempKey}-error` : undefined}
            value={temperatures[index] ?? ''}
            onChange={(e) => onChangeRow(index, { temperature: e.target.value })}
            className={`${rowInputCls} ${errors[tempKey] ? 'border-rose-400/60' : ''}`}
          />
          <input
            id={lengthKey}
            type="number"
            required
            step="any"
            lang="en"
            inputMode="decimal"
            placeholder="cm"
            aria-label={`Panjang udang ${row} (cm)`}
            aria-invalid={!!errors[lengthKey]}
            aria-describedby={errors[lengthKey] ? `${lengthKey}-error` : undefined}
            value={lengths[index] ?? ''}
            onChange={(e) => onChangeRow(index, { length: e.target.value })}
            className={`${rowInputCls} ${errors[lengthKey] ? 'border-rose-400/60' : ''}`}
          />
          {hasError && <div className="col-span-3 flex flex-wrap gap-x-3">
            {errors[tempKey] && <span id={`${tempKey}-error`} role="alert" className="text-[11px] font-mono text-rose-300">Suhu: {errors[tempKey]}</span>}
            {errors[lengthKey] && <span id={`${lengthKey}-error`} role="alert" className="text-[11px] font-mono text-rose-300">Panjang: {errors[lengthKey]}</span>}
          </div>}
        </li>;
      })}
      </ol>}
    <div className="grid sm:grid-cols-2 gap-4">
      <label className={labelCls} htmlFor="initialTempC">
        Suhu awal udang saat pembelian (°C) *
        <input id="initialTempC" type="text" disabled value={formatMean(meanTemp)} aria-describedby="initialTempC-hint" className={summaryInputCls} />
        <span id="initialTempC-hint" className="text-xs font-mono text-white/60">
          {count > 0 ? `Otomatis: rata-rata dari ${count} pengukuran per ekor.` : 'Otomatis terisi setelah pengukuran per ekor diisi.'}
        </span>
      </label>
      <label className={labelCls} htmlFor="shrimpLengthCm">
        Panjang udang (cm) *
        <input id="shrimpLengthCm" type="text" disabled value={formatMean(meanLength)} aria-describedby="shrimpLengthCm-hint" className={summaryInputCls} />
        <span id="shrimpLengthCm-hint" className="text-xs font-mono text-white/60">
          {count > 0 ? `Otomatis: rata-rata dari ${count} pengukuran per ekor.` : 'Otomatis terisi setelah pengukuran per ekor diisi.'}
        </span>
      </label>
    </div>
  </fieldset>;
}
