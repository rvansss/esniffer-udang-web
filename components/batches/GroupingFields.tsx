"use client";

import { COOLER_TEMP_MIN_C, COOLER_TEMP_MAX_C } from '../../shared/dataset.ts';
import { parseWibInput, type WizardErrors } from '../../lib/batch-wizard.ts';

export interface GroupingDraft {
  arrivedAt: string;
  coolerLab: string;
  deviationAck: boolean;
  visualCheck: string;
  sampleShrimpCount: string;
}

const inputCls = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';

export default function GroupingFields({ value, procuredAt, errors, onChange, mixed = false }: {
  value: GroupingDraft;
  procuredAt: string;
  errors: WizardErrors;
  onChange: (patch: Partial<GroupingDraft>) => void;
  mixed?: boolean;
}) {
  const start = parseWibInput(procuredAt).date;
  const end = parseWibInput(value.arrivedAt).date;
  const hours = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null;
  const error = (key: string) => errors[key] ? <span id={`${key}-error`} role="alert" className="text-xs text-rose-300">{errors[key]}</span> : null;
  return <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="flex flex-col gap-1 text-[13px] font-mono text-white/85" htmlFor="arrivedAt">
        Tanggal dan jam tiba di lab (WIB) *
        <input id="arrivedAt" type="datetime-local" required value={value.arrivedAt} onChange={(e) => onChange({ arrivedAt: e.target.value })} aria-invalid={!!errors.arrivedAt} aria-describedby={errors.arrivedAt ? 'arrivedAt-error' : undefined} className={inputCls} />
        {error('arrivedAt')}
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-mono text-white/85" htmlFor="coolerLab">
        Suhu cool box saat tiba di lab (°C) *
        <input id="coolerLab" type="number" required min={COOLER_TEMP_MIN_C} max={COOLER_TEMP_MAX_C} step="0.1" value={value.coolerLab} onChange={(e) => onChange({ coolerLab: e.target.value })} aria-invalid={!!errors.coolerLab} aria-describedby={errors.coolerLab ? 'coolerLab-error' : undefined} className={inputCls} />
        {error('coolerLab')}
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-mono text-white/85" htmlFor="sampleShrimpCount">
        Jumlah udang per sesi (ekor) *
        <input id="sampleShrimpCount" type="number" required={!mixed} min="3" max="5" step="1" placeholder={mixed ? 'Berbeda per grup — pertahankan' : '3–5 ekor'} value={value.sampleShrimpCount} onChange={(e) => onChange({ sampleShrimpCount: e.target.value })} aria-invalid={!!errors.sampleShrimpCount} className={inputCls} />
        {error('sampleShrimpCount')}
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-mono text-white/85" htmlFor="visualCheck">
        Temuan visual udang *
        <select id="visualCheck" required={!mixed} value={value.visualCheck} onChange={(e) => onChange({ visualCheck: e.target.value })} aria-invalid={!!errors.visualCheck} className={inputCls}>
          <option value="">{mixed ? 'Berbeda per grup — pertahankan' : 'Pilih temuan visual'}</option>
          <option value="normal">Normal</option><option value="melanosis">Melanosis (bintik hitam)</option><option value="damaged">Rusak fisik</option><option value="mixed_species">Campur spesies lain</option>
        </select>
        {error('visualCheck')}
      </label>
    </div>
    {hours !== null && hours >= 0 && <p className="text-xs font-mono text-white/70" aria-live="polite">Durasi beli ke tiba: {hours.toLocaleString('id-ID', { maximumFractionDigits: 2 })} jam.</p>}
    {hours !== null && hours > 3 && <label className="flex gap-2 text-xs font-mono text-amber-200"><input type="checkbox" checked={value.deviationAck} onChange={(e) => onChange({ deviationAck: e.target.checked })} />Saya mencatat deviasi transportasi melebihi 3 jam.</label>}
    <p className="text-xs font-mono text-white/60">Berat dan suhu udang dicatat pada setiap tahap pengujian. Temuan visual dan jumlah sampel berlaku untuk kedua grup.</p>
  </div>;
}
