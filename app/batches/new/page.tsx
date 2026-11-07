"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import ArrivalFields, { TransportDurationNote } from '../../../components/batches/ArrivalFields';
import ShrimpMeasurementFields from '../../../components/batches/ShrimpMeasurementFields';
import BatchPhotoPicker, { type PhotoGroup } from '../../../components/batches/BatchPhotoPicker';
import {
  DraftConflictError,
  createDraft,
  discardDraft,
  draftAgeText,
  consumeDraft,
  listDrafts,
  updateDraft,
  type ApiFetch,
  type DraftRecord,
} from '../../../lib/batch-draft.ts';
import type { DraftPayload } from '../../../shared/batch-draft.ts';
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

/** Ambil hanya string dari payload draf (isian draf tidak dipercaya mentah). */
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Samakan panjang daftar pengukuran dengan jumlah ekor tanpa membuang isian yang ada. */
function resizeRows(rows: readonly string[], count: number): string[] {
  const next = rows.slice(0, count);
  while (next.length < count) next.push('');
  return next;
}

/**
 * Isian form → payload draf. Hanya field yang dikenal kontrak `DraftPayload`
 * (lihat shared/batch-draft.ts); server menyaring ulang, jadi field asing tidak
 * pernah tersimpan.
 */
function valuesToPayload(
  values: FormValues,
  batchCaptions: string[],
  groupingCaptions: string[]
): DraftPayload {
  return {
    departedAt: values.departedAt,
    coolerDeparture: values.coolerDeparture,
    procuredAt: values.procuredAt,
    arrivedAt: values.arrivedAt,
    marketSource: values.marketSource,
    sourceType: values.sourceType,
    shrimpType: values.shrimpType,
    shrimpCount: values.shrimpCount,
    totalWeightG: values.totalWeightG,
    initialCondition: values.initialCondition,
    visualCheck: values.visualCheck,
    coolerMarket: values.coolerMarket,
    coolerLab: values.coolerLab,
    sampleShrimpCountRoomTemp: values.sampleShrimpCountRoomTemp,
    sampleShrimpCountCold: values.sampleShrimpCountCold,
    shrimpTemperatures: values.shrimpTemperatures,
    shrimpLengths: values.shrimpLengths,
    deviationAck: values.deviationAck,
    batchCaptions,
    groupingCaptions,
  };
}

/** Payload draf → isian form, dengan nilai bawaan untuk field yang tidak ada. */
function valuesFromPayload(payload: DraftPayload): FormValues {
  const base = defaults();
  const saved = payload as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof FormValues)[]) {
    if (key === 'deviationAck' || key === 'shrimpTemperatures' || key === 'shrimpLengths') continue;
    if (typeof saved[key] === 'string') (base as unknown as Record<string, unknown>)[key] = saved[key];
  }
  base.deviationAck = saved.deviationAck === true;
  base.shrimpTemperatures = stringArray(saved.shrimpTemperatures);
  base.shrimpLengths = stringArray(saved.shrimpLengths);
  return base;
}

