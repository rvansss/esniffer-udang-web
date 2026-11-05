"use client";

import { COOLER_TEMP_MIN_C, COOLER_TEMP_MAX_C } from '../../shared/dataset.ts';
import { parseWibInput, type WizardErrors } from '../../lib/batch-wizard.ts';

export interface ArrivalDraft {
  arrivedAt: string;
  coolerLab: string;
  deviationAck: boolean;
}

const inputCls = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';
const labelCls = 'flex flex-col gap-1 text-[13px] font-mono text-white/85';

/**
 * Kolom kedatangan bersama wizard batch baru dan form edit detail: waktu tiba
 * di lab beserta suhu cool box saat tiba. Dikembalikan sebagai fragment supaya
 * pemanggil bisa menaruhnya di dalam grid miliknya sendiri.
 */
export default function ArrivalFields({ value, errors, onChange }: {
  value: ArrivalDraft;
  errors: WizardErrors;
  onChange: (patch: Partial<ArrivalDraft>) => void;
}) {
  return <>
    <label className={labelCls} htmlFor="arrivedAt">
      Tanggal dan jam tiba di lab (WIB) *
      <input id="arrivedAt" type="datetime-local" required value={value.arrivedAt} onChange={(e) => onChange({ arrivedAt: e.target.value })} aria-invalid={!!errors.arrivedAt} aria-describedby={errors.arrivedAt ? 'arrivedAt-error' : undefined} className={inputCls} />
      {errors.arrivedAt && <span id="arrivedAt-error" role="alert" className="text-xs text-rose-300">{errors.arrivedAt}</span>}
    </label>
    <label className={labelCls} htmlFor="coolerLab">
      Suhu cool box saat tiba di lab (°C) *
      <input id="coolerLab" type="number" required min={COOLER_TEMP_MIN_C} max={COOLER_TEMP_MAX_C} step="0.1" value={value.coolerLab} onChange={(e) => onChange({ coolerLab: e.target.value })} aria-invalid={!!errors.coolerLab} aria-describedby={errors.coolerLab ? 'coolerLab-error' : undefined} className={inputCls} />
      {errors.coolerLab && <span id="coolerLab-error" role="alert" className="text-xs text-rose-300">{errors.coolerLab}</span>}
    </label>
  </>;
}

/**
 * Durasi beli → tiba beserta centang deviasi cold-chain. Berlaku untuk kedua
 * grup, jadi ditampilkan sekali di bawah grid.
 */
export function TransportDurationNote({ value, procuredAt, onChange }: {
  value: ArrivalDraft;
  procuredAt: string;
  onChange: (patch: Partial<ArrivalDraft>) => void;
}) {
  const start = parseWibInput(procuredAt).date;
  const end = parseWibInput(value.arrivedAt).date;
  const hours = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null;
  return <>
    {hours !== null && hours >= 0 && <p className="text-xs font-mono text-white/70" aria-live="polite">Durasi beli ke tiba: {hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })} jam.</p>}
    {hours !== null && hours > 3 && <label className="flex gap-2 text-xs font-mono text-amber-200"><input type="checkbox" checked={value.deviationAck} onChange={(e) => onChange({ deviationAck: e.target.checked })} />Saya mencatat deviasi transportasi melebihi 3 jam.</label>}
  </>;
}
