"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import {
  loadBatchDraft,
  saveBatchDraft,
  removeBatchDraft,
  draftMeaningful,
} from '../../../lib/batch-draft.ts';
import {
  COOLER_TEMP_MAX_C,
  COOLER_TEMP_MIN_C,
  INITIAL_TEMP_MAX_C,
  INITIAL_TEMP_MIN_C,
  MAX_PHOTO_CAPTION_LENGTH,
  formatWibDateTime,
  wibDateTimeLocal,
} from '../../../shared/dataset.ts';
import {
  parseWibInput,
  stepOfField,
  validateGroupForm,
  validateStepA as validateWizardStepA,
  validateStepB as validateWizardStepB,
  wibInputToUtcIso,
  type WizardErrors,
} from '../../../lib/batch-wizard.ts';
import SuccessNotice, { useSuccessNotice } from '../../../components/ui/SuccessNotice';

const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[13px] font-mono font-semibold text-white/85';
// Penanda visual field wajib (bintang merah, disembunyikan dari pembaca layar;
// inputnya sendiri memakai aria-required).
const reqMark = (
  <span aria-hidden="true" className="text-rose-400">
    {' *'}
  </span>
);
const hintCls = 'text-xs font-mono text-white/70';
const inputCls =
  'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400/60 focus-visible:ring-2 focus-visible:ring-emerald-400/50 [color-scheme:dark] [tabular-nums]';
const inputErrCls =
  'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-rose-400/60 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-rose-300 focus-visible:ring-2 focus-visible:ring-rose-300/50 [color-scheme:dark] [tabular-nums]';
const cardCls = 'flex flex-col gap-5 p-5 md:p-6 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20';
const btnPrimary =
  'w-full py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-sm font-mono font-bold tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70';
const btnBack =
  'flex-1 py-3 rounded-xl bg-transparent hover:bg-white/10 border border-white/15 text-white/70 text-sm font-mono font-bold transition-colors touch-manipulation disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
const stepBtn =
  'flex-1 px-2 py-2.5 min-h-[44px] rounded-xl font-mono text-xs font-bold border transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60';
const btnGhost =
  'px-3 py-1.5 min-h-[44px] rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/60 hover:text-white text-[11px] font-mono transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

// Alat bantu tes fitur: isi otomatis seluruh form dengan nilai realistis.
// Matikan (ganti ke false) saat pengujian sesungguhnya agar tombolnya
// tidak muncul.
const AUTO_FILL_ENABLED = true;

interface GroupForm {
  labTempC: string;
  visualCheck: string;
  labWeightBeforeG: string;
  labWeightAfterG: string;
  sampleShrimpCount: string;
  /** Butir 1: hanya berarti bagi grup dingin; grup ruang selalu chamber (tanpa chamber aktif). */
  coldStorageMode: 'chamber' | 'plain_fridge';
}

const emptyGroup = (): GroupForm => ({
  labTempC: '',
  visualCheck: 'normal',
  labWeightBeforeG: '',
  labWeightAfterG: '',
  sampleShrimpCount: '4',
  coldStorageMode: 'chamber',
});

/** Jeda penulisan draf setelah isian terakhir (ms). */
const DRAFT_SAVE_DEBOUNCE_MS = 800;

/** Keadaan form yang disimpan sebagai draf. */
interface DraftState {
  step: number;
  departedAt: string;
  coolerDeparture: string;
  procuredAt: string;
  arrivedAt: string;
  marketSource: string;
  sourceType: string;
  shrimpCount: string;
  shrimpLengthCm: string;
  totalWeightG: string;
  initialCondition: string;
  initialTempC: string;
  coolerMarket: string;
  coolerLab: string;
  deviationAck: boolean;
  groupSR: GroupForm;
  groupSD: GroupForm;
  batchCaptions: string[];
  groupCaptionsSr: string[];
  groupCaptionsSd: string[];
}

/** True bila form masih pada nilai bawaan (waktu otomatis jam device diabaikan). */
const formIsPristine = (s: DraftState): boolean => {
  const groupPristine = (g: GroupForm): boolean =>
    g.labTempC.trim() === '' &&
    g.visualCheck === 'normal' &&
    g.labWeightBeforeG.trim() === '' &&
    g.labWeightAfterG.trim() === '' &&
    g.sampleShrimpCount === '4' &&
    g.coldStorageMode === 'chamber';
  return (
    s.marketSource.trim() === '' &&
    s.sourceType === 'market' &&
    s.coolerDeparture.trim() === '' &&
    s.shrimpCount === '12' &&
    s.shrimpLengthCm.trim() === '' &&
    s.totalWeightG.trim() === '' &&
    s.initialCondition === 'dead' &&
    s.initialTempC.trim() === '' &&
    s.coolerMarket.trim() === '' &&
    s.coolerLab.trim() === '' &&
    !s.deviationAck &&
    groupPristine(s.groupSR) &&
    groupPristine(s.groupSD) &&
    s.batchCaptions.every((c) => c.trim() === '') &&
    s.groupCaptionsSr.every((c) => c.trim() === '') &&
    s.groupCaptionsSd.every((c) => c.trim() === '')
  );
};

/** Ambil daftar caption yang utuh dari draf; bentuk rusak diabaikan. */
const captionList = (saved: unknown): string[] =>
  Array.isArray(saved)
    ? saved.filter((c): c is string => typeof c === 'string')
    : [];

/** Bangun ulang form grup dari draf tersimpan; nilai tak dikenal diabaikan. */
const groupFromDraft = (saved: unknown): GroupForm => {
  const base = emptyGroup();
  if (typeof saved !== 'object' || saved === null) {
    return base;
  }
  const s = saved as Record<string, unknown>;
  for (const k of ['labTempC', 'visualCheck', 'labWeightBeforeG', 'labWeightAfterG', 'sampleShrimpCount'] as const) {
    if (typeof s[k] === 'string') {
      base[k] = s[k];
    }
  }
  if (s.coldStorageMode === 'chamber' || s.coldStorageMode === 'plain_fridge') {
    base.coldStorageMode = s.coldStorageMode;
  }
  return base;
};

/** Paket foto siap unggah: berkas + caption per tujuan (butir 2). */
interface PhotoGroup {
  files: File[];
  captions: string[];
}