function BatchWizard({ apiFetch }: { apiFetch: ApiFetch }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(defaults);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<WizardErrors>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  const [batchPhotos, setBatchPhotos] = useState<PhotoGroup>({ files: [], captions: [] });
  const [groupPhotos, setGroupPhotos] = useState<PhotoGroup>({ files: [], captions: [] });
  const [uploaded, setUploaded] = useState({ batch: false, grouping: false });
  const [photoKey, setPhotoKey] = useState(0);

  // Draf di server: daftar draf terbuka akun ini (dibuat operator/perangkat
  // mana pun) + draf yang sedang diedit di sini beserta nomor versinya.
  const [drafts, setDrafts] = useState<DraftRecord[] | null>(null);
  const [activeDraft, setActiveDraft] = useState<DraftRecord | null>(null);
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const dirty = useRef(false);
  const savingDraft = useRef(false);

  // Muat daftar draf sekali saat halaman dibuka.
  useEffect(() => {
    let alive = true;
    listDrafts(apiFetch)
      .then((rows) => {
        if (alive) setDrafts(rows);
      })
      .catch(() => {
        if (alive) setDrafts([]);
      });
    return () => {
      alive = false;
    };
  }, [apiFetch]);

  /**
   * Menyimpan draf (dibuat saat isian pertama berubah, lalu diperbarui dengan
   * optimistis memakai versi terakhir). `dirty` dimatikan setelah berhasil,
   * jadi tidak ada penyimpanan berulang tanpa perubahan.
   */
  const flushDraft = useCallback(async () => {
    if (!dirty.current || createdBatchId || savingDraft.current || draftState === 'conflict') return;
    savingDraft.current = true;
    setDraftState('saving');
    try {
      const payload = valuesToPayload(values, batchPhotos.captions, groupPhotos.captions);
      const saved = activeDraft
        ? await updateDraft(apiFetch, activeDraft.id, { payload, step, version: activeDraft.version })
        : await createDraft(apiFetch, payload, step);
      dirty.current = false;
      setActiveDraft(saved);
      setDraftState('saved');
      setDraftNote(null);
      setDrafts((prev) => {
        const rest = (prev ?? []).filter((row) => row.id !== saved.id);
        return [saved, ...rest];
      });
    } catch (err) {
      if (err instanceof DraftConflictError) {
        setDraftState('conflict');
        setDraftNote(
          `Draf sudah diperbarui di perangkat lain (${err.ownerOperator ?? 'operator lain'} · ${err.ownerDevice ?? 'perangkat lain'}). ` +
            'Muat versi terbaru atau buang perubahan di sini — perubahan tidak ditimpa otomatis.'
        );
      } else {
        setDraftState('error');
        setDraftNote(err instanceof Error ? err.message : 'Gagal menyimpan draf.');
      }
    } finally {
      savingDraft.current = false;
    }
  }, [activeDraft, apiFetch, batchPhotos.captions, createdBatchId, draftState, groupPhotos.captions, step, values]);

  useEffect(() => {
    if (!dirty.current || createdBatchId) return;
    const timer = setTimeout(() => {
      void flushDraft();
    }, 800);
    return () => clearTimeout(timer);
  }, [values, step, createdBatchId, batchPhotos.captions, groupPhotos.captions, flushDraft]);

  /** Melanjutkan draf yang sudah ada (dari perangkat ini maupun perangkat lain). */
  const resumeDraft = (record: DraftRecord) => {
    setActiveDraft(record);
    setValues(valuesFromPayload(record.payload));
    setStep(Math.min(2, Math.max(0, record.step)));
    setErrors({});
    setError('');
    dirty.current = false;
    setDraftState('idle');
    setDraftNote(null);
    setPhotoKey((v) => v + 1);
    setBatchPhotos({ files: [], captions: stringArray(record.payload.batchCaptions) });
    setGroupPhotos({ files: [], captions: stringArray(record.payload.groupingCaptions) });
  };

  /** Mulai isian kosong; draf lama tetap tersimpan sampai dibuang. */
  const startFresh = () => {
    setActiveDraft(null);
    setValues(defaults());
    setStep(0);
    setErrors({});
    setError('');
    dirty.current = false;
    setDraftState('idle');
    setDraftNote(null);
    setPhotoKey((v) => v + 1);
    setBatchPhotos({ files: [], captions: [] });
    setGroupPhotos({ files: [], captions: [] });
  };

  const discard = async (record: DraftRecord | null) => {
    if (record) {
      try {
        await discardDraft(apiFetch, record.id);
      } catch {
        // Draf mungkin sudah dibuang perangkat lain; lanjutkan saja.
      }
      setDrafts((prev) => (prev ?? []).filter((row) => row.id !== record.id));
    }
    if (!record || record.id === activeDraft?.id) startFresh();
  };

  /** Mengambil versi terbaru draf dari server setelah konflik versi. */
  const reloadDraft = async () => {
    if (!activeDraft) return;
    try {
      const rows = await listDrafts(apiFetch);
      setDrafts(rows);
      const fresh = rows.find((row) => row.id === activeDraft.id);
      if (fresh) resumeDraft(fresh);
      else {
        setDraftState('error');
        setDraftNote('Draf ini sudah tidak ada — mungkin sudah menjadi batch atau dibuang di perangkat lain.');
      }
    } catch (err) {
      setDraftNote(err instanceof Error ? err.message : 'Gagal memuat draf terbaru.');
    }
  };

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
        setCreatedBatchId(batchId);
        // Draf menjadi batch: ditandai, bukan dihapus, supaya rantai
        // "draf → batch" tetap bisa ditelusuri kalau ada pertanyaan belakangan.
        if (activeDraft) {
          void consumeDraft(apiFetch, activeDraft.id, batchId).catch(() => {});
        }
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
    <p role="status" className="text-[11px] font-mono text-white/45 min-h-4">
      {draftState === 'saving'
        ? 'Menyimpan draf ke server…'
        : draftState === 'saved' && activeDraft
          ? `Draf tersimpan di server · ${draftAgeText(activeDraft.updatedAt)} — bisa dilanjutkan dari perangkat lain.`
          : !createdBatchId
            ? 'Isian disimpan otomatis ke server setelah Anda mulai mengisi.'
            : ''}
    </p>
    {draftNote && (
      <div className={card} role="alert">
        <p className="text-xs font-mono text-amber-200">{draftNote}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {draftState === 'conflict' && (
            <button type="button" className={`${button} !min-h-9 !py-1.5 !px-3 text-xs`} onClick={() => void reloadDraft()}>
              Muat versi terbaru
            </button>
          )}
          {draftState === 'error' && (
            <button
              type="button"
              className={`${button} !min-h-9 !py-1.5 !px-3 text-xs`}
              onClick={() => {
                dirty.current = true;
                void flushDraft();
              }}
            >
              Coba simpan lagi
            </button>
          )}
          <button
            type="button"
            className={`${button} !min-h-9 !py-1.5 !px-3 text-xs`}
            onClick={() => void discard(activeDraft)}
          >
            Buang draf ini
          </button>
        </div>
      </div>
    )}
    {!createdBatchId && drafts && drafts.length > 0 && (
      <div className={card} role="region" aria-label="Draf tersimpan">
        <p className="text-xs font-mono font-semibold text-cyan-200">
          {drafts.length} draf tersimpan di server — bisa dilanjutkan dari perangkat mana pun.
        </p>
        <ul className="space-y-2">
          {drafts.slice(0, 5).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 border border-white/10 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block text-[12px] font-mono text-white truncate">
                  {row.label}
                  {activeDraft?.id === row.id ? ' · sedang dibuka' : ''}
                </span>
                <span className="block text-[10px] font-mono text-white/50">
                  {row.ownerOperator} · {row.ownerDevice ?? 'perangkat lain'} · {draftAgeText(row.updatedAt)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => resumeDraft(row)}
                  className={`${button} !min-h-9 !py-1.5 !px-3 text-xs`}
                >
                  {activeDraft?.id === row.id ? 'Muat ulang' : 'Lanjutkan'}
                </button>
                <button
                  type="button"
                  onClick={() => void discard(row)}
                  className="text-[11px] font-mono text-rose-300 px-2 min-h-9"
                >
                  Buang
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] font-mono text-white/45">
          Perubahan tersimpan otomatis ke server. Foto tetap perlu dipilih ulang setelah melanjutkan di
          perangkat lain; caption-nya ikut tersimpan.
        </p>
        {activeDraft && (
          <button type="button" onClick={startFresh} className="text-[11px] font-mono text-cyan-200">
            Mulai isian baru (draf lama tetap tersimpan)
          </button>
        )}
      </div>
    )}
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
  return <BatchWizard apiFetch={apiFetch} />;
}
