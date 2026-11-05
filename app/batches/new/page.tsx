"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import GroupingFields, { type GroupingDraft } from '../../../components/batches/GroupingFields';
import BatchPhotoPicker, { type PhotoGroup } from '../../../components/batches/BatchPhotoPicker';
import { loadBatchDraft, saveBatchDraft, removeBatchDraft } from '../../../lib/batch-draft.ts';
import { validateStepA, validateStepB, validateStepC, stepOfField, wibInputToUtcIso, type WizardErrors } from '../../../lib/batch-wizard.ts';
import { wibDateTimeLocal, MAX_PHOTO_CAPTION_LENGTH } from '../../../shared/dataset.ts';
import { SHRIMP_TYPES } from '../../../shared/shrimp.ts';

interface FormValues extends GroupingDraft {
  departedAt: string; coolerDeparture: string; procuredAt: string;
  marketSource: string; sourceType: string; shrimpType: string;
  shrimpCount: string; shrimpLengthCm: string; totalWeightG: string;
  initialCondition: string; initialTempC: string; coolerMarket: string;
}
const defaults = (): FormValues => ({
  departedAt: wibDateTimeLocal(new Date()), procuredAt: wibDateTimeLocal(new Date()), arrivedAt: wibDateTimeLocal(new Date()),
  coolerDeparture: '', marketSource: '', sourceType: 'market', shrimpType: '', shrimpCount: '12', shrimpLengthCm: '', totalWeightG: '',
  initialCondition: 'dead', initialTempC: '', coolerMarket: '', coolerLab: '', deviationAck: false, visualCheck: 'normal', sampleShrimpCount: '4',
});
const card = 'rounded-2xl bg-white/10 border border-white/20 p-5 md:p-6 space-y-5';
const input = 'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [color-scheme:dark]';
const button = 'min-h-11 px-4 py-3 rounded-xl border border-emerald-400/40 text-emerald-100 bg-emerald-500/20 text-sm font-mono disabled:opacity-50';
const steps = ['Pengadaan', 'Kondisi & Dokumentasi', 'Pengelompokan'];
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function BatchWizard({ userId, apiFetch }: { userId: string; apiFetch: ApiFetch }) {
  const router = useRouter();
  const [draft] = useState(() => loadBatchDraft(userId));
  const [values, setValues] = useState<FormValues>(() => {
    const base = defaults();
    const grouping = draft?.grouping && typeof draft.grouping === 'object' ? draft.grouping as Record<string, unknown> : {};
    const saved = { ...draft, ...grouping } as Record<string, unknown>;
    for (const key of Object.keys(base) as (keyof FormValues)[]) {
      if (key !== 'deviationAck' && typeof saved[key] === 'string') (base as unknown as Record<string, unknown>)[key] = saved[key];
    }
    base.deviationAck = saved.deviationAck === true;
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
      grouping: { visualCheck: values.visualCheck, sampleShrimpCount: values.sampleShrimpCount },
      batchCaptions: batchPhotos.captions, groupingCaptions: groupPhotos.captions,
    }), 800);
    return () => clearTimeout(timer);
  }, [values, step, userId, batchPhotos.captions, groupPhotos.captions, createdBatchId]);
  const change = (patch: Partial<FormValues>) => {
    dirty.current = true;
    setValues((v) => ({ ...v, ...patch }));
    setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !(key in patch))));
  };
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
    setSubmitting(true); setError('');
    try {
      let batchId = createdBatchId;
      if (!batchId) {
        const res = await apiFetch('/api/v1/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          departedAtUtc: wibInputToUtcIso(values.departedAt), procuredAtUtc: wibInputToUtcIso(values.procuredAt), arrivedAtUtc: wibInputToUtcIso(values.arrivedAt),
          marketSource: values.marketSource.trim(), sourceType: values.sourceType, shrimpType: values.shrimpType,
          shrimpCount: Number(values.shrimpCount), shrimpLengthCm: Number(values.shrimpLengthCm), totalWeightG: Number(values.totalWeightG),
          initialCondition: values.initialCondition, initialTempC: Number(values.initialTempC), coolerTempDepartureC: Number(values.coolerDeparture),
          coolerTempMarketC: Number(values.coolerMarket), coolerTempLabC: Number(values.coolerLab), deviationAcknowledged: values.deviationAck,
          grouping: { visualCheck: values.visualCheck, sampleShrimpCount: Number(values.sampleShrimpCount) },
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
  const field = (key: keyof FormValues, label: string, type = 'text', min?: number, max?: number) => <label className="flex flex-col gap-1.5 text-[13px] font-mono text-white/85" htmlFor={key}>
    {label} *<input id={key} required type={type} min={min} max={max} step={key === 'shrimpCount' ? '1' : type === 'number' ? '0.1' : undefined} value={String(values[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${key}-error` : undefined} className={input} />{fieldError(key)}
  </label>;
  const select = (key: keyof FormValues, label: string, options: readonly (readonly [string, string])[]) => <label htmlFor={key} className="flex flex-col gap-1.5 text-[13px] font-mono text-white/85">{label} *<select id={key} required value={String(values[key])} onChange={(e) => change({ [key]: e.target.value })} aria-invalid={!!errors[key]} className={input}>{options.map(([value, text]) => <option key={value} value={value} className="bg-slate-900">{text}</option>)}</select>{fieldError(key)}</label>;
  return <div className="space-y-5 max-w-3xl mx-auto">
    <h2 className="text-2xl font-mono font-bold text-white">Batch baru</h2>
    <p className="text-xs font-mono text-white/60">Langkah {step + 1} dari 3. Tanda * berarti wajib diisi. Semua waktu dalam WIB.</p>
    {draftVisible && <div className={card}><p className="text-xs text-cyan-200">Draf dipulihkan. Pilih ulang berkas foto. Caption sebelumnya: {[...(draft?.batchCaptions ?? []), ...(draft?.groupingCaptions ?? [])].join(' · ') || '—'}</p><button type="button" className={button} onClick={() => { dirty.current = false; removeBatchDraft(); setValues(defaults()); setStep(0); setPhotoKey((v) => v + 1); setBatchPhotos({ files: [], captions: [] }); setGroupPhotos({ files: [], captions: [] }); setDraftVisible(false); }}>Buang draf</button></div>}
    <nav aria-label="Langkah pencatatan" className="flex gap-2">{steps.map((label, i) => <button type="button" key={label} disabled={submitting || Boolean(createdBatchId)} aria-current={step === i ? 'step' : undefined} className={`${button} flex-1 text-xs`} onClick={() => navigate(i)}>{label}</button>)}</nav>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {createdBatchId && <p role="status" className="text-sm text-amber-200">Batch {createdBatchId} sudah tersimpan. Coba simpan lagi untuk melanjutkan unggah foto, atau buka <a className="underline" href={`/batches/${createdBatchId}`}>detail batch</a>.</p>}
    {!createdBatchId && <button type="button" className="text-xs text-white/60 min-h-11" onClick={() => { const day = wibDateTimeLocal(new Date()).slice(0, 10); change({ ...defaults(), departedAt: `${day}T07:00`, procuredAt: `${day}T07:20`, arrivedAt: `${day}T07:55`, marketSource: 'Pasar Ciroyom', shrimpType: 'vaname', coolerDeparture: '1', coolerMarket: '2', coolerLab: '3', shrimpLengthCm: '12.5', totalWeightG: '480', initialTempC: '2.5' }); }}>Isi otomatis (data tes)</button>}
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (step < 2) navigate(step + 1); else void submit(); }}>
      <fieldset disabled={submitting || Boolean(createdBatchId)} className={card}>
        <legend className="sr-only">{steps[step]}</legend>
        <div hidden={step !== 0} className="grid sm:grid-cols-2 gap-4">
          {field('departedAt', 'Tanggal dan jam berangkat (WIB)', 'datetime-local')}
          {field('coolerDeparture', 'Suhu cool box saat berangkat (°C)', 'number', -10, 10)}
          {select('sourceType', 'Jenis sumber', [['market', 'Pasar'], ['supermarket', 'Supermarket'], ['farm', 'Tambak']])}
          {field('marketSource', 'Lokasi pembelian')}
        </div>
        <div hidden={step !== 1} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {field('procuredAt', 'Tanggal dan jam beli (WIB)', 'datetime-local')}
            {field('coolerMarket', 'Suhu cool box saat di pasar (°C)', 'number', -10, 10)}
            {select('initialCondition', 'Kondisi awal udang', [['dead', 'Mati saat dibeli'], ['alive', 'Hidup saat dibeli']])}
            {select('shrimpType', 'Jenis Udang', [['', 'Pilih jenis udang'], ...SHRIMP_TYPES.map((t) => [t.value, t.label] as const)])}
            {field('shrimpCount', 'Jumlah total udang (ekor)', 'number', 10)}
            {field('totalWeightG', 'Berat total udang saat pembelian (g)', 'number', 0, 2000)}
            {field('initialTempC', 'Suhu awal udang saat pembelian (°C)', 'number', -10, 10)}
            {field('shrimpLengthCm', 'Panjang udang (cm)', 'number', 1, 50)}
          </div>
          <BatchPhotoPicker key={`batch-${photoKey}`} prefix="photos" title="Foto kondisi awal udang" hint="Dokumentasi saat pembelian." error={errors.photos} onChange={(p) => { dirty.current = true; setBatchPhotos(p); }} />
        </div>
        <div hidden={step !== 2} className="space-y-4">
          <GroupingFields value={values} procuredAt={values.procuredAt} errors={errors} onChange={change} />
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