const emptyPhotoGroup = (): PhotoGroup => ({ files: [], captions: [] });

const photoFileCls =
  'text-xs font-mono text-white/60 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:bg-white/10 file:border file:border-white/10 file:text-white/80 file:text-xs file:font-mono';
const photoRemoveCls =
  // 32px: tombol hapus menempel di sudut pratinjau — 44px akan menutupi thumbnail
  // tetangga; 32px masih memenuhi WCAG 2.5.8 (target minimal 24px).
  'absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500/90 text-white text-[12px] font-bold leading-none flex items-center justify-center hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200';

/**
 * Pemilih foto wizard (butir 2): mengelola pratinjaunya sendiri lalu melapor
 * berkas + caption ke induk lewat onChange. Aturan file mengikuti foto batch:
 * JPG/PNG sampai 5 MB, tiap foto wajib ber-caption.
 */
function PhotosBlock({
  prefix,
  title,
  hint,
  error,
  onChange,
}: {
  prefix: string;
  title: string;
  hint: string;
  error?: string;
  onChange: (photos: PhotoGroup) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [captions, setCaptions] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const select = (list: FileList | null, input: HTMLInputElement) => {
    const incoming = Array.from(list ?? []);
    const usable = incoming.filter((f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0);
    const fitting = usable.filter((f) => f.size <= 5 * 1024 * 1024);
    if (usable.length < incoming.length) {
      setNote('Hanya file JPG/PNG yang dipakai. File lain dilewati.');
    } else if (fitting.length < usable.length) {
      setNote('Tiap foto maksimal 5 MB. File lebih besar dilewati.');
    } else {
      setNote('');
    }
    const nextFiles = [...files, ...fitting];
    const nextCaptions = [...captions, ...fitting.map(() => '')];
    setFiles(nextFiles);
    setPreviews((prev) => [...prev, ...fitting.map((f) => URL.createObjectURL(f))]);
    setCaptions(nextCaptions);
    onChange({ files: nextFiles, captions: nextCaptions });
    input.value = '';
  };

  const remove = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    const nextFiles = files.filter((_, i) => i !== index);
    const nextCaptions = captions.filter((_, i) => i !== index);
    setPreviews(previews.filter((_, i) => i !== index));
    setFiles(nextFiles);
    setCaptions(nextCaptions);
    onChange({ files: nextFiles, captions: nextCaptions });
  };

  const setCaption = (index: number, value: string) => {
    const next = captions.map((c, j) => (j === index ? value : c));
    setCaptions(next);
    onChange({ files, captions: next });
  };

  return (
    <div className={fieldCls}>
      <label className={labelCls} htmlFor={`${prefix}-photos`}>
        {title}
      </label>
      <input
        id={`${prefix}-photos`}
        name={`${prefix}-photos`}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        multiple
        onChange={(e) => select(e.target.files, e.target)}
        className={photoFileCls}
      />
      <p className={hintCls}>{hint}</p>
      {note && !error ? (
        <p className="text-[11px] font-mono text-amber-300" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] font-mono text-amber-300" role="status">
          {error}
        </p>
      ) : null}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {previews.map((src, i) => (
            <div key={src} className="relative space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Pratinjau foto ${i + 1}`} className="w-full h-16 object-cover rounded-lg border border-white/10" />
              <label className={`${labelCls} flex items-center gap-1`} htmlFor={`${prefix}-photo-caption-${i}`}>
                Caption <span aria-hidden="true" className="text-rose-400">*</span>
              </label>
              <input
                id={`${prefix}-photo-caption-${i}`}
                name={`${prefix}-photo-caption-${i}`}
                type="text"
                maxLength={MAX_PHOTO_CAPTION_LENGTH}
                autoComplete="off"
                value={captions[i] ?? ''}
                aria-required="true"
                onChange={(e) => setCaption(i, e.target.value)}
                placeholder="Di pasar…"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Hapus foto ${i + 1}`}
                className={photoRemoveCls}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const durationFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

type Errors = WizardErrors;

/** Fetch ber-CSRF milik sesi; diteruskan dari AuthProvider. */
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function BatchWizardForm({ userId, apiFetch }: { userId: string; apiFetch: ApiFetch }) {
  const router = useRouter();
  // Butir 13: draf dibaca sekali saat form dimuat — draf milik akun lain
  // diabaikan oleh lib, draf kedaluwarsa dibuang.
  const draft = useMemo(() => loadBatchDraft(userId) ?? {}, [userId]);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const skipDraftSave = useRef(false);
  /** Nilai teks dari draf bila bentuknya cocok — draf rusak aman diabaikan. */
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  const [step, setStep] = useState(() =>
    typeof draft.step === 'number' && draft.step >= 0 && draft.step <= 2 ? draft.step : 0
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const { message: notice, notify, dismiss } = useSuccessNotice();

  // Tahap A — keberangkatan
  // Butir 5: waktu berangkat/beli/tiba mulai terisi dari jam device (peramban)
  // saat halaman dibuka; tetap dapat diedit manual sebelum disimpan.
  const [departedAt, setDepartedAt] = useState(() =>
    str(draft.departedAt, wibDateTimeLocal(new Date()))
  );
  const [procuredAt, setProcuredAt] = useState(() =>
    str(draft.procuredAt, wibDateTimeLocal(new Date()))
  );
  const [marketSource, setMarketSource] = useState(() => str(draft.marketSource, ''));
  const [sourceType, setSourceType] = useState(() => str(draft.sourceType, 'market'));
  const [shrimpCount, setShrimpCount] = useState(() => str(draft.shrimpCount, '12'));
  const [shrimpLengthCm, setShrimpLengthCm] = useState(() => str(draft.shrimpLengthCm, ''));
  const [totalWeightG, setTotalWeightG] = useState(() => str(draft.totalWeightG, ''));
  const [initialCondition, setInitialCondition] = useState(() => str(draft.initialCondition, 'dead'));
  const [initialTempC, setInitialTempC] = useState(() => str(draft.initialTempC, ''));
  // Tahap A — pengadaan: beli, tiba, sumber (butir 12).
  const [arrivedAt, setArrivedAt] = useState(() =>
    str(draft.arrivedAt, wibDateTimeLocal(new Date()))
  );
  // Revisi: tiga suhu cool box — saat berangkat, di pasar, dan di lab.
  // Nilai default kolom lama (min/max) tetap dipertahankan sebagai asal data.
  const [coolerDeparture, setCoolerDeparture] = useState(() => str(draft.coolerDeparture, ''));
  const [coolerMarket, setCoolerMarket] = useState(() => str(draft.coolerMarket, ''));
  const [coolerLab, setCoolerLab] = useState(() => str(draft.coolerLab, ''));
  const [deviationAck, setDeviationAck] = useState(
    () => (typeof draft.deviationAck === 'boolean' ? draft.deviationAck : false)
  );
  // Foto kondisi awal (diunggah setelah batch dibuat). Berkas foto tidak ikut
  // draf; captionnya dipertahankan agar tidak perlu diketik ulang.
  const [batchPhotos, setBatchPhotos] = useState<PhotoGroup>(() => ({
    ...emptyPhotoGroup(),
    captions: captionList(draft.batchCaptions),
  }));
  const [groupPhotos, setGroupPhotos] = useState<{ sr: PhotoGroup; sd: PhotoGroup }>({
    sr: { ...emptyPhotoGroup(), captions: captionList(draft.groupCaptionsSr) },
    sd: { ...emptyPhotoGroup(), captions: captionList(draft.groupCaptionsSd) },
  });
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  // Tahap C — grup SR/SD (nilai awal dari draf bila ada)
  const [groupSR, setGroupSR] = useState<GroupForm>(() => groupFromDraft(draft.groupSr));
  const [groupSD, setGroupSD] = useState<GroupForm>(() => groupFromDraft(draft.groupSd));

  /** Caption foto yang tersimpan di draf — ditampilkan di banner pemulihan. */
  const restoredCaptions = useMemo(
    () =>
      [draft.batchCaptions, draft.groupCaptionsSr, draft.groupCaptionsSd]
        .flatMap((c) => captionList(c))
        .filter((c) => c.trim() !== ''),
    [draft]
  );

  // Butir 13: autosave draf dengan debounce — satu tulis beberapa detik
  // setelah isian terakhir, bukan satu tulis per ketikan. Run pertama
  // dilewati: draf hanya dibuat setelah pengguna menyentuh form.
  const firstDraftRun = useRef(true);
  useEffect(() => {
    if (firstDraftRun.current) {
      firstDraftRun.current = false;
      return;
    }
    if (skipDraftSave.current) {
      // Baru saja buang draf: jangan langsung tulis ulang isinya.
      skipDraftSave.current = false;
      return;
    }
    const state: DraftState = {
      step,
      departedAt,
      coolerDeparture,
      procuredAt,
      arrivedAt,
      marketSource,
      sourceType,
      shrimpCount,
      shrimpLengthCm,
      totalWeightG,
      initialCondition,
      initialTempC,
      coolerMarket,
      coolerLab,
      deviationAck,
      groupSR,
      groupSD,
      batchCaptions: batchPhotos.captions,
      groupCaptionsSr: groupPhotos.sr.captions,
      groupCaptionsSd: groupPhotos.sd.captions,
    };
    const timer = setTimeout(() => {
      if (formIsPristine(state)) {
        // Form kembali ke nilai bawaan — tak ada yang perlu disimpan.
        removeBatchDraft();
        return;
      }
      saveBatchDraft({
        step,
        departedAt,
        coolerDeparture,
        procuredAt,
        arrivedAt,
        marketSource,
        sourceType,
        shrimpCount,
        shrimpLengthCm,
        totalWeightG,
        initialCondition,
        initialTempC,
        coolerMarket,
        coolerLab,
        deviationAck,
        groupSr: groupSR,
        groupSd: groupSD,
        userId,
        batchCaptions: batchPhotos.captions,
        groupCaptionsSr: groupPhotos.sr.captions,
        groupCaptionsSd: groupPhotos.sd.captions,
      });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    step,
    departedAt,
    coolerDeparture,
    procuredAt,
    arrivedAt,
    marketSource,
    sourceType,
    shrimpCount,
    shrimpLengthCm,
    totalWeightG,
    initialCondition,
    initialTempC,
    coolerMarket,
    coolerLab,
    deviationAck,
    groupSR,
    groupSD,
    batchPhotos.captions,
    groupPhotos.sr.captions,
    groupPhotos.sd.captions,
    userId,
  ]);

  const setSR = (v: GroupForm) => {
    setGroupSR(v);
  };
  const setSD = (v: GroupForm) => {
    setGroupSD(v);
  };

  const changeInitialTempC = (v: string) => {
    setInitialTempC(v);
  };

  /**
   * Isi seluruh form (pengadaan → kelompok) dengan
   * nilai yang realistis dan saling konsisten, agar alur fitur
   * bisa diuji tanpa mengetar satu per satu. Foto tidak diisi:
   * file asli tidak bisa dibuang-buang, jadi tetap dipilih manual.
   */
  /** Butir 13: buang draf tersimpan dan kembalikan form ke nilai awal. */
  const discardDraft = () => {
    const now = wibDateTimeLocal(new Date());
    removeBatchDraft();
    skipDraftSave.current = true;
    setDraftDismissed(true);
    setStep(0);
    setDepartedAt(now);
    setProcuredAt(now);
    setArrivedAt(now);
    setMarketSource('');
    setSourceType('market');
    setShrimpCount('12');
    setShrimpLengthCm('');
    setTotalWeightG('');
    setInitialCondition('dead');
    setInitialTempC('');
    setCoolerDeparture('');
    setCoolerMarket('');
    setCoolerLab('');
    setDeviationAck(false);
    setGroupSR(emptyGroup());
    setGroupSD(emptyGroup());
    setFieldErrors({});
    notify('Draf dibuang — form kembali kosong.');
  };

  const fillTestData = () => {
    // Tanggal kalender WIB hari ini (UTC+7).
    const wibDate = wibDateTimeLocal(new Date()).slice(0, 10);
    // Berangkat 07:00 → beli 07:20 (dalam jendela 05:00–08:00) →
    // tiba kembali di lab 07:55 (perjalanan 35 menit).
    const departed = `${wibDate}T07:00`;
    const procured = `${wibDate}T07:20`;

    // Isi ulang berarti mengganti seluruh form.
    setDeviationAck(false);

    // Tahap A — keberangkatan & sumber
    setDepartedAt(departed);
    setCoolerDeparture('1.0');
    setMarketSource('Pasar Ciroyom');
    setSourceType('market');

    // Tahap B — pembelian, kedatangan, kondisi, dokumentasi
    setProcuredAt(procured);
    setArrivedAt(`${wibDate}T07:55`);
    setShrimpCount('12');
    setShrimpLengthCm('12.5'); // panjang representatif saat beli
    setTotalWeightG('480');
    setInitialCondition('dead');
    setInitialTempC('2.5'); // udang baru dibeli, masih ada esnya
    setCoolerMarket('1.2');
    setCoolerLab('3.6');
    // Tahap C — kelompok SR (suhu ruang) dan SD (dingin)
    setGroupSR({
      labTempC: '6.4',
      visualCheck: 'normal',
      labWeightBeforeG: '472',
      labWeightAfterG: '468.5',
      sampleShrimpCount: '4',
      coldStorageMode: 'chamber',
    });
    setGroupSD({
      labTempC: '6.4',
      visualCheck: 'normal',
      labWeightBeforeG: '472',
      labWeightAfterG: '469.2',
      sampleShrimpCount: '4',
      coldStorageMode: 'chamber',
    });
    setFieldErrors({});
    notify('Form terisi data tes — periksa dulu sebelum Simpan batch.');
  };

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  // Durasi dihitung dari nilai WIB yang sama dengan yang divalidasi dan disimpan.
  const durationHours = (() => {
    const proc = parseWibInput(procuredAt);
    const arr = parseWibInput(arrivedAt);
    if (!proc.date || !arr.date) return null;
    return (arr.date.getTime() - proc.date.getTime()) / 3_600_000;
  })();
  const overDuration = durationHours !== null && durationHours > 3;

  // ---------- validasi per tahap (cermin server, pesan Indonesia) ----------
  // Aturannya tinggal di lib/batch-wizard.ts: fungsi murni yang punya test unit.

  const validateStepA = (): Errors =>
    validateWizardStepA({ departedAt, coolerDeparture, marketSource, sourceType });

  // Tahap B — pembelian, kedatangan, kondisi udang, cool box, dan foto (butir 12).
  const validateStepB = (): Errors =>
    validateWizardStepB({
      departedAt,
      procuredAt,
      arrivedAt,
      shrimpCount,
      shrimpLengthCm,
      totalWeightG,
      initialTempC,
      coolerMarket,
      coolerLab,
      deviationAck,
    });

  const validateGroup = (prefix: 'sr' | 'sd', g: GroupForm): Errors =>
    validateGroupForm(prefix, g);

  const validateStepC = (): Errors => ({
    ...validateGroup('sr', groupSR),
    ...validateGroup('sd', groupSD),
  });

  const validators = [validateStepA, validateStepB, validateStepC];

  const focusFirstError = (errs: Errors) => {
    const first = Object.keys(errs)[0];
    if (!first) {
      return;
    }
    // Bila galat memicu pindah langkah, field target baru ada setelah re-render
    // React; jadwalkan fokus setelah paint agar getElementById tidak gagal senyap.
    requestAnimationFrame(() => {
      document.getElementById(first)?.focus();
    });
  };

  /** Pindah tahap hanya bila semua tahap sebelumnya valid (GATE inline). */
  const goToStep = (next: number) => {
    if (next <= step) {
      setFieldErrors({});
      setStep(next);
      return;
    }
    for (let i = step; i < next; i += 1) {
      const errs = validators[i]();
      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs);
        setStep(i);
        focusFirstError(errs);
        return;
      }
    }
    setFieldErrors({});
    setStep(next);
  };

  /** Validasi ulang instan: tiap ketikan membersihkan error field itu bila sudah benar. */
  const revalidateLive = (nextStep: number, errs: Errors) => {
    if (Object.keys(fieldErrors).length === 0) return;
    const fresh = validators[nextStep]();
    const merged = { ...fieldErrors };
    for (const key of Object.keys(errs)) {
      if (!fresh[key]) {
        delete merged[key];
      }
    }
    setFieldErrors(merged);
  };

  const errMsgCls = 'text-[11px] font-mono text-rose-300';
  const fieldMessage = (key: string) =>
    fieldErrors[key] ? (
      <p className={errMsgCls} role="alert">
        {fieldErrors[key]}
      </p>
    ) : null;
  const clsFor = (key: string) => (fieldErrors[key] ? inputErrCls : inputCls);

  /** Unggah satu paket foto; groupId opsional menautkan ke grup (butir 2). */
  const uploadPhotosTo = async (batchId: string, photos: PhotoGroup, groupId?: string) => {
    if (photos.files.length === 0) {
      return;
    }
    const form = new FormData();
    for (const f of photos.files) {
      form.append('photos', f);
    }
    form.append('captions', JSON.stringify(photos.captions));
    if (groupId) {
      form.append('groupId', groupId);
    }
    const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
      method: 'POST',
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message || `Unggah foto gagal (${res.status}). Coba lagi dari halaman batch.`);
    }
  };

  const postJson = async (url: string, payload: unknown) => {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message || `Gagal (${res.status}). Periksa isian lalu coba lagi.`);
    }
    return body.data;
  };

  const handleSubmit = async () => {
    const errs = { ...validateStepA(), ...validateStepB(), ...validateStepC() };
    // Foto batch dan foto tiap grup sama-sama wajib ber-caption bila ada.
    const captionError = (photos: PhotoGroup): string | null => {
      const bad = photos.captions.findIndex(
        (c) => c.trim() === '' || c.trim().length > MAX_PHOTO_CAPTION_LENGTH
      );
      return bad >= 0
        ? `Caption foto ke-${bad + 1} wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter).`
        : null;
    };
    const captionBatch = captionError(batchPhotos);
    if (captionBatch) {
      errs.photos = captionBatch;
    }
    const captionsSr = captionError(groupPhotos.sr);
    if (captionsSr) {
      errs.groupPhotosSr = captionsSr;
    }
    const captionsSd = captionError(groupPhotos.sd);
    if (captionsSd) {
      errs.groupPhotosSd = captionsSd;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const stepOf = (k: string) => stepOfField(k);
      setStep(stepOf(Object.keys(errs)[0]));
      focusFirstError(errs);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const batch = await postJson('/api/v1/batches', {
        departedAtUtc: wibInputToUtcIso(departedAt),
        procuredAtUtc: wibInputToUtcIso(procuredAt),
        marketSource: marketSource.trim(),
        sourceType,
        shrimpCount: Number(shrimpCount),
        shrimpLengthCm: Number(shrimpLengthCm),
        totalWeightG: Number(totalWeightG),
        initialCondition,
        initialTempC: Number(initialTempC),
        arrivedAtUtc: wibInputToUtcIso(arrivedAt),
        coolerTempDepartureC: Number(coolerDeparture),
        coolerTempMarketC: Number(coolerMarket),
        coolerTempLabC: Number(coolerLab),
        deviationAcknowledged: deviationAck,
      });
      const toGroup = (g: GroupForm, storageCondition: 'room_temp' | 'cold') => ({
        storageCondition,
        labTempC: Number(g.labTempC),
        visualCheck: g.visualCheck,
        labWeightBeforeG: Number(g.labWeightBeforeG),
        labWeightAfterG: Number(g.labWeightAfterG),
        sampleShrimpCount: Number(g.sampleShrimpCount),
        // Butir 1: mode simpan hanya relevan untuk grup dingin; API default
        // chamber bila field tak dikirim (grup ruang).
        ...(storageCondition === 'cold' ? { coldStorageMode: g.coldStorageMode } : {}),
      });
      await postJson(`/api/v1/batches/${encodeURIComponent(batch.batchId)}/groups`, {
        groups: [toGroup(groupSR, 'room_temp'), toGroup(groupSD, 'cold')],
      });
      // Unggah foto batch lalu foto tiap grup (butir 2); kegagalan foto tidak
      // membatalkan batch yang sudah tersimpan.
      if (
        batchPhotos.files.length > 0 ||
        groupPhotos.sr.files.length > 0 ||
        groupPhotos.sd.files.length > 0
      ) {
        try {
          await uploadPhotosTo(batch.batchId, batchPhotos);
          await uploadPhotosTo(batch.batchId, groupPhotos.sr, `${batch.batchId}-SR`);
          await uploadPhotosTo(batch.batchId, groupPhotos.sd, `${batch.batchId}-SD`);
        } catch (photoErr) {
          setCreatedBatchId(batch.batchId);
          throw new Error(
            photoErr instanceof Error ? photoErr.message : 'Batch tersimpan, tapi foto gagal diunggah dari sini.'
          );
        }
      }
      router.push(`/batches/${encodeURIComponent(batch.batchId)}`);
      // Batch tersimpan: draf tidak diperlukan lagi.
      removeBatchDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan batch. Periksa isian lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ['Pengadaan', 'Kondisi & Dokumentasi', 'Pengelompokan'];

  const radioRow = (
    name: string,
    value: string,
    onChange: (v: string) => void,
    options: ReadonlyArray<readonly [string, string]>
  ) => (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <label
          key={v}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[13px] font-mono cursor-pointer transition-colors touch-manipulation ${
            value === v
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
              : 'bg-black/20 border-white/10 text-white/70 hover:border-white/25'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === v}
            required
            onChange={() => onChange(v)}
            className="accent-emerald-400 w-4 h-4"
          />
          {label}
        </label>
      ))}
    </div>
  );

  const numberField = (
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra: { placeholder?: string; min?: number; max?: number; step?: string; hint?: string } = {}
  ) => (
    <div className={fieldCls}>
      <label className={labelCls} htmlFor={key}>
        {label}
        {reqMark}
      </label>
      <input
        id={key}
        name={key}
        type="number"
        min={extra.min}
        max={extra.max}
        step={extra.step ?? '0.1'}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-required="true"
        aria-invalid={!!fieldErrors[key]}
        onChange={(e) => {
          onChange(e.target.value);
          revalidateLive(step, { [key]: fieldErrors[key] });
        }}
        placeholder={extra.placeholder}
        className={clsFor(key)}
      />
      {fieldErrors[key] ? fieldMessage(key) : extra.hint ? <p className={hintCls}>{extra.hint}</p> : null}
    </div>
  );

  const groupCard = (
    prefix: 'sr' | 'sd',
    titleId: string,
    title: string,
    hint: string,
    g: GroupForm,
    setG: (v: GroupForm) => void
  ) => {
    const set = (patch: Partial<GroupForm>) => {
      const next = { ...g, ...patch };
      setG(next);
      if (Object.keys(fieldErrors).length > 0) {
        const fresh = validateGroup(prefix, next);
        const merged = { ...fieldErrors };
        for (const key of Object.keys(patch).map((k) => `${prefix}-${k}`)) {
          if (!fresh[key]) {
            delete merged[key];
          }
        }
        setFieldErrors(merged);
      }
    };
    return (
      <fieldset aria-labelledby={titleId} className={cardCls}>
        <h3 id={titleId} className="text-sm font-mono font-bold text-white tracking-wide text-pretty">
          {title}
        </h3>
        <p className={hintCls}>{hint}</p>
        {prefix === 'sd' && (
          <div className={fieldCls}>
            <span className={labelCls}>
              Tempat penyimpanan sesi dingin
              {reqMark}
            </span>
            {radioRow('sd-cold-mode', g.coldStorageMode, (v) =>
              set({ coldStorageMode: v as GroupForm['coldStorageMode'] }), [
              ['chamber', 'Dalam chamber'],
              ['plain_fridge', 'Langsung di kulkas, tanpa chamber'],
            ])}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-labTempC`}>
              Suhu udang (°C)
              {reqMark}
            </label>
            <input
              id={`${prefix}-labTempC`}
              name={`${prefix}-labTempC`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.labTempC}
              aria-required="true"
              aria-invalid={!!fieldErrors[`${prefix}-labTempC`]}
              onChange={(e) => set({ labTempC: e.target.value })}
              placeholder="6.5…"
              className={clsFor(`${prefix}-labTempC`)}
            />
            {fieldErrors[`${prefix}-labTempC`] ? (
              fieldMessage(`${prefix}-labTempC`)
            ) : (
              <p className={hintCls}>Ukur dengan termometer tusuk tepat sebelum observasi grup ini dimulai.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-visualCheck`}>
              Temuan visual udang
              {reqMark}
            </label>
            <select
              id={`${prefix}-visualCheck`}
              name={`${prefix}-visualCheck`}
              value={g.visualCheck}
              aria-required="true"
              aria-invalid={!!fieldErrors[`${prefix}-visualCheck`]}
              onChange={(e) => set({ visualCheck: e.target.value })}
              className={clsFor(`${prefix}-visualCheck`)}
            >
              <option value="normal" className="bg-slate-900">
                Normal
              </option>
              <option value="melanosis" className="bg-slate-900">
                Melanosis (bintik hitam)
              </option>
              <option value="damaged" className="bg-slate-900">
                Rusak fisik
              </option>
              <option value="mixed_species" className="bg-slate-900">
                Campur spesies lain
              </option>
            </select>
            {fieldMessage(`${prefix}-visualCheck`)}
            {g.visualCheck !== 'normal' && (
              <p className="text-[11px] font-mono text-amber-300" role="status">
                Temuan abnormal: foto ulang kondisi udang sebelum lock.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-sampleShrimpCount`}>
              Jumlah udang per sesi (ekor)
              {reqMark}
            </label>
            <input
              id={`${prefix}-sampleShrimpCount`}
              name={`${prefix}-sampleShrimpCount`}
              type="number"
              min={3}
              max={5}
              inputMode="numeric"
              autoComplete="off"
              value={g.sampleShrimpCount}
              aria-required="true"
              aria-invalid={!!fieldErrors[`${prefix}-sampleShrimpCount`]}
              onChange={(e) => set({ sampleShrimpCount: e.target.value })}
              className={clsFor(`${prefix}-sampleShrimpCount`)}
            />
            {fieldErrors[`${prefix}-sampleShrimpCount`] ? (
              fieldMessage(`${prefix}-sampleShrimpCount`)
            ) : (
              <p className={hintCls}>3–5 ekor per sesi.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-labWeightBeforeG`}>
              Berat sampel sebelum observasi (g)
              {reqMark}
            </label>
            <input
              id={`${prefix}-labWeightBeforeG`}
              name={`${prefix}-labWeightBeforeG`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.labWeightBeforeG}
              aria-required="true"
              aria-invalid={!!fieldErrors[`${prefix}-labWeightBeforeG`]}
              onChange={(e) => set({ labWeightBeforeG: e.target.value })}
              placeholder="482.0…"
              className={clsFor(`${prefix}-labWeightBeforeG`)}
            />
            {fieldErrors[`${prefix}-labWeightBeforeG`] ? (
              fieldMessage(`${prefix}-labWeightBeforeG`)
            ) : (
              <p className={hintCls}>Timbang udang sampel grup ini saat tiba di lab.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-labWeightAfterG`}>
              Berat total udang (g)
              {reqMark}
            </label>
            <input
              id={`${prefix}-labWeightAfterG`}
              name={`${prefix}-labWeightAfterG`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.labWeightAfterG}
              aria-required="true"
              aria-invalid={!!fieldErrors[`${prefix}-labWeightAfterG`]}
              onChange={(e) => set({ labWeightAfterG: e.target.value })}
              placeholder="478.5…"
              className={clsFor(`${prefix}-labWeightAfterG`)}
            />
            {fieldErrors[`${prefix}-labWeightAfterG`] ? (
              fieldMessage(`${prefix}-labWeightAfterG`)
            ) : (
              <p className={hintCls}>Timbang ulang udang yang sama setelah sesi terakhir grup ini.</p>
            )}
          </div>
        </div>
        <PhotosBlock
          prefix={prefix}
          title="Foto dokumentasi grup"
          hint="JPG/PNG sampai 5 MB. Tiap foto wajib ber-caption, mis. udang di chamber, udang di kulkas."
          error={fieldErrors[`groupPhotos${prefix.toUpperCase()}`]}
          onChange={(p) => setGroupPhotos((prev) => ({ ...prev, [prefix]: p }))}
        />
      </fieldset>
    );
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-mono font-black text-white tracking-wide text-balance">Batch baru</h2>
        <p className="text-xs font-mono text-white/60 mt-1">ID batch dan grup dibuat otomatis oleh server.</p>
        <p className="text-xs font-mono text-white/60 mt-1" aria-live="polite">
          Langkah {step + 1} dari 3
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-emerald-400/80' : 'bg-white/10'}`} />
          ))}
        </div>
        <p className="text-[11px] font-mono text-white/50 mt-2">
          Tanda <span aria-hidden="true" className="text-rose-400">*</span> merah berarti wajib diisi.
        </p>
        {draftMeaningful(draft) && !draftDismissed && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2">
            <div className="space-y-0.5 text-[11px] font-mono text-cyan-100">
              <p>
                Draf isian sebelumnya dipulihkan otomatis
                {typeof draft.savedAt === 'number'
                  ? ` — dibuat ${formatWibDateTime(new Date(draft.savedAt))}`
                  : ''}
                .
              </p>
              <p className="text-cyan-200/80">
                Draf hanya berlaku di perangkat dan peramban ini. Foto tidak ikut tersimpan — pilih ulang
                file fotonya.
              </p>
              {restoredCaptions.length > 0 && (
                <p className="text-cyan-200/80">
                  Caption tersimpan (foto perlu dipilih ulang): {restoredCaptions.join(' · ')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={discardDraft}
              className="shrink-0 self-start sm:self-auto px-3 py-1.5 rounded-lg border border-cyan-300/40 text-cyan-100 text-[11px] font-mono font-bold hover:bg-cyan-400/20"
            >
              Buang draf
            </button>
          </div>
        )}
        {AUTO_FILL_ENABLED && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={fillTestData} className={btnGhost}>
              Isi otomatis (data tes)
            </button>
            <span className="text-[11px] font-mono text-white/40">
              Uji cepat: mengisi ketiga langkah dengan nilai realistis; foto tetap dipilih manual.
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Tahap pengisian">
        {steps.map((s, i) => (
          <button
            key={s}
            role="tab"
            aria-selected={step === i}
            onClick={() => goToStep(i)}
            className={`${stepBtn} ${
              step === i
                ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400/50'
                : 'bg-white/5 text-white/50 border-white/10 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        aria-live="polite"
        className={`p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 ${error ? '' : 'hidden'}`}
      >
        {error}{' '}
        {createdBatchId && (
          <button
            onClick={() => router.push(`/batches/${encodeURIComponent(createdBatchId)}`)}
            className="underline font-bold"
          >
            Buka halaman batch
          </button>
        )}
      </div>

      <SuccessNotice message={notice} onDismiss={dismiss} />

      {step === 0 && (
        <form
          className={cardCls}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            goToStep(1);
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="departedAt">
                Tanggal dan jam berangkat (WIB)
                {reqMark}
              </label>
              <input
                id="departedAt"
                name="departedAt"
                type="datetime-local"
                autoComplete="off"
                value={departedAt}
                aria-required="true"
                aria-invalid={!!fieldErrors.departedAt}
                onChange={(e) => {
                  setDepartedAt(e.target.value);
                  revalidateLive(0, { departedAt: fieldErrors.departedAt });
                }}
                className={clsFor('departedAt')}
              />
              {fieldErrors.departedAt ? (
                fieldMessage('departedAt')
              ) : (
                <p className={hintCls}>Berangkat dari lab menuju pasar. Wajib 05:00–08:00 WIB dan sebelum jam beli.</p>
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="coolerDeparture">
                Suhu cool box saat berangkat (°C)
                {reqMark}
              </label>
              <input
                id="coolerDeparture"
                name="coolerDeparture"
                type="number"
                min={COOLER_TEMP_MIN_C}
                max={COOLER_TEMP_MAX_C}
                step="0.1"
                inputMode="decimal"
                autoComplete="off"
                value={coolerDeparture}
                aria-required="true"
                aria-invalid={!!fieldErrors.coolerDeparture}
                onChange={(e) => {
                  setCoolerDeparture(e.target.value);
                  revalidateLive(0, { coolerDeparture: fieldErrors.coolerDeparture });
                }}
                placeholder="1.0…"
                className={clsFor('coolerDeparture')}
              />
              {fieldErrors.coolerDeparture ? (
                fieldMessage('coolerDeparture')
              ) : (
                <p className={hintCls}>
                  Catat sebelum meninggalkan lab ({COOLER_TEMP_MIN_C} sampai {COOLER_TEMP_MAX_C} °C).
                </p>
              )}
            </div>
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sourceType">
              Jenis sumber
              {reqMark}
            </label>
            <select
              id="sourceType"
              name="sourceType"
              value={sourceType}
              aria-required="true"
              aria-invalid={!!fieldErrors.sourceType}
              onChange={(e) => {
                setSourceType(e.target.value);
                revalidateLive(0, { sourceType: fieldErrors.sourceType });
              }}
              className={clsFor('sourceType')}
            >
              <option value="market" className="bg-slate-900">
                Pasar
              </option>
              <option value="supermarket" className="bg-slate-900">
                Supermarket
              </option>
              <option value="farm" className="bg-slate-900">
                Tambak
              </option>
            </select>
            {fieldErrors.sourceType ? fieldMessage('sourceType') : null}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="marketSource">
              Sumber
              {reqMark}
            </label>
            <input
              id="marketSource"
              name="marketSource"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={marketSource}
              aria-required="true"
              aria-invalid={!!fieldErrors.marketSource}
              onChange={(e) => {
                setMarketSource(e.target.value);
                revalidateLive(0, { marketSource: fieldErrors.marketSource });
              }}
              placeholder="Pasar Ciroyom, Supermarket X…"
              className={clsFor('marketSource')}
            />
            {fieldErrors.marketSource ? (
              fieldMessage('marketSource')
            ) : (
              <p className={hintCls}>Nama lokasi pembelian, misal: Pasar Induk Kramat Jati, Supermarket X.</p>
            )}
          </div>
          <div className="sticky bottom-3 z-10 rounded-2xl bg-slate-900/85 backdrop-blur-md border border-white/10 shadow-lg p-2">
            <button type="submit" className={btnPrimary}>
              Lanjut ke Kondisi & Dokumentasi
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <form
          className={cardCls}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            goToStep(2);
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="procuredAt">
                Tanggal dan jam beli (WIB)
                {reqMark}
              </label>
              <input
                id="procuredAt"
                name="procuredAt"
                type="datetime-local"
                autoComplete="off"
                value={procuredAt}
                aria-required="true"
                aria-invalid={!!fieldErrors.procuredAt}
                onChange={(e) => {
                  setProcuredAt(e.target.value);
                  revalidateLive(1, { procuredAt: fieldErrors.procuredAt });
                }}
                className={clsFor('procuredAt')}
              />
              {fieldErrors.procuredAt ? (
                fieldMessage('procuredAt')
              ) : (
                <p className={hintCls}>
                  Diisi otomatis dari jam device ini — pastikan jam device benar dulu. Wajib 05:00–08:00 WIB
                  dan setelah jam berangkat.
                </p>
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="arrivedAt">
                Tanggal dan jam tiba di lab (WIB)
                {reqMark}
              </label>
              <input
                id="arrivedAt"
                name="arrivedAt"
                type="datetime-local"
                autoComplete="off"
                value={arrivedAt}
                aria-required="true"
                aria-invalid={!!fieldErrors.arrivedAt}
                onChange={(e) => {
                  setArrivedAt(e.target.value);
                  revalidateLive(1, { arrivedAt: fieldErrors.arrivedAt });
                }}
                className={clsFor('arrivedAt')}
              />
              {fieldErrors.arrivedAt ? (
                fieldMessage('arrivedAt')
              ) : (
                <p className={hintCls}>
                  Perbarui saat benar-benar tiba di lab. Harus setelah jam beli, keduanya dalam
                  05:00–08:00 WIB.
                </p>
              )}
            </div>
          </div>
          {durationHours !== null && !fieldErrors.arrivedAt && (
            <p aria-live="polite" className={`text-xs font-mono ${overDuration ? 'text-rose-300' : 'text-emerald-300'}`}>
              Durasi: {durationFmt.format(durationHours)} jam {overDuration ? '(melebihi 3 jam)' : '(dalam batas 3 jam)'}
            </p>
          )}
          {overDuration && (
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-rose-400/30 bg-rose-500/10 text-xs font-mono text-rose-200 cursor-pointer">
              <input
                type="checkbox"
                checked={deviationAck}
                onChange={(e) => {
                  setDeviationAck(e.target.checked);
                  revalidateLive(1, { arrivedAt: fieldErrors.arrivedAt });
                }}
                className="mt-0.5 w-4 h-4 accent-rose-400"
              />
              Catat sebagai deviasi cold-chain (durasi lebih dari 3 jam)
            </label>
          )}
          <div className={fieldCls}>
            <span className={labelCls}>
              Kondisi awal udang
              {reqMark}
            </span>
            {radioRow('initialCondition', initialCondition, setInitialCondition, [
              ['dead', 'Mati saat dibeli'],
              ['alive', 'Hidup saat dibeli'],
            ])}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="shrimpCount">
                Jumlah total udang (ekor)
                {reqMark}
              </label>
              <input
                id="shrimpCount"
                name="shrimpCount"
                type="number"
                min={10}
                inputMode="numeric"
                autoComplete="off"
                value={shrimpCount}
                aria-required="true"
                aria-invalid={!!fieldErrors.shrimpCount}
                onChange={(e) => {
                  setShrimpCount(e.target.value);
                  revalidateLive(1, { shrimpCount: fieldErrors.shrimpCount });
                }}
                className={clsFor('shrimpCount')}
              />
              {fieldErrors.shrimpCount ? fieldMessage('shrimpCount') : <p className={hintCls}>Minimal 10 ekor.</p>}
            </div>
            {numberField('shrimpLengthCm', 'Panjang udang (cm)', shrimpLengthCm, setShrimpLengthCm, {
              min: 1,
              max: 50,
              step: '0.1',
              placeholder: '12.5…',
              hint: 'Dari bekas potongan kepala sampai ujung ekor (telson).',
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {numberField('totalWeightG', 'Berat total udang (gram)', totalWeightG, (v) => {
              setTotalWeightG(v);
              revalidateLive(1, { totalWeightG: fieldErrors.totalWeightG });
            }, { placeholder: '485.5…', hint: 'Timbang seluruh udang sekaligus.' })}
            {numberField('initialTempC', 'Suhu awal udang (°C)', initialTempC, (v) => {
              changeInitialTempC(v);
              revalidateLive(1, { initialTempC: fieldErrors.initialTempC });
            }, {
              min: INITIAL_TEMP_MIN_C,
              max: INITIAL_TEMP_MAX_C,
              step: '0.1',
              placeholder: '2.5…',
              hint: `Ukur dengan termometer tusuk saat udang tiba (${INITIAL_TEMP_MIN_C} sampai ${INITIAL_TEMP_MAX_C} °C).`,
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {numberField('coolerMarket', 'Suhu cool box saat di pasar (°C)', coolerMarket, (v) => {
              setCoolerMarket(v);
              revalidateLive(1, { coolerMarket: fieldErrors.coolerMarket });
            }, {
              min: COOLER_TEMP_MIN_C,
              max: COOLER_TEMP_MAX_C,
              step: '0.1',
              placeholder: '1.2…',
              hint: 'Pasang termometer di es lalu catat saat membeli.',
            })}
            {numberField('coolerLab', 'Suhu cool box saat di lab (°C)', coolerLab, (v) => {
              setCoolerLab(v);
              revalidateLive(1, { coolerLab: fieldErrors.coolerLab });
            }, {
              min: COOLER_TEMP_MIN_C,
              max: COOLER_TEMP_MAX_C,
              step: '0.1',
              placeholder: '3.8…',
              hint: 'Catat lagi saat tiba di lab, sebelum observasi.',
            })}
          </div>
          <p className={hintCls}>
            Protokol menjaga cool box 0–4 °C dengan rasio es:udang 2:1. Input menerima{' '}
            {COOLER_TEMP_MIN_C} sampai {COOLER_TEMP_MAX_C} °C agar kondisi nyata di lapangan tetap tercatat.
          </p>
          <PhotosBlock
            prefix="batch"
            title="Foto kondisi awal udang"
            hint="JPG/PNG sampai 5 MB (bisa tambah bertahap, tanpa batas jumlah). Tiap foto wajib ber-caption (mis. di pasar, sebelum chamber). Minimal 1 foto sebelum batch dikunci."
            error={fieldErrors.photos}
            onChange={setBatchPhotos}
          />
          <div className="sticky bottom-3 z-10 flex gap-2 p-2 rounded-2xl bg-slate-900/85 backdrop-blur-md border border-white/10 shadow-lg">
            <button type="button" onClick={() => goToStep(0)} disabled={submitting} className={btnBack}>
              Kembali
            </button>
            <button type="submit" className={`${btnPrimary} flex-[2]`}>
              Lanjut ke Pengelompokan
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          {groupCard(
            'sr',
            'group-title-sr',
            'Suhu Ruang (25 ± 2 °C)',
            'Diukur tiap 6 jam selama 36–48 jam.',
            groupSR,
            setSR
          )}
          {groupCard(
            'sd',
            'group-title-sd',
            'Suhu Dingin (4 ± 1 °C)',
            'Diukur tiap 24 jam selama 10–14 hari, sesuai tempat penyimpanan yang dipilih.',
            groupSD,
            setSD
          )}
          <div className="sticky bottom-3 z-10 flex gap-2 p-2 rounded-2xl bg-slate-900/85 backdrop-blur-md border border-white/10 shadow-lg">
            <button type="button" onClick={() => goToStep(1)} disabled={submitting} className={btnBack}>
              Kembali
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className={`${btnPrimary} flex-[2]`}
            >
              {submitting ? 'Menyimpan…' : 'Simpan batch'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Gate halaman: identitas diketahui dulu sebelum form dimuat, supaya draf
 * (butir 13) hanya dibaca milik akun yang sedang masuk.
 */
export default function NewBatchPage() {
  const { user, isLoading, apiFetch } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace(user ? '/batches' : '/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return <p className="p-6 text-sm font-mono text-white/60">Memuat sesi…</p>;
  }
  if (!user || user.role !== 'ADMIN') {
    return null;
  }
  return <BatchWizardForm key={user.id} userId={user.id} apiFetch={apiFetch} />;
}
