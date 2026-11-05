"use client";

import ArrivalFields, { TransportDurationNote } from './ArrivalFields';
import type { WizardErrors } from '../../lib/batch-wizard.ts';

export interface GroupingDraft {
  arrivedAt: string;
  coolerLab: string;
  deviationAck: boolean;
  visualCheck: string;
  sampleShrimpCount: string;
}

const inputCls = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';
const labelCls = 'flex flex-col gap-1 text-[13px] font-mono text-white/85';

export default function GroupingFields({ value, procuredAt, errors, onChange, mixed = false }: {
  value: GroupingDraft;
  procuredAt: string;
  errors: WizardErrors;
  onChange: (patch: Partial<GroupingDraft>) => void;
  mixed?: boolean;
}) {
  const error = (key: string) => errors[key] ? <span id={`${key}-error`} role="alert" className="text-xs text-rose-300">{errors[key]}</span> : null;
  return <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <ArrivalFields value={value} errors={errors} onChange={onChange} />
      <label className={labelCls} htmlFor="sampleShrimpCount">
        Jumlah udang per sesi (ekor) *
        <input id="sampleShrimpCount" type="number" required={!mixed} min="3" max="5" step="1" placeholder={mixed ? 'Berbeda per grup — pertahankan' : '3–5 ekor'} value={value.sampleShrimpCount} onChange={(e) => onChange({ sampleShrimpCount: e.target.value })} aria-invalid={!!errors.sampleShrimpCount} className={inputCls} />
        {error('sampleShrimpCount')}
      </label>
      <label className={labelCls} htmlFor="visualCheck">
        Temuan visual udang *
        <select id="visualCheck" required={!mixed} value={value.visualCheck} onChange={(e) => onChange({ visualCheck: e.target.value })} aria-invalid={!!errors.visualCheck} className={inputCls}>
          <option value="">{mixed ? 'Berbeda per grup — pertahankan' : 'Pilih temuan visual'}</option>
          <option value="normal">Normal</option><option value="melanosis">Melanosis (bintik hitam)</option><option value="damaged">Rusak fisik</option><option value="mixed_species">Campur spesies lain</option>
        </select>
        {error('visualCheck')}
      </label>
    </div>
    <TransportDurationNote value={value} procuredAt={procuredAt} onChange={onChange} />
    <p className="text-xs font-mono text-white/60">Berat dan suhu udang dicatat pada setiap tahap pengujian. Temuan visual dan jumlah sampel berlaku untuk kedua grup.</p>
  </div>;
}
