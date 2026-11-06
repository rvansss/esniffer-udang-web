"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import ArrivalFields, { TransportDurationNote } from '../../../components/batches/ArrivalFields';
import ShrimpMeasurementFields from '../../../components/batches/ShrimpMeasurementFields';
import BatchPhotoPicker, { type PhotoGroup } from '../../../components/batches/BatchPhotoPicker';
import { loadBatchDraft, saveBatchDraft, removeBatchDraft } from '../../../lib/batch-draft.ts';
import {
  coolerTempWarning,
  meanFormNumber,
  shrimpCountWarning,
  shrimpRowCount,
  stepOfField,
  validateStepA,
  validateStepB,
  validateStepC,
  wibInputToUtcIso,
  type WizardErrors,
} from '../../../lib/batch-wizard.ts';
import { wibDateTimeLocal, MAX_PHOTO_CAPTION_LENGTH } from '../../../shared/dataset.ts';
import { SHRIMP_TYPES } from '../../../shared/shrimp.ts';

/**
 * Isian wizard batch baru. Suhu awal & panjang udang tidak lagi berupa isian
 * bebas: keduanya diturunkan dari pengukuran per ekor (lihat
 * `ShrimpMeasurementFields`), jadi state menyimpan baris pengukurannya.
 */
interface FormValues {
  departedAt: string; coolerDeparture: string; procuredAt: string; arrivedAt: string;
  marketSource: string; sourceType: string; shrimpType: string;
  shrimpCount: string; totalWeightG: string;
  initialCondition: string; visualCheck: string; coolerMarket: string; coolerLab: string;
  deviationAck: boolean;
  sampleShrimpCountRoomTemp: string; sampleShrimpCountCold: string;
  shrimpTemperatures: string[]; shrimpLengths: string[];
}
const defaults = (): FormValues => ({
  departedAt: wibDateTimeLocal(new Date()), procuredAt: wibDateTimeLocal(new Date()), arrivedAt: wibDateTimeLocal(new Date()),
  coolerDeparture: '', marketSource: '', sourceType: 'market', shrimpType: '',
  shrimpCount: '10', totalWeightG: '',
  initialCondition: 'dead', visualCheck: 'normal', coolerMarket: '', coolerLab: '', deviationAck: false,
  sampleShrimpCountRoomTemp: '4', sampleShrimpCountCold: '4',
  shrimpTemperatures: [], shrimpLengths: [],
});
const card = 'rounded-2xl bg-white/10 border border-white/20 p-5 md:p-6 space-y-5';
const input = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';
const button = 'min-h-11 px-4 py-3 rounded-xl border border-emerald-400/40 text-emerald-100 bg-emerald-500/20 text-sm font-mono disabled:opacity-50';
const steps = ['Pengadaan', 'Kondisi Udang', 'Pengelompokan'];
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Ambil hanya string dari draf localStorage (isian draf tidak dipercaya mentah). */
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Samakan panjang daftar pengukuran dengan jumlah ekor tanpa membuang isian yang ada. */
function resizeRows(rows: readonly string[], count: number): string[] {
  const next = rows.slice(0, count);
  while (next.length < count) next.push('');
  return next;
}

