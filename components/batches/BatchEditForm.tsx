"use client";

import { useState } from 'react';
import GroupingFields, { type GroupingDraft } from './GroupingFields';
import { SHRIMP_TYPES } from '../../shared/shrimp.ts';
import { wibDateTimeLocal } from '../../shared/dataset.ts';
import { validateStepA, validateStepB, validateStepC, wibInputToUtcIso, type WizardErrors } from '../../lib/batch-wizard.ts';

interface EditableBatch {
  departedAtUtc: string | null; procuredAtUtc: string; arrivedAtUtc: string;
  marketSource: string; sourceType: string; shrimpType: string | null;
  shrimpCount: number; shrimpLengthCm: number | null; totalWeightG: number | null;
  initialTempC: number | null; initialCondition: string;
  coolerTempDepartureC: number | null; coolerTempMarketC: number | null; coolerTempLabC: number | null;
  sampleGroups: { visualCheck: string; sampleShrimpCount: number }[];
}

export default function BatchEditForm({ batch, saving, onSave, onCancel }: {
  batch: EditableBatch; saving: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>; onCancel: () => void;
}) {
  const sameVisual = new Set(batch.sampleGroups.map((g) => g.visualCheck)).size <= 1;
  const sameCount = new Set(batch.sampleGroups.map((g) => g.sampleShrimpCount)).size <= 1;
  const str = (value: number | null) => value === null ? '' : String(value);
  const [value, setValue] = useState(() => ({
    departedAt: batch.departedAtUtc ? wibDateTimeLocal(new Date(batch.departedAtUtc)) : '',
    procuredAt: wibDateTimeLocal(new Date(batch.procuredAtUtc)), arrivedAt: wibDateTimeLocal(new Date(batch.arrivedAtUtc)),
    coolerDeparture: str(batch.coolerTempDepartureC), coolerMarket: str(batch.coolerTempMarketC), coolerLab: str(batch.coolerTempLabC),
    marketSource: batch.marketSource, sourceType: batch.sourceType, shrimpType: batch.shrimpType ?? '',
    shrimpCount: String(batch.shrimpCount), shrimpLengthCm: str(batch.shrimpLengthCm), totalWeightG: str(batch.totalWeightG),
    initialCondition: batch.initialCondition, initialTempC: str(batch.initialTempC), deviationAck: false,
    visualCheck: sameVisual ? batch.sampleGroups[0]?.visualCheck ?? '' : '',
    sampleShrimpCount: sameCount ? String(batch.sampleGroups[0]?.sampleShrimpCount ?? '') : '',
  }));
  const [errors, setErrors] = useState<WizardErrors>({});
  const change = (patch: Partial<typeof value> | Partial<GroupingDraft>) => { setValue((v) => ({ ...v, ...patch })); setErrors({}); };
  const submit = () => {
    const next = { ...validateStepA(value), ...validateStepB(value), ...validateStepC(value) };
    if (!sameVisual && !value.visualCheck) delete next.visualCheck;
    if (!sameCount && !value.sampleShrimpCount) delete next.sampleShrimpCount;
    if (!batch.sampleGroups.length) { delete next.visualCheck; delete next.sampleShrimpCount; }
    if (Object.keys(next).length) { setErrors(next); return; }
    const grouping = { ...(value.visualCheck ? { visualCheck: value.visualCheck } : {}), ...(value.sampleShrimpCount ? { sampleShrimpCount: Number(value.sampleShrimpCount) } : {}) };
    void onSave({
      departedAtUtc: wibInputToUtcIso(value.departedAt), procuredAtUtc: wibInputToUtcIso(value.procuredAt), arrivedAtUtc: wibInputToUtcIso(value.arrivedAt),
      marketSource: value.marketSource, sourceType: value.sourceType, shrimpType: value.shrimpType,
      shrimpCount: Number(value.shrimpCount), shrimpLengthCm: Number(value.shrimpLengthCm), totalWeightG: Number(value.totalWeightG),
      initialCondition: value.initialCondition, initialTempC: Number(value.initialTempC), coolerTempDepartureC: Number(value.coolerDeparture),
      coolerTempMarketC: Number(value.coolerMarket), coolerTempLabC: Number(value.coolerLab), deviationAcknowledged: value.deviationAck,
      ...(batch.sampleGroups.length && Object.keys(grouping).length ? { grouping } : {}),
    });
  };
  const input = 'w-full p-2.5 rounded-xl bg-black/25 border border-white/20 text-white text-sm [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-emerald-400';
  const field = (key: keyof typeof value, label: string, type = 'text') => <label htmlFor={`edit-${key}`} className="flex flex-col gap-1 text-xs text-white/85">{label} *<input id={`edit-${key}`} type={type} step={type === 'number' ? key === 'shrimpCount' ? '1' : '0.1' : undefined} value={String(value[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} className={input} />{errors[key] && <span role="alert" className="text-rose-300">{errors[key]}</span>}</label>;
  const select = (key: keyof typeof value, label: string, options: readonly (readonly [string, string])[]) => <label htmlFor={`edit-${key}`} className="flex flex-col gap-1 text-xs text-white/85">{label} *<select id={`edit-${key}`} value={String(value[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} className={input}>{options.map(([v, text]) => <option key={v} value={v} className="bg-slate-900">{text}</option>)}</select>{errors[key] && <span role="alert" className="text-rose-300">{errors[key]}</span>}</label>;
  return <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
    <fieldset disabled={saving} className="space-y-5">
      <legend className="text-sm font-mono text-emerald-200">Pengadaan</legend>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('departedAt', 'Tanggal dan jam berangkat (WIB)', 'datetime-local')}{field('coolerDeparture', 'Suhu cool box saat berangkat (°C)', 'number')}
        {select('sourceType', 'Jenis sumber', [['market', 'Pasar'], ['supermarket', 'Supermarket'], ['farm', 'Tambak']])}{field('marketSource', 'Lokasi pembelian')}
      </div>
      <h4 className="text-sm font-mono text-emerald-200">Kondisi & Dokumentasi</h4>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('procuredAt', 'Tanggal dan jam beli (WIB)', 'datetime-local')}{field('coolerMarket', 'Suhu cool box saat di pasar (°C)', 'number')}
        {select('initialCondition', 'Kondisi awal', [['dead', 'Mati saat dibeli'], ['alive', 'Hidup saat dibeli']])}{select('shrimpType', 'Jenis Udang', [['', 'Pilih jenis udang'], ...SHRIMP_TYPES.map((s) => [s.value, s.label] as const)])}
        {field('shrimpCount', 'Jumlah total udang (ekor)', 'number')}{field('totalWeightG', 'Berat total saat pembelian (g)', 'number')}
        {field('initialTempC', 'Suhu awal saat pembelian (°C)', 'number')}{field('shrimpLengthCm', 'Panjang udang (cm)', 'number')}
      </div>
      <h4 className="text-sm font-mono text-emerald-200">Pengelompokan</h4>
      {(!sameVisual || !sameCount) && <p className="text-xs text-amber-200">Data lama berbeda per grup. Isian kosong mempertahankan perbedaan; nilai yang diisi diterapkan ke kedua grup.</p>}
      <GroupingFields value={value} procuredAt={value.procuredAt} errors={errors} onChange={change} mixed={!sameVisual || !sameCount} />
    </fieldset>
    <div className="flex gap-3"><button type="submit" disabled={saving} className="min-h-11 px-4 rounded-xl border border-emerald-400/40 text-emerald-100">{saving ? 'Menyimpan…' : 'Simpan perubahan'}</button><button type="button" disabled={saving} onClick={onCancel} className="min-h-11 px-4 text-white/80">Batal</button></div>
  </form>;
}
