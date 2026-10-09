"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import {
  isProcurementWindow,
  isColdChainCompliant,
  transportDurationMs,
  wibInputToUtc,
  MAX_BATCH_PHOTOS,
  MAX_PHOTO_CAPTION_LENGTH,
  DatasetValidationError,
} from '../../../shared/dataset.ts';
import SuccessNotice, { useSuccessNotice } from '../../../components/ui/SuccessNotice';

const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[13px] font-mono font-semibold text-white/85';
const hintCls = 'text-xs font-mono text-white/70';
const inputCls =
  'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400/60 focus-visible:ring-2 focus-visible:ring-emerald-400/50 [color-scheme:dark] [tabular-nums]';
const inputErrCls =
  'w-full px-3 py-2.5 rounded-xl bg-black/25 border border-rose-400/60 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-rose-300 focus-visible:ring-2 focus-visible:ring-rose-300/50 [color-scheme:dark] [tabular-nums]';
const cardCls = 'flex flex-col gap-5 p-5 md:p-6 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20';
const btnPrimary =
  'w-full py-3 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-100 text-sm font-mono font-bold tracking-wide transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70';
const btnBack =
  'flex-1 py-3 rounded-xl bg-transparent hover:bg-white/10 border border-white/15 text-white/70 text-sm font-mono font-bold transition-colors touch-manipulation disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
const stepBtn =
  'flex-1 px-2 py-2.5 rounded-xl font-mono text-xs font-bold border transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60';
const btnGhost =
  'px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/60 hover:text-white text-[11px] font-mono transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

// Alat bantu tes fitur: isi otomatis seluruh form dengan nilai realistis.
// Matikan (ganti ke false) saat pengujian sesungguhnya agar tombolnya
// tidak muncul.
const AUTO_FILL_ENABLED = true;

interface GroupForm {
  labTempC: string;
  visualCheck: string;
  labWeightG: string;
  shrimpLengthCm: string;
  sampleShrimpCount: string;
  sampleWeightG: string;
}

const emptyGroup = (): GroupForm => ({
  labTempC: '',
  visualCheck: 'normal',
  labWeightG: '',
  shrimpLengthCm: '',
  sampleShrimpCount: '4',
  sampleWeightG: '',
});

const durationFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

type Errors = Record<string, string>;

const toNum = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function parseWib(value: string): { date?: Date; error?: string } {
  if (value.trim() === '') return { error: 'Wajib diisi.' };
  try {
    return { date: wibInputToUtc(value.replace('T', ' ')) };
  } catch (err) {
    return { error: err instanceof DatasetValidationError ? 'Format tanggal tidak valid.' : 'Format tanggal tidak valid.' };
  }
}