function BatchWizard({ userId, apiFetch }: { userId: string; apiFetch: ApiFetch }) {
  const router = useRouter();
  const [draft] = useState(() => loadBatchDraft(userId));
  const [values, setValues] = useState<FormValues>(() => {
    const base = defaults();
    const saved = (draft ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(base) as (keyof FormValues)[]) {
      if (key === 'deviationAck' || key === 'shrimpTemperatures' || key === 'shrimpLengths') continue;
      if (typeof saved[key] === 'string') (base as unknown as Record<string, unknown>)[key] = saved[key];
    }
    base.deviationAck = saved.deviationAck === true;
    base.shrimpTemperatures = stringArray(saved.shrimpTemperatures);
    base.shrimpLengths = stringArray(saved.shrimpLengths);
    return base;
  });
  const [step, setStep] = useState(() => Math.min(2, Math.max(0, draft?.step ?? 0)));
  const [errors, setErrors] = useState<WizardErrors>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  const [batchPhotos, setBatchPhotos] = useState<PhotoGroup>({ files: [], captions: [] });
  const [groupPhotos, setGroupPhotos] = useState<PhotoGroup>({ files: [], captions: [] });
  const [uploaded, setUploaded] = useState({ batch: false, grouping: false });
  const [draftVisible, setDraftVisible] = useState(Boolean(draft));
  const [photoKey, setPhotoKey] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current || createdBatchId) return;
    const timer = setTimeout(() => saveBatchDraft({ ...values, step, userId,
      batchCaptions: batchPhotos.captions, groupingCaptions: groupPhotos.captions,
    }), 800);
    return () => clearTimeout(timer);
  }, [values, step, userId, batchPhotos.captions, groupPhotos.captions, createdBatchId]);
  const change = (patch: Partial<FormValues>) => {
    dirty.current = true;
    setValues((v) => ({ ...v, ...patch }));
    setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !(key in patch))));
  };
  /** Jumlah ekor menentukan panjang daftar pengukuran per ekor. */
  const setCount = (value: string) => {
    dirty.current = true;
    setValues((v) => {
      const count = shrimpRowCount(value);
      return count === 0 ? { ...v, shrimpCount: value } : {
        ...v,
        shrimpCount: value,
        shrimpTemperatures: resizeRows(v.shrimpTemperatures, count),
        shrimpLengths: resizeRows(v.shrimpLengths, count),
      };
    });
    setErrors((previous) => {
      const next = { ...previous };
      delete next.shrimpCount;
      return next;
    });
  };
  /** Satu baris pengukuran berubah: simpan nilainya dan hapus error baris itu saja. */
  const setRow = (index: number, patch: { temperature?: string; length?: string }) => {
    dirty.current = true;
    setValues((v) => {
      const shrimpTemperatures = [...v.shrimpTemperatures];
      const shrimpLengths = [...v.shrimpLengths];
      if (patch.temperature !== undefined) shrimpTemperatures[index] = patch.temperature;
      if (patch.length !== undefined) shrimpLengths[index] = patch.length;
      return { ...v, shrimpTemperatures, shrimpLengths };
    });
    setErrors((previous) => {
      const next = { ...previous };
      if (patch.temperature !== undefined) delete next[`shrimpTemp-${index + 1}`];
      if (patch.length !== undefined) delete next[`shrimpLength-${index + 1}`];
      return next;
    });
  };
  const rows = shrimpRowCount(values.shrimpCount);
  const validators = [() => validateStepA(values), () => validateStepB(values), () => validateStepC(values)];
  const showErrors = (next: WizardErrors) => {
    setErrors(next);
    const first = Object.keys(next)[0];
    setStep(stepOfField(first));
    requestAnimationFrame(() => document.getElementById(first)?.focus());
  };
  const navigate = (next: number) => {
    if (next > step) for (let i = 0; i < next; i++) {
      const found = validators[i]();
      if (Object.keys(found).length) { showErrors(found); return; }
    }
    setErrors({}); setStep(next);
  };
  const upload = async (batchId: string, selection: PhotoGroup) => {
    if (!selection.files.length) return;
    const form = new FormData();
    selection.files.forEach((file) => form.append('photos', file));
    form.append('captions', JSON.stringify(selection.captions));
    const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? 'Unggah foto gagal. Coba lagi untuk melanjutkan.');
  };
  const submit = async () => {
    if (submitting) return;
    const found = Object.assign({}, ...validators.map((validate) => validate()));
    for (const [key, photos] of [['photos', batchPhotos], ['groupingPhotos', groupPhotos]] as const) {
      if (photos.files.some((_, i) => !photos.captions[i]?.trim() || photos.captions[i].trim().length > MAX_PHOTO_CAPTION_LENGTH)) found[key] = 'Setiap foto wajib memiliki caption maksimal 140 karakter.';
    }
    if (Object.keys(found).length) { showErrors(found); return; }
    // Nilai yang disimpan tetap satu angka per batch: rata-rata pengukuran per ekor.
    const initialTempC = meanFormNumber(values.shrimpTemperatures.slice(0, rows));
    const shrimpLengthCm = meanFormNumber(values.shrimpLengths.slice(0, rows));
    if (initialTempC === null || shrimpLengthCm === null) {
      setError('Pengukuran suhu & panjang per ekor belum lengkap. Periksa jumlah udang dan baris pengukurannya.');
      return;
    }
    setSubmitting(true); setError('');
    try {
      let batchId = createdBatchId;
      if (!batchId) {
        const res = await apiFetch('/api/v1/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          departedAtUtc: wibInputToUtcIso(values.departedAt), procuredAtUtc: wibInputToUtcIso(values.procuredAt), arrivedAtUtc: wibInputToUtcIso(values.arrivedAt),
          marketSource: values.marketSource.trim(), sourceType: values.sourceType, shrimpType: values.shrimpType,
          shrimpCount: Number(values.shrimpCount), shrimpLengthCm, totalWeightG: Number(values.totalWeightG),
          initialCondition: values.initialCondition, initialTempC, coolerTempDepartureC: Number(values.coolerDeparture),
          coolerTempMarketC: Number(values.coolerMarket), coolerTempLabC: Number(values.coolerLab), deviationAcknowledged: values.deviationAck,
          grouping: {
            visualCheck: values.visualCheck,
            sampleShrimpCountRoomTemp: Number(values.sampleShrimpCountRoomTemp),
            sampleShrimpCountCold: Number(values.sampleShrimpCountCold),
          },
        }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message ?? 'Gagal menyimpan batch.');
        batchId = body.data.batchId as string;
        setCreatedBatchId(batchId); removeBatchDraft();
      }
      if (!uploaded.batch) { await upload(batchId, batchPhotos); setUploaded((v) => ({ ...v, batch: true })); }
      if (!uploaded.grouping) { await upload(batchId, groupPhotos); setUploaded((v) => ({ ...v, grouping: true })); }
      router.push(`/batches/${encodeURIComponent(batchId)}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal menyimpan.'); }
    finally { setSubmitting(false); }
  };
  const fieldError = (key: string) => errors[key] && <span role="alert" id={`${key}-error`} className="text-xs text-rose-300">{errors[key]}</span>;
  /** Peringatan acuan protokol — tidak pernah memblokir navigasi atau simpan. */
  const fieldWarning = (key: string, message: string | null) => message && <span role="status" id={`${key}-warning`} className="text-xs text-amber-200">{message}</span>;
  const describedBy = (key: string, warning: string | null) => [errors[key] ? `${key}-error` : '', warning ? `${key}-warning` : ''].filter(Boolean).join(' ') || undefined;
  /**
   * Isian angka. `min`/`max` hanya dipakai kolom yang memang punya batas
   * domain (berat total); suhu dan panjang bebas rentang sehingga memakai
   * `step="any"` + `lang="en"` agar desimal bertitik selalu diterima.
   */
  const field = (key: keyof FormValues, label: string, type = 'text', warning: string | null = null, min?: number, max?: number) => <label className="flex flex-col gap-1.5 text-[13px] font-mono text-white/85" htmlFor={key}>
    {label} *<input id={key} required type={type} min={min} max={max} step={type === 'number' ? 'any' : undefined} inputMode={type === 'number' ? 'decimal' : undefined} lang={type === 'number' ? 'en' : undefined} value={String(values[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} aria-describedby={describedBy(key, warning)} className={input} />{fieldError(key)}{fieldWarning(key, warning)}
  </label>;
  const countField = (key: keyof FormValues, label: string, warning: string | null, onChange: (value: string) => void) => <label className="flex flex-col gap-1.5 text-[13px] font-mono text-white/85" htmlFor={key}>
    {label} *<input id={key} required type="number" step="1" inputMode="numeric" value={String(values[key])} onChange={(e) => onChange(e.target.value)} aria-invalid={!!errors[key]} aria-describedby={describedBy(key, warning)} className={input} />{fieldError(key)}{fieldWarning(key, warning)}
  </label>;
  const select = (key: keyof FormValues, label: string, options: readonly (readonly [string, string])[]) => <label htmlFor={key} className="flex flex-col gap-1.5 text-[13px] font-mono text-white/85">{label} *<select id={key} required value={String(values[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} className={input}>{options.map(([value, text]) => <option key={value} value={value} className="bg-slate-900">{text}</option>)}</select>{fieldError(key)}</label>;
  const radio = (key: 'initialCondition', label: string, options: readonly (readonly [string, string])[]) => <fieldset id={key} tabIndex={-1} className="rounded-xl" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined}>
    <legend className="text-[13px] font-mono text-white/85 mb-1.5">{label} *</legend>
    <div className="flex flex-wrap gap-2">
      {options.map(([value, text]) => {
        const checked = values[key] === value;
        return <label key={value} className={`inline-flex items-center gap-2 min-h-11 px-3.5 py-2.5 rounded-xl border text-sm font-mono cursor-pointer ${checked ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100' : 'border-white/20 bg-black/25 text-white/85'}`}>
          <input type="radio" name={key} value={value} checked={checked} onChange={() => change({ initialCondition: value })} className="accent-emerald-400" />
          {text}
        </label>;
      })}
    </div>
    {fieldError(key)}
  </fieldset>;
  return <div className="space-y-5 max-w-3xl mx-auto">
    <h2 className="text-2xl font-mono font-bold text-white">Batch baru</h2>
    <p className="text-xs font-mono text-white/60">Langkah {step + 1} dari 3. Tanda * berarti wajib diisi. Semua waktu dalam WIB.</p>
    {draftVisible && <div className={card}><p className="text-xs text-cyan-200">Draf dipulihkan. Pilih ulang berkas foto. Caption sebelumnya: {[...(draft?.batchCaptions ?? []), ...(draft?.groupingCaptions ?? [])].join(' · ') || '—'}</p><button type="button" className={button} onClick={() => { dirty.current = false; removeBatchDraft(); setValues(defaults()); setStep(0); setPhotoKey((v) => v + 1); setBatchPhotos({ files: [], captions: [] }); setGroupPhotos({ files: [], captions: [] }); setDraftVisible(false); }}>Buang draf</button></div>}
    <nav aria-label="Langkah pencatatan" className="flex gap-2">{steps.map((label, i) => <button type="button" key={label} disabled={submitting || Boolean(createdBatchId)} aria-current={step === i ? 'step' : undefined} className={`${button} flex-1 text-xs`} onClick={() => navigate(i)}>{label}</button>)}</nav>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {createdBatchId && <p role="status" className="text-sm text-amber-200">Batch {createdBatchId} sudah tersimpan. Coba simpan lagi untuk melanjutkan unggah foto, atau buka <a className="underline" href={`/batches/${createdBatchId}`}>detail batch</a>.</p>}
    {!createdBatchId && <button type="button" className="text-xs text-white/60 min-h-11" onClick={() => { const day = wibDateTimeLocal(new Date()).slice(0, 10); change({ ...defaults(), departedAt: `${day}T07:00`, procuredAt: `${day}T07:20`, arrivedAt: `${day}T07:55`, marketSource: 'Pasar Ciroyom', shrimpType: 'vaname', coolerDeparture: '1', coolerMarket: '2', coolerLab: '3', shrimpCount: '10', totalWeightG: '480', shrimpTemperatures: Array(10).fill('2.5'), shrimpLengths: Array(10).fill('12.5') }); }}>Isi otomatis (data tes)</button>}
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step < 2) navigate(step + 1); else void submit(); }}>
      <fieldset disabled={submitting || Boolean(createdBatchId)} className={card}>
        <legend className="sr-only">{steps[step]}</legend>
        <div hidden={step !== 0} className="grid sm:grid-cols-2 gap-4">
          {field('departedAt', 'Tanggal dan jam berangkat (WIB)', 'datetime-local')}
          {field('coolerDeparture', 'Suhu cool box saat berangkat (°C)', 'number', coolerTempWarning(values.coolerDeparture))}
          {select('sourceType', 'Jenis sumber', [['market', 'Pasar'], ['supermarket', 'Supermarket'], ['farm', 'Tambak']])}
          {field('marketSource', 'Lokasi pembelian')}
        </div>
        <div hidden={step !== 1} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {field('procuredAt', 'Tanggal dan jam beli (WIB)', 'datetime-local')}
            {field('coolerMarket', 'Suhu cool box saat di pasar (°C)', 'number', coolerTempWarning(values.coolerMarket))}
          </div>
          {radio('initialCondition', 'Kondisi awal udang', [['dead', 'Mati saat dibeli'], ['alive', 'Hidup saat dibeli']])}
          <div className="grid sm:grid-cols-2 gap-4">
            {select('shrimpType', 'Jenis Udang', [['', 'Pilih jenis udang'], ...SHRIMP_TYPES.map((t) => [t.value, t.label] as const)])}
            {countField('shrimpCount', 'Jumlah total udang (ekor)', shrimpCountWarning(values.shrimpCount), setCount)}
            {select('visualCheck', 'Temuan visual udang', [['normal', 'Normal'], ['melanosis', 'Melanosis (bintik hitam)'], ['damaged', 'Rusak fisik'], ['mixed_species', 'Campur spesies lain']])}
            {field('totalWeightG', 'Berat total udang saat pembelian (g)', 'number', null, 0, 2000)}
          </div>
          <ShrimpMeasurementFields count={rows} temperatures={values.shrimpTemperatures} lengths={values.shrimpLengths} errors={errors} onChangeRow={setRow} />
          <BatchPhotoPicker key={`batch-${photoKey}`} prefix="photos" title="Foto kondisi awal udang" hint="Dokumentasi saat pembelian." error={errors.photos} onChange={(p) => { dirty.current = true; setBatchPhotos(p); }} />
        </div>
        <div hidden={step !== 2} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <ArrivalFields value={values} errors={errors} onChange={change} />
            {countField('sampleShrimpCountRoomTemp', 'Jumlah udang per sesi suhu ruang (SR) (ekor)', shrimpCountWarning(values.sampleShrimpCountRoomTemp), (value) => change({ sampleShrimpCountRoomTemp: value }))}
            {countField('sampleShrimpCountCold', 'Jumlah udang per sesi suhu dingin (SD) (ekor)', shrimpCountWarning(values.sampleShrimpCountCold), (value) => change({ sampleShrimpCountCold: value }))}
          </div>
          <TransportDurationNote value={values} procuredAt={values.procuredAt} onChange={change} />
          <p className="text-xs font-mono text-white/60">Berat dan suhu udang dicatat pada setiap tahap pengujian. Temuan visual (langkah Kondisi Udang) berlaku untuk kedua grup.</p>
          <BatchPhotoPicker key={`group-${photoKey}`} prefix="groupingPhotos" title="Foto pengelompokan" hint="Dokumentasi batch sebelum pengujian." error={errors.groupingPhotos} onChange={(p) => { dirty.current = true; setGroupPhotos(p); }} />
        </div>
      </fieldset>
      <div className="flex gap-3 mt-4">
        {step > 0 && <button type="button" className={button} disabled={submitting || Boolean(createdBatchId)} onClick={() => navigate(step - 1)}>Kembali</button>}
        <button type="submit" disabled={submitting} className={`${button} flex-1`}>{submitting ? 'Menyimpan…' : step < 2 ? `Lanjut ke ${steps[step + 1]}` : 'Simpan batch'}</button>
      </div>
    </form>
  </div>;
}
export default function NewBatchPage() {
  const { user, isLoading, apiFetch } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && (!user || user.role !== 'ADMIN')) router.replace(user ? '/batches' : '/login'); }, [isLoading, user, router]);
  if (isLoading || !user || user.role !== 'ADMIN') return <p className="p-6 text-white/60">Memuat sesi…</p>;
  return <BatchWizard key={user.id} userId={user.id} apiFetch={apiFetch} />;
}