export default function NewBatchPage() {
  const { user, isLoading, apiFetch } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const { message: notice, notify, dismiss } = useSuccessNotice();

  // Tahap A — pengadaan
  const [procuredAt, setProcuredAt] = useState('');
  const [marketSource, setMarketSource] = useState('');
  const [sourceType, setSourceType] = useState('market');
  const [shrimpCount, setShrimpCount] = useState('12');
  const [shrimpLengthCm, setShrimpLengthCm] = useState('');
  const [totalWeightG, setTotalWeightG] = useState('');
  const [initialCondition, setInitialCondition] = useState('dead');
  const [initialTempC, setInitialTempC] = useState('');
  // Tahap B — transportasi
  const [departedAt, setDepartedAt] = useState('');
  const [arrivedAt, setArrivedAt] = useState('');
  const [coolerMin, setCoolerMin] = useState('');
  const [coolerMax, setCoolerMax] = useState('');
  const [tempStart, setTempStart] = useState('');
  const [tempEnd, setTempEnd] = useState('');
  const [deviationAck, setDeviationAck] = useState(false);
  // Foto kondisi awal (diunggah setelah batch dibuat)
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoCaptions, setPhotoCaptions] = useState<string[]>([]);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  // Tahap C — grup SR/SD
  const [groupSR, setGroupSR] = useState<GroupForm>(emptyGroup());
  const [groupSD, setGroupSD] = useState<GroupForm>(emptyGroup());

  // Berat di lab & suhu tusuk saat tiba selalu sama di kedua kartu (diukur
  // sekali sebelum dibagi): kartu pertama yang disentuh menyalin ke kartu
  // satunya; begitu kartu kedua disentuh manual, keduanya independen.
  const [labSource, setLabSource] = useState<'sr' | 'sd' | null>(null);
  const [labTempTouched, setLabTempTouched] = useState({ sr: false, sd: false });
  const setSR = (v: GroupForm) => {
    if (v.labWeightG !== groupSR.labWeightG) {
      if (labSource !== 'sd') {
        setGroupSD((prev) => ({ ...prev, labWeightG: v.labWeightG }));
      }
      setLabSource('sr');
    }
    if (v.labTempC !== groupSR.labTempC) {
      setLabTempTouched((prev) => ({ ...prev, sr: true }));
    }
    setGroupSR(v);
  };
  const setSD = (v: GroupForm) => {
    if (v.labWeightG !== groupSD.labWeightG) {
      if (labSource !== 'sr') {
        setGroupSR((prev) => ({ ...prev, labWeightG: v.labWeightG }));
      }
      setLabSource('sd');
    }
    if (v.labTempC !== groupSD.labTempC) {
      setLabTempTouched((prev) => ({ ...prev, sd: true }));
    }
    setGroupSD(v);
  };

  // Suhu awal udang = suhu awal transportasi (masuk box segera setelah beli):
  // tersalin hidup selama kolom transportasi belum disentuh manual.
  const [tempStartTouched, setTempStartTouched] = useState(false);
  const changeInitialTempC = (v: string) => {
    setInitialTempC(v);
    if (!tempStartTouched) {
      setTempStart(v);
    }
  };
  const changeTempStart = (v: string) => {
    setTempStartTouched(true);
    setTempStart(v);
  };
  // Suhu akhir transportasi = suhu tusuk saat tiba (kedua kartu, sampai disentuh).
  const changeTempEnd = (v: string) => {
    setTempEnd(v);
    if (!labTempTouched.sr) {
      setGroupSR((g) => ({ ...g, labTempC: v }));
    }
    if (!labTempTouched.sd) {
      setGroupSD((g) => ({ ...g, labTempC: v }));
    }
  };

  /**
   * Isi seluruh form (pengadaan → transportasi → kelompok) dengan
   * nilai yang realistis dan saling konsisten, agar alur fitur
   * bisa diuji tanpa mengetar satu per satu. Foto tidak diisi:
   * file asli tidak bisa dibuang-buang, jadi tetap dipilih manual.
   */
  const fillTestData = () => {
    // Tanggal kalender WIB hari ini (UTC+7).
    const wibDate = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    // Berangkat dari lab 06:15 → beli di pasar 07:20 (dalam jendela
    // 06:00–08:00) → tiba kembali di lab 07:55 (perjalanan 1j40).
    const procured = `${wibDate}T07:20`;

    // Isi ulang berarti mengganti seluruh form, jadi flag mirror direset.
    setTempStartTouched(false);
    setLabTempTouched({ sr: false, sd: false });
    setLabSource(null);
    setDeviationAck(false);

    // Tahap A — pengadaan
    setProcuredAt(procured);
    setMarketSource('Pasar Ciroyom');
    setSourceType('market');
    setShrimpCount('12');
    setShrimpLengthCm('12.5'); // panjang representatif saat beli
    setTotalWeightG('480');
    setInitialCondition('dead');
    setInitialTempC('8.5'); // udang baru dibeli, masih ada esnya
    // Tahap B — transportasi
    setDepartedAt(`${wibDate}T06:15`);
    setArrivedAt(`${wibDate}T07:55`);
    setCoolerMin('1.2');
    setCoolerMax('3.6');
    setTempStart('8.5');
    setTempEnd('6.4'); // suhu tusuk saat tiba di lab
    // Tahap C — kelompok SR (suhu ruang) dan SD (dingin)
    setGroupSR({
      labTempC: '6.4',
      visualCheck: 'normal',
      labWeightG: '472',
      shrimpLengthCm: '12.4',
      sampleShrimpCount: '4',
      sampleWeightG: '158',
    });
    setGroupSD({
      labTempC: '6.4',
      visualCheck: 'normal',
      labWeightG: '472',
      shrimpLengthCm: '12.6',
      sampleShrimpCount: '4',
      sampleWeightG: '156',
    });
    setFieldErrors({});
    notify('Form terisi data tes — periksa dulu sebelum Simpan batch.');
  };

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'ADMIN')) {
      router.replace(user ? '/batches' : '/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  const durationHours =
    departedAt && arrivedAt
      ? (new Date(arrivedAt).getTime() - new Date(departedAt).getTime()) / 3_600_000
      : null;
  const overDuration = durationHours !== null && durationHours > 3;

  // ---------- validasi per tahap (cermin server, pesan Indonesia) ----------

  const validateStepA = (): Errors => {
    const e: Errors = {};
    const proc = parseWib(procuredAt);
    if (proc.error) {
      e.procuredAt = proc.error;
    } else if (!isProcurementWindow(proc.date!)) {
      e.procuredAt = 'Harus pagi 06:00–08:00 WIB (Anda mengisi jam di luar jendela).';
    }
    if (marketSource.trim() === '') {
      e.marketSource = 'Wajib diisi.';
    } else if (marketSource.trim().length > 100) {
      e.marketSource = 'Maksimal 100 karakter.';
    }
    const count = toNum(shrimpCount);
    if (count === null) {
      e.shrimpCount = 'Wajib diisi.';
    } else if (!Number.isInteger(count) || count < 10) {
      e.shrimpCount = 'Minimal 10 ekor (bilangan bulat).';
    }
    const len = toNum(shrimpLengthCm);
    if (len === null) {
      e.shrimpLengthCm = 'Wajib diisi.';
    } else if (!(len >= 1 && len <= 50)) {
      e.shrimpLengthCm = 'Harus 1 sampai 50 cm.';
    }
    const w = toNum(totalWeightG);
    if (w === null) {
      e.totalWeightG = 'Wajib diisi.';
    } else if (!(w > 0) || w > 2000) {
      e.totalWeightG = 'Harus lebih dari 0 sampai 2000 gram.';
    }
    const t = toNum(initialTempC);
    if (t === null) {
      e.initialTempC = 'Wajib diisi.';
    } else if (t < -2 || t > 30) {
      e.initialTempC = 'Harus -2 sampai 30 °C.';
    }
    return e;
  };

  const validateStepB = (): Errors => {
    const e: Errors = {};
    const dep = parseWib(departedAt);
    const arr = parseWib(arrivedAt);
    if (dep.error) {
      e.departedAt = dep.error;
    }
    if (arr.error) {
      e.arrivedAt = arr.error;
    }
    if (!dep.error && !arr.error) {
      const proc = parseWib(procuredAt);
      if (!proc.error && transportDurationMs(dep.date!, proc.date!) <= 0) {
        e.departedAt = 'Waktu berangkat (dari lab) harus sebelum waktu beli udang di pasar.';
      } else if (!proc.error && transportDurationMs(proc.date!, arr.date!) <= 0) {
        e.arrivedAt = 'Waktu tiba di lab harus setelah waktu beli udang.';
      } else if (transportDurationMs(dep.date!, arr.date!) < 0) {
        e.arrivedAt = 'Waktu tiba harus setelah waktu berangkat.';
      } else if (!isColdChainCompliant(dep.date!, arr.date!) && !deviationAck) {
        e.arrivedAt = 'Melebihi 3 jam — centang deviasi di bawah untuk lanjut.';
      }
    }
    const cmin = toNum(coolerMin);
    if (cmin === null) {
      e.coolerMin = 'Wajib diisi.';
    } else if (cmin < 0 || cmin > 4) {
      e.coolerMin = 'Harus 0–4 °C.';
    }
    const cmax = toNum(coolerMax);
    if (cmax === null) {
      e.coolerMax = 'Wajib diisi.';
    } else if (cmax < 0 || cmax > 4) {
      e.coolerMax = 'Harus 0–4 °C.';
    }
    if (toNum(tempStart) === null) {
      e.tempStart = 'Wajib diisi.';
    }
    if (toNum(tempEnd) === null) {
      e.tempEnd = 'Wajib diisi.';
    }
    return e;
  };

  const validateGroup = (prefix: 'sr' | 'sd', g: GroupForm): Errors => {
    const e: Errors = {};
    const t = toNum(g.labTempC);
    if (t === null) {
      e[`${prefix}-labTempC`] = 'Wajib diisi.';
    } else if (t < -2 || t > 30) {
      e[`${prefix}-labTempC`] = 'Harus -2 sampai 30 °C.';
    }
    if (g.visualCheck.trim() === '') {
      e[`${prefix}-visualCheck`] = 'Wajib dipilih.';
    }
    const lw = toNum(g.labWeightG);
    if (lw === null) {
      e[`${prefix}-labWeightG`] = 'Wajib diisi.';
    } else if (!(lw > 0)) {
      e[`${prefix}-labWeightG`] = 'Harus lebih dari 0.';
    }
    const gl = toNum(g.shrimpLengthCm);
    if (gl === null) {
      e[`${prefix}-shrimpLengthCm`] = 'Wajib diisi.';
    } else if (!(gl >= 1 && gl <= 50)) {
      e[`${prefix}-shrimpLengthCm`] = 'Harus 1 sampai 50 cm.';
    }
    const c = toNum(g.sampleShrimpCount);
    if (c === null) {
      e[`${prefix}-sampleShrimpCount`] = 'Wajib diisi.';
    } else if (!Number.isInteger(c) || c < 3 || c > 5) {
      e[`${prefix}-sampleShrimpCount`] = 'Harus 3–5 ekor.';
    }
    const sw = toNum(g.sampleWeightG);
    if (sw === null) {
      e[`${prefix}-sampleWeightG`] = 'Wajib diisi.';
    } else if (!(sw > 0)) {
      e[`${prefix}-sampleWeightG`] = 'Harus lebih dari 0.';
    }
    return e;
  };

  const validateStepC = (): Errors => ({
    ...validateGroup('sr', groupSR),
    ...validateGroup('sd', groupSD),
  });

  const validators = [validateStepA, validateStepB, validateStepC];

  const focusFirstError = (errs: Errors) => {
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(first)?.focus();
    }
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
    // Suhu awal udang (dibeli lalu langsung masuk box) = suhu awal transportasi:
    // praktis satu pembacaan fisik, jadi cukup isi sekali lalu tersalin.
    if (next >= 1 && tempStart.trim() === '' && initialTempC.trim() !== '') {
      setTempStart(initialTempC);
    }
    // Suhu akhir transportasi (udang tiba di lab) = suhu tusuk saat tiba:
    // praktis satu pembacaan, jadi cukup isi sekali lalu tersalin ke tiap kartu.
    if (next >= 2 && tempEnd.trim() !== '') {
      if (groupSR.labTempC.trim() === '') {
        setGroupSR((prev) => ({ ...prev, labTempC: tempEnd }));
      }
      if (groupSD.labTempC.trim() === '') {
        setGroupSD((prev) => ({ ...prev, labTempC: tempEnd }));
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

  /** Pilih foto: tambah ke yang sudah ada (bukan mengganti). */
  const handlePhotoSelect = (list: FileList | null, input: HTMLInputElement) => {
    const incoming = Array.from(list ?? []);
    const usable = incoming.filter((f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0);
    if (usable.length < incoming.length) {
      setFieldErrors((prev) => ({ ...prev, photos: 'Hanya file JPG/PNG yang dipakai. File lain dilewati.' }));
    }
    const fitting = usable.filter((f) => f.size <= 5 * 1024 * 1024);
    if (fitting.length < usable.length) {
      setFieldErrors((prev) => ({ ...prev, photos: 'Tiap foto maksimal 5 MB. File lebih besar dilewati.' }));
    }
    const room = MAX_BATCH_PHOTOS - photoFiles.length;
    const accepted = fitting.slice(0, Math.max(room, 0));
    if (accepted.length < fitting.length) {
      setFieldErrors((prev) => ({
        ...prev,
        photos: `Maksimal ${MAX_BATCH_PHOTOS} foto per batch. Kelebihannya dilewati.`,
      }));
    }
    setPhotoFiles((prev) => [...prev, ...accepted]);
    setPhotoPreviews((prev) => [...prev, ...accepted.map((f) => URL.createObjectURL(f))]);
    setPhotoCaptions((prev) => [...prev, ...accepted.map(() => '')]);
    input.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
    setPhotoCaptions((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadPhotos = async (batchId: string) => {
    const form = new FormData();
    for (const f of photoFiles) {
      form.append('photos', f);
    }
    form.append('captions', JSON.stringify(photoCaptions));
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
    const badCaption = photoFiles.length > 0
      ? photoCaptions.findIndex((c) => c.trim() === '' || c.trim().length > MAX_PHOTO_CAPTION_LENGTH)
      : -1;
    if (badCaption >= 0) {
      errs.photos = `Caption foto ke-${badCaption + 1} wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter).`;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const stepOf = (k: string) =>
        ['procuredAt', 'marketSource', 'shrimpCount', 'shrimpLengthCm', 'totalWeightG', 'initialTempC', 'photos'].includes(k)
          ? 0
          : ['departedAt', 'arrivedAt', 'coolerMin', 'coolerMax', 'tempStart', 'tempEnd'].includes(k)
            ? 1
            : 2;
      setStep(stepOf(Object.keys(errs)[0]));
      focusFirstError(errs);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const batch = await postJson('/api/v1/batches', {
        procuredAtUtc: new Date(procuredAt).toISOString(),
        marketSource: marketSource.trim(),
        sourceType,
        shrimpCount: Number(shrimpCount),
        shrimpLengthCm: Number(shrimpLengthCm),
        totalWeightG: Number(totalWeightG),
        initialCondition,
        initialTempC: Number(initialTempC),
        departedAtUtc: new Date(departedAt).toISOString(),
        arrivedAtUtc: new Date(arrivedAt).toISOString(),
        coolerTempMinC: Number(coolerMin),
        coolerTempMaxC: Number(coolerMax),
        tempStartC: Number(tempStart),
        tempEndC: Number(tempEnd),
        deviationAcknowledged: deviationAck,
      });
      const toGroup = (g: GroupForm, storageCondition: string) => ({
        storageCondition,
        labTempC: Number(g.labTempC),
        visualCheck: g.visualCheck,
        labWeightG: Number(g.labWeightG),
        shrimpLengthCm: Number(g.shrimpLengthCm),
        sampleShrimpCount: Number(g.sampleShrimpCount),
        sampleWeightG: Number(g.sampleWeightG),
      });
      await postJson(`/api/v1/batches/${encodeURIComponent(batch.batchId)}/groups`, {
        groups: [toGroup(groupSR, 'room_temp'), toGroup(groupSD, 'cold')],
      });
      if (photoFiles.length > 0) {
        try {
          await uploadPhotos(batch.batchId);
        } catch (photoErr) {
          setCreatedBatchId(batch.batchId);
          throw new Error(
            photoErr instanceof Error ? photoErr.message : 'Batch tersimpan, tapi foto gagal diunggah dari sini.'
          );
        }
      }
      router.push(`/batches/${encodeURIComponent(batch.batchId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan batch. Periksa isian lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex justify-center py-16" aria-label="Memuat…">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  const steps = ['Pengadaan', 'Transportasi', 'Kelompok'];

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
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-labTempC`}>
              Suhu tusuk saat tiba (°C)
            </label>
            <input
              id={`${prefix}-labTempC`}
              name={`${prefix}-labTempC`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.labTempC}
              aria-invalid={!!fieldErrors[`${prefix}-labTempC`]}
              onChange={(e) => set({ labTempC: e.target.value })}
              placeholder="6.5…"
              className={clsFor(`${prefix}-labTempC`)}
            />
            {fieldErrors[`${prefix}-labTempC`] ? (
              fieldMessage(`${prefix}-labTempC`)
            ) : (
              <p className={hintCls}>Tersalin dari suhu akhir transportasi; ubah bila beda.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-visualCheck`}>
              Temuan visual
            </label>
            <select
              id={`${prefix}-visualCheck`}
              name={`${prefix}-visualCheck`}
              value={g.visualCheck}
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
                Temuan abnormal: catat detailnya di catatan seleksi batch dan foto ulang sebelum lock.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-labWeightG`}>
              Berat di lab (g)
            </label>
            <input
              id={`${prefix}-labWeightG`}
              name={`${prefix}-labWeightG`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.labWeightG}
              aria-invalid={!!fieldErrors[`${prefix}-labWeightG`]}
              onChange={(e) => set({ labWeightG: e.target.value })}
              placeholder="482.0…"
              className={clsFor(`${prefix}-labWeightG`)}
            />
            {fieldErrors[`${prefix}-labWeightG`] ? (
              fieldMessage(`${prefix}-labWeightG`)
            ) : (
              <p className={hintCls}>Otomatis sama dengan kartu satunya; boleh diubah bila perlu.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-sampleShrimpCount`}>
              Ekor per sesi
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
              aria-invalid={!!fieldErrors[`${prefix}-sampleShrimpCount`]}
              onChange={(e) => set({ sampleShrimpCount: e.target.value })}
              className={clsFor(`${prefix}-sampleShrimpCount`)}
            />
            {fieldErrors[`${prefix}-sampleShrimpCount`] ? (
              fieldMessage(`${prefix}-sampleShrimpCount`)
            ) : (
              <p className={hintCls}>3–5 ekor.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-sampleWeightG`}>
              Berat sesi (g)
            </label>
            <input
              id={`${prefix}-sampleWeightG`}
              name={`${prefix}-sampleWeightG`}
              type="number"
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.sampleWeightG}
              aria-invalid={!!fieldErrors[`${prefix}-sampleWeightG`]}
              onChange={(e) => set({ sampleWeightG: e.target.value })}
              placeholder="162.3…"
              className={clsFor(`${prefix}-sampleWeightG`)}
            />
            {fieldMessage(`${prefix}-sampleWeightG`)}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor={`${prefix}-shrimpLengthCm`}>
              Panjang udang (cm)
            </label>
            <input
              id={`${prefix}-shrimpLengthCm`}
              name={`${prefix}-shrimpLengthCm`}
              type="number"
              min={1}
              max={50}
              step="0.1"
              inputMode="decimal"
              autoComplete="off"
              value={g.shrimpLengthCm}
              aria-invalid={!!fieldErrors[`${prefix}-shrimpLengthCm`]}
              onChange={(e) => set({ shrimpLengthCm: e.target.value })}
              placeholder="12.5…"
              className={clsFor(`${prefix}-shrimpLengthCm`)}
            />
            {fieldErrors[`${prefix}-shrimpLengthCm`] ? (
              fieldMessage(`${prefix}-shrimpLengthCm`)
            ) : (
              <p className={hintCls}>Bekas potongan kepala sampai telson.</p>
            )}
          </div>
        </div>
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
        {AUTO_FILL_ENABLED && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={fillTestData} className={btnGhost}>
              Isi otomatis (data tes)
            </button>
            <span className="text-[11px] font-mono text-white/40">
              Uji cepat: mengisi pengadaan → transportasi → kelompok dengan nilai realistis; foto tetap dipilih manual.
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
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="procuredAt">
              Tanggal dan jam beli (WIB)
            </label>
            <input
              id="procuredAt"
              name="procuredAt"
              type="datetime-local"
              autoComplete="off"
              value={procuredAt}
              aria-invalid={!!fieldErrors.procuredAt}
              onChange={(e) => {
                setProcuredAt(e.target.value);
                revalidateLive(0, { procuredAt: fieldErrors.procuredAt });
              }}
              className={clsFor('procuredAt')}
            />
            {fieldErrors.procuredAt ? (
              fieldMessage('procuredAt')
            ) : (
              <p className={hintCls}>Wajib pagi 06:00–08:00 WIB, dan harus di antara waktu berangkat serta tiba. Tersimpan sebagai UTC.</p>
            )}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="marketSource">
              Sumber pasar
            </label>
            <input
              id="marketSource"
              name="marketSource"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={marketSource}
              aria-invalid={!!fieldErrors.marketSource}
              onChange={(e) => {
                setMarketSource(e.target.value);
                revalidateLive(0, { marketSource: fieldErrors.marketSource });
              }}
              placeholder="Pasar Ciroyom…"
              className={clsFor('marketSource')}
            />
            {fieldErrors.marketSource ? (
              fieldMessage('marketSource')
            ) : (
              <p className={hintCls}>Tulis bebas nama pasar tempat membeli.</p>
            )}
          </div>
          <div className={fieldCls}>
            <span className={labelCls}>Jenis sumber</span>
            {radioRow('sourceType', sourceType, setSourceType, [
              ['market', 'Pasar'],
              ['farm', 'Tambak'],
            ])}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="shrimpCount">
                Jumlah ekor
              </label>
              <input
                id="shrimpCount"
                name="shrimpCount"
                type="number"
                min={10}
                inputMode="numeric"
                autoComplete="off"
                value={shrimpCount}
                aria-invalid={!!fieldErrors.shrimpCount}
                onChange={(e) => {
                  setShrimpCount(e.target.value);
                  revalidateLive(0, { shrimpCount: fieldErrors.shrimpCount });
                }}
                className={clsFor('shrimpCount')}
              />
              {fieldErrors.shrimpCount ? fieldMessage('shrimpCount') : <p className={hintCls}>Minimal 10 ekor.</p>}
            </div>
            {numberField('shrimpLengthCm', 'Panjang udang (cm)', shrimpLengthCm, setShrimpLengthCm, {
              min: 1,
              max: 50,
              step: '0.1',
              hint: 'Dari bekas potongan kepala sampai ujung ekor (telson).',
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numberField('totalWeightG', 'Berat total (gram)', totalWeightG, (v) => {
              setTotalWeightG(v);
              revalidateLive(0, { totalWeightG: fieldErrors.totalWeightG });
            }, { placeholder: '485.5…', hint: 'Timbang dengan timbangan digital.' })}
            {numberField('initialTempC', 'Suhu awal udang (°C)', initialTempC, (v) => {
              changeInitialTempC(v);
              revalidateLive(0, { initialTempC: fieldErrors.initialTempC });
            }, { placeholder: '8.2…', hint: 'Ukur dengan termometer tusuk.' })}
          </div>
          <div className={fieldCls}>
            <span className={labelCls}>Kondisi awal</span>
            {radioRow('initialCondition', initialCondition, setInitialCondition, [
              ['dead', 'Mati'],
              ['alive', 'Hidup'],
            ])}
          </div>
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="photos">
              Foto kondisi awal
            </label>
            <input
              id="photos"
              name="photos"
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) => handlePhotoSelect(e.target.files, e.target)}
              className="text-xs font-mono text-white/60 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:bg-white/10 file:border file:border-white/10 file:text-white/80 file:text-xs file:font-mono"
            />
            <p className={hintCls}>JPG/PNG sampai 5 MB, maksimal 10 (bisa tambah bertahap). Tiap foto wajib ber-caption (mis. di pasar, sebelum chamber). Minimal 1 foto sebelum batch dikunci.</p>
            {fieldErrors.photos && (
              <p className="text-[11px] font-mono text-amber-300" role="status">
                {fieldErrors.photos}
              </p>
            )}
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={src} className="relative space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Pratinjau foto ${i + 1}`} className="w-full h-16 object-cover rounded-lg border border-white/10" />
                    <label className={`${labelCls} flex items-center gap-1`} htmlFor={`photo-caption-${i}`}>
                      Caption <span aria-hidden="true" className="text-rose-400">*</span>
                    </label>
                    <input
                      id={`photo-caption-${i}`}
                      name={`photo-caption-${i}`}
                      type="text"
                      maxLength={MAX_PHOTO_CAPTION_LENGTH}
                      autoComplete="off"
                      value={photoCaptions[i] ?? ''}
                      aria-required="true"
                      onChange={(e) => setPhotoCaptions((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
                      placeholder="Di pasar…"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Hapus foto ${i + 1}`}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500/90 text-white text-[10px] font-bold leading-none hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" className={btnPrimary}>
            Lanjut ke Transportasi
          </button>
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
          <div className="grid grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="departedAt">
                Waktu berangkat (WIB)
              </label>
              <input
                id="departedAt"
                name="departedAt"
                type="datetime-local"
                autoComplete="off"
                value={departedAt}
                aria-invalid={!!fieldErrors.departedAt}
                onChange={(e) => {
                  setDepartedAt(e.target.value);
                  revalidateLive(1, { departedAt: fieldErrors.departedAt });
                }}
                className={clsFor('departedAt')}
              />
              {fieldErrors.departedAt ? (
                fieldMessage('departedAt')
              ) : (
                <p className={hintCls}>Berangkat dari lab menuju pasar; jam beli harus sesudah ini.</p>
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="arrivedAt">
                Waktu tiba di lab (WIB)
              </label>
              <input
                id="arrivedAt"
                name="arrivedAt"
                type="datetime-local"
                autoComplete="off"
                value={arrivedAt}
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
                <p className={hintCls}>Tiba kembali di lab; jam beli harus sebelum ini.</p>
              )}
            </div>
          </div>
          {durationHours !== null && !fieldErrors.arrivedAt && (
            <p aria-live="polite" className={`text-xs font-mono ${overDuration ? 'text-rose-300' : 'text-emerald-300'}`}>
              Durasi: {durationFmt.format(durationHours)} jam {overDuration ? '(melebihi 3 jam)' : '(dalam batas 3 jam)'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {numberField('coolerMin', 'Suhu cool box min (°C)', coolerMin, (v) => {
              setCoolerMin(v);
              revalidateLive(1, { coolerMin: fieldErrors.coolerMin });
            }, { placeholder: '1.2…' })}
            {numberField('coolerMax', 'Suhu cool box max (°C)', coolerMax, (v) => {
              setCoolerMax(v);
              revalidateLive(1, { coolerMax: fieldErrors.coolerMax });
            }, { placeholder: '3.8…' })}
          </div>
          <p className={hintCls}>Jaga 0–4 °C dengan rasio es:udang 2:1.</p>
          <div className="grid grid-cols-2 gap-3">
            {numberField('tempStart', 'Suhu awal transportasi (°C)', tempStart, (v) => {
              changeTempStart(v);
              revalidateLive(1, { tempStart: fieldErrors.tempStart });
            }, { placeholder: '3.0…', hint: 'Tersalin dari Suhu awal udang; ubah hanya bila beda.' })}
            {numberField('tempEnd', 'Suhu akhir transportasi (°C)', tempEnd, (v) => {
              changeTempEnd(v);
              revalidateLive(1, { tempEnd: fieldErrors.tempEnd });
            }, { placeholder: '3.5…', hint: 'Tersalin ke suhu tusuk saat tiba di tiap kelompok.' })}
          </div>
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
          <div className="flex gap-2">
            <button type="button" onClick={() => goToStep(0)} className={btnBack}>
              Kembali
            </button>
            <button type="submit" className={`${btnPrimary} flex-[2]`}>
              Lanjut ke Kelompok
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          {groupCard(
            'sr',
            'group-title-sr',
            'Kelompok suhu ruang (25 ± 2 °C)',
            'Diukur tiap 6 jam selama 36–48 jam.',
            groupSR,
            setSR
          )}
          {groupCard(
            'sd',
            'group-title-sd',
            'Kelompok dingin (4 ± 1 °C)',
            'Diukur tiap 24 jam selama 10–14 hari.',
            groupSD,
            setSD
          )}
          <div className="flex gap-2">
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
