"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import SuccessNotice, { useSuccessNotice } from '../../../components/ui/SuccessNotice';
import SessionResultModal from '../../../components/batches/SessionResultModal';
import { PencilIcon, RepeatIcon, CameraIcon } from '../../../components/ui/icons';
import { TIMEPOINT_SEQUENCES, MAX_PHOTO_BYTES, MAX_PHOTO_CAPTION_LENGTH, wibDateTimeLocal } from '../../../shared/dataset.ts';
import { validateStepA, validateStepB, validateGroupFields, groupWeightWarning, parseWibInput, wibInputToUtcIso, type WizardErrors } from '../../../lib/batch-wizard.ts';
import type { ApiSessionStatus } from '../../../lib/api/dataset.ts';

interface SessionItem {
  sessionId: string;
  timepointCode: string;
  elapsedHours: number;
  status: ApiSessionStatus;
  warmupDone: boolean;
  cleaningDone: boolean;
  chamberId: string | null;
  deviceId: string | null;
  startedAtUtc?: string;
  durationSeconds?: number | null;
  shrimpTempC: number | null;
  shrimpWeightG: number | null;
}

interface GroupItem {
  groupId: string;
  storageCondition: string;
  coldStorageMode: string;
  chamberId: string | null;
  targetTempC: number | null;
  labTempC: number | null;
  visualCheck: string;
  labWeightBeforeG: number | null;
  labWeightAfterG: number | null;
  sampleShrimpCount: number;
  sessions: SessionItem[];
}

/** Device yang terpasang pada chamber (butir 4: device dipilih otomatis). */
interface DeviceItem {
  id: string;
  mqttDeviceId: string;
  name: string;
  chamberId: string | null;
}

interface PhotoItem {
  url: string;
  caption: string;
  groupId: string | null;
  sessionId: string | null;
}

interface BatchDetail {
  batchId: string;
  departedAtUtc: string | null;
  procuredAtUtc: string;
  arrivedAtUtc: string;
  marketSource: string;
  sourceType: string;
  shrimpCount: number;
  totalWeightG: number | null;
  shrimpLengthCm: number | null;
  sizeGrade: number;
  initialCondition: string;
  initialTempC: number | null;
  coolerTempDepartureC: number | null;
  coolerTempMarketC: number | null;
  coolerTempLabC: number | null;
  iceToShrimpRatio: string;
  rejectionNotes: string | null;
  photos: PhotoItem[];
  lockedAt: string | null;
  sampleGroups: GroupItem[];
}

const SR_TIMEPOINTS = TIMEPOINT_SEQUENCES.room_temp;
const SD_TIMEPOINTS = TIMEPOINT_SEQUENCES.cold;

const cardCls = 'p-5 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 space-y-3';
const btnPrimary =
  'px-4 py-2 min-h-[44px] rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold tracking-wider transition-all disabled:opacity-50';
const btnGhost =
  'px-4 py-2 min-h-[44px] rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs font-mono font-bold transition-all disabled:opacity-50';
/** Tombol ikon tidak teks: cukup target sentuh 42px, tetap ring fokus. */
const btnAksi =
  'w-[42px] h-[42px] rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70';

/** Tanggal + jam WIB (UTC+7) — input wizard memakai datetime-local WIB. */
const dtFmt = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});
/** Angka id-ID (koma desimal) — dipakai semua nilai numerik di section ini. */
const numFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

const SOURCE_LABEL: Record<string, string> = { market: 'Pasar', supermarket: 'Supermarket', farm: 'Tambak' };
const CONDITION_LABEL: Record<string, string> = { alive: 'Hidup saat dibeli', dead: 'Mati saat dibeli' };

/** Draft form edit utuh (tipe dipakai updater kolom di bawah). */
interface EditDraftStepA {
  departedAt: string;
  coolerDeparture: string;
  marketSource: string;
  sourceType: string;
}
interface EditDraftStepB {
  procuredAt: string;
  arrivedAt: string;
  deviationAck: boolean;
  initialCondition: string;
  shrimpCount: string;
  totalWeightG: string;
  shrimpLengthCm: string;
  initialTempC: string;
  coolerMarket: string;
  coolerLab: string;
}
type EditStepBField = Exclude<keyof EditDraftStepB, 'deviationAck'>;
const VISUAL_LABEL: Record<string, string> = {
  normal: 'Normal',
  melanosis: 'Melanosis (bintik hitam)',
  damaged: 'Rusak fisik',
  mixed_species: 'Campur spesies lain',
};

const EM_DASH = '—';

const num = (v: number | null | undefined, unit = '') =>
  v === null || v === undefined ? EM_DASH : `${numFmt.format(v)}${unit}`;

/** Kelas input form edit utuh: jelas merah bila galat, tenang bila benar. */
const editCls = (hasError: boolean) =>
  `w-full px-3 py-2 rounded-xl bg-black/25 border text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400/60 ${
    hasError ? 'border-rose-400/70' : 'border-white/10'
  }`;

/** Pasangan radio dua pilihan dipakai form edit utuh (kondisi awal, mode simpan). */
function RadioPair({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-[11px] font-mono font-semibold text-white/80">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map(([optValue, label]) => (
          <label key={optValue} className="flex items-center gap-1.5 text-[11px] font-mono text-white/80">
            <input
              type="radio"
              name={name}
              checked={value === optValue}
              onChange={() => onChange(optValue)}
              className="accent-cyan-400"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Durasi (jam) beli→tiba dari pasangan input datetime-local WIB form edit.
 * 0 = belum sah (biar checkbox deviasi tidak muncul saat tanggal kosong). */
function deviasiJamWib(procured: string, arrived: string): number {
  const a = parseWibInput(arrived);
  const p = parseWibInput(procured);
  if (!a.date || !p.date) return 0;
  return (a.date.getTime() - p.date.getTime()) / 3_600_000;
}

/** Tabel riwayat boleh 2 desimal (sensor suhu 0,25 langkah). */
const tabelNumFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

/** Durasi beli→tiba: menit bila <1 jam, jam berpecahan desimal bila ≥1 jam. */
const durationText = (procuredIso: string, arrivedIso: string) => {
  const minutes = Math.round((Date.parse(arrivedIso) - Date.parse(procuredIso)) / 60_000);
  return minutes < 60 ? `${minutes} menit` : `${numFmt.format(minutes / 60)} jam`;
};

/**
 * Pasangan label–nilai: label kecil redup di atas, nilai terang & lebih besar
 * di bawah — hierarki baca jelas, nilai kosong ("—") diredupkan agar mata
 * melompati kolom kosong.
 */
function DataPair({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === EM_DASH;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-mono text-white/55 leading-snug">{label}</dt>
      <dd
        className={`text-sm font-mono font-semibold leading-snug break-words ${
          empty ? 'text-white/30' : 'text-white'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export default function BatchDetailPage() {
  const params = useParams();
  const batchId = decodeURIComponent(params.batchId as string);
  const { user, isLoading, apiFetch } = useAuth();
  const router = useRouter();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form sesi per grup
  const [tpSel, setTpSel] = useState<Record<string, string>>({});
  const [warmup, setWarmup] = useState<Record<string, boolean>>({});
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({});
  const [chSel, setChSel] = useState<Record<string, string>>({});
  const [chambers, setChambers] = useState<Array<{ id: string; code: string; name: string }>>([]);
  // Butir 4: device tidak lagi dipilih; chamber menentukan device, ditampilkan
  // sebagai teks baca-saja.
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [fileCaptions, setFileCaptions] = useState<string[]>([]);
  const [captionEdits, setCaptionEdits] = useState<Record<string, string>>({});
  const [savingCaption, setSavingCaption] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmPhoto, setConfirmPhoto] = useState<{ message: string; photoUrl: string } | null>(null);
  // Form edit semua bagian (ikon pensil): satu tombol, pengadaan + kondisi &
  // dokumentasi + pengelompokan dalam satu form.
  const [editOpen, setEditOpen] = useState(false);
  const [editErrors, setEditErrors] = useState<{
    stepA: WizardErrors;
    stepB: WizardErrors;
    groups: Record<string, WizardErrors>;
  } | null>(null);
  const [editDraft, setEditDraft] = useState<{
    stepA: { departedAt: string; coolerDeparture: string; marketSource: string; sourceType: string };
    stepB: {
      procuredAt: string;
      arrivedAt: string;
      deviationAck: boolean;
      initialCondition: string;
      shrimpCount: string;
      totalWeightG: string;
      shrimpLengthCm: string;
      initialTempC: string;
      coolerMarket: string;
      coolerLab: string;
    };
    groups: Record<string, {
      labTempC: string;
      labWeightBeforeG: string;
      labWeightAfterG: string;
      coldStorageMode: string;
    }>;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Durasi pengujian per group (dalam menit, default 15 menit)
  const [durationMins, setDurationMins] = useState<Record<string, number>>({});
  // Input timepoint kustom per grup
  const [customTp, setCustomTp] = useState<Record<string, string>>({});
  // Konfirmasi hapus tahap pengujian
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<{
    sessionId: string;
    timepointCode: string;
    tahap: number;
  } | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  // Sesi yang sedang dibuka modal grafiknya
  const [resultModalSessionId, setResultModalSessionId] = useState<string | null>(null);
  const completingRef = React.useRef<Set<string>>(new Set());

  // Tick timer per detik untuk live countdown sesi berjalan
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Modal form pra-sesi: input suhu berat foto sebelum start sesi atau ambil data waktu.
  const [sessionModal, setSessionModal] = useState<{
    mode: 'create' | 'edit';
    captureMode?: 'live' | 'time_range';
    startTimeWib?: string;
    groupId: string;
    chamberId?: string;
    sessionId?: string;
    timepointCode: string;
    durationMinutes: number;
    shrimpTempC: string;
    shrimpWeightG: string;
    photos: File[];
    photoPreviews: string[];
    photoCaptions: string[];
    err: string | null;
    busy: boolean;
  } | null>(null);
  const [checkingData, setCheckingData] = useState(false);
  const [dataCheckResult, setDataCheckResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Penampil foto tahap: gambar + caption per sesi (tabel riwayat).
  const [photoViewer, setPhotoViewer] = useState<{
    title: string;
    items: Array<{ url: string; caption: string; index: number }>;
  } | null>(null);
  const { message: notice, notify, dismiss } = useSuccessNotice();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          throw new Error('Batch tidak ditemukan');
        }
        if (!res.ok) {
          throw new Error(`Gagal memuat (${res.status})`);
        }
        return (await res.json()).data as BatchDetail;
      })
      .then((data) => {
        if (cancelled) return;
        setBatch(data);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Gagal memuat batch');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, apiFetch, batchId, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!user) {
      return;
    }
    apiFetch('/api/v1/chambers?active=true&limit=50')
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setChambers(json.data.map((c: { id: string; code: string; name?: string }) => ({
            id: c.id,
            code: c.code,
            name: c.name || c.code,
          })));
        }
      })
      .catch(() => {});
  }, [user, apiFetch]);

  // Butir 4: device diturunkan dari chamber yang terpasang — tanpa dropdown.
  useEffect(() => {
    if (!user) {
      return;
    }
    apiFetch('/api/v1/devices?limit=100')
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setDevices(
            json.data.map(
              (d: {
                id: string;
                mqttDeviceId?: string;
                name?: string;
                activeAssignment?: { chamber?: { id: string } | null } | null;
              }) => ({
                id: d.id,
                mqttDeviceId: d.mqttDeviceId || d.id,
                name: d.name || d.mqttDeviceId || d.id,
                chamberId: d.activeAssignment?.chamber?.id ?? null,
              })
            )
          );
        }
      })
      .catch(() => {});
  }, [user, apiFetch]);

  /** Device yang terpasang pada chamber — pemetaan otomatis, bukan pilihan user. */
  const deviceForChamber = (chamberId: string | null): DeviceItem | null =>
    chamberId ? devices.find((d) => d.chamberId === chamberId) ?? null : null;

  /** Nama chamber untuk ditampilkan (butir 1). */
  const chamberName = (chamberId: string | null): string => {
    if (!chamberId) return '';
    return chambers.find((c) => c.id === chamberId)?.name ?? chamberId;
  };

  /** Label device untuk sesi yang sudah tertaut (butir 4). */
  const deviceLabel = (deviceId: string | null): string | null => {
    if (!deviceId) return null;
    return devices.find((d) => d.id === deviceId)?.mqttDeviceId ?? null;
  };

  const callJson = async (url: string, payload: unknown) => {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message || `Gagal menyimpan (kode ${res.status}). Periksa koneksi lalu coba lagi.`);
    }
    return typeof body.data === 'object' && body.data !== null
      ? { ...body.data, _meta: body.meta }
      : body.data;
  };

  const usedCodes = (g: GroupItem): Set<string> =>
    new Set(g.sessions.filter((s) => s.status !== 'incomplete').map((s) => s.timepointCode));

  const handleReopen = async (s: SessionItem) => {
    setBusy(true);
    setError(null);
    try {
      await callJson(`/api/v1/sessions/${encodeURIComponent(s.sessionId)}/reopen`, {});
      notify(`Sesi ${s.timepointCode} berhasil dibuka kembali.`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuka ulang sesi');
    } finally {
      setBusy(false);
    }
  };

  const suggestNext = (g: GroupItem): string => {
    const seq = g.storageCondition === 'cold' ? SD_TIMEPOINTS : SR_TIMEPOINTS;
    const used = usedCodes(g);
    const nextInSeq = seq.find((t) => !used.has(t));
    if (nextInSeq) return nextInSeq;
    const sorted = [...g.sessions].sort((a, b) => b.elapsedHours - a.elapsedHours);
    if (sorted.length === 0) return 'H0';
    if (g.storageCondition === 'cold') {
      return `H${sorted[0].elapsedHours + 12}`;
    }
    return `H${sorted[0].elapsedHours + 6}`;
  };

  const handleCreateSession = async (g: GroupItem, captureMode: 'live' | 'time_range' = 'live') => {
    let timepointCode = tpSel[g.groupId] || suggestNext(g);
    if (timepointCode === 'CUSTOM') {
      timepointCode = (customTp[g.groupId] || '').trim().toUpperCase();
      if (!/^(H|D)[0-9]+$/.test(timepointCode)) {
        setError('Format timepoint kustom harus diawali H (jam) atau D (hari) diikuti angka, misal H3 atau D15');
        return;
      }
    }
    const used = usedCodes(g);
    if (used.has(timepointCode)) {
      setError(`Timepoint ${timepointCode} sudah digunakan dalam grup ini. Gunakan kode timepoint yang lain.`);
      return;
    }
    if (captureMode === 'live' && !warmup[g.groupId]) {
      setError('Nyalakan sensor 30 menit dulu (centang warmup) sebelum Start sesi');
      return;
    }
    const defaultMins = durationMins[g.groupId] ?? 15;
    const defaultChamberId = chSel[g.groupId] || g.chamberId || (chambers.length === 1 ? chambers[0].id : '');
    const defaultStart = captureMode === 'time_range'
      ? new Date(Date.now() - defaultMins * 60_000)
      : new Date();
    setDataCheckResult(null);
    // Modal form tahap baru: isi suhu/berat/foto dulu, sesi dibuat setelah submit.
    setSessionModal({
      mode: 'create',
      captureMode,
      startTimeWib: wibDateTimeLocal(defaultStart),
      groupId: g.groupId,
      chamberId: defaultChamberId,
      timepointCode,
      durationMinutes: defaultMins,
      shrimpTempC: '',
      shrimpWeightG: '',
      photos: [],
      photoPreviews: [],
      photoCaptions: [],
      err: null,
      busy: false,
    });
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeletingSession(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal menghapus tahap (kode ${res.status}).`);
      }
      notify(`Tahap ${confirmDeleteSession?.timepointCode ?? ''} berhasil dihapus.`);
      setConfirmDeleteSession(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus tahap pengujian');
    } finally {
      setDeletingSession(false);
    }
  };

  const openSessionEdit = (g: GroupItem, s: SessionItem) => {
    // Ikon pensil di tabel riwayat: koreksi data observasi satu tahap.
    // Input type=number memakai titik desimal, jadi prefill tanpa konversi.
    setSessionModal({
      mode: 'edit',
      groupId: g.groupId,
      sessionId: s.sessionId,
      timepointCode: s.timepointCode,
      durationMinutes: s.durationSeconds ? Math.round(s.durationSeconds / 60) : 15,
      shrimpTempC: s.shrimpTempC === null ? '' : String(s.shrimpTempC),
      shrimpWeightG: s.shrimpWeightG === null ? '' : String(s.shrimpWeightG),
      photos: [],
      photoPreviews: [],
      photoCaptions: [],
      err: null,
      busy: false,
    });
  };

  /** Nomor tahap dinamis = posisi timepoint urut di tabel. */
  const tahapOf = (g: GroupItem, timepointCode: string): number => {
    const idx = g.sessions.findIndex((s) => s.timepointCode === timepointCode);
    if (idx >= 0) return idx + 1;
    const seq = g.storageCondition === 'cold' ? SD_TIMEPOINTS : SR_TIMEPOINTS;
    const i = seq.indexOf(timepointCode);
    return i >= 0 ? i + 1 : g.sessions.length + 1;
  };

  // Handler submit modal tahap: simpan suhu/berat (+foto) lalu buat/tandai sesi.
  const handleSessionModalSubmit = async () => {
    if (!sessionModal) return;
    const {
      mode,
      captureMode,
      startTimeWib,
      groupId,
      sessionId,
      timepointCode,
      durationMinutes,
      shrimpTempC,
      shrimpWeightG,
      photos,
      photoCaptions,
    } = sessionModal;
    const fail = (msg: string) =>
      setSessionModal((m) => (m ? { ...m, err: msg, busy: false } : null));
    const tempOk = shrimpTempC.trim() === '' || Number.isFinite(Number(shrimpTempC));
    const weightOk = shrimpWeightG.trim() === '' || Number.isFinite(Number(shrimpWeightG));
    const durationOk = Number.isFinite(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 120;
    if (!durationOk) {
      fail('Durasi pengujian harus antara 1 sampai 120 menit.');
      return;
    }
    if (!tempOk || !weightOk) {
      fail('Suhu dan berat harus angka yang sah (atau dikosongkan).');
      return;
    }

    let startedAtUtc: Date | undefined;
    let endedAtUtc: Date | undefined;
    if (mode === 'create' && captureMode === 'time_range') {
      if (!startTimeWib || startTimeWib.trim() === '') {
        fail('Waktu mulai pengujian wajib diisi.');
        return;
      }
      const parsed = parseWibInput(startTimeWib);
      if (!parsed.date || parsed.error) {
        fail('Format tanggal dan jam mulai (WIB) tidak valid.');
        return;
      }
      startedAtUtc = parsed.date;
      endedAtUtc = new Date(startedAtUtc.getTime() + durationMinutes * 60_000);
      if (endedAtUtc.getTime() > Date.now() + 60_000) {
        fail('Rentang waktu yang dipilih belum selesai (waktu selesai masih di masa depan). Untuk pengujian saat ini, silakan gunakan mode "Rekam Langsung (Live)".');
        return;
      }
    } else if (mode === 'create' && captureMode !== 'time_range' && !warmup[groupId]) {
      fail('Nyalakan sensor 30 menit dulu (centang warmup) sebelum mulai rekam langsung.');
      return;
    }

    if (photos.length > 0) {
      const badCaption = photoCaptions.findIndex((c) => c.trim() === '' || c.trim().length > MAX_PHOTO_CAPTION_LENGTH);
      if (badCaption >= 0) {
        fail(`Caption foto ke-${badCaption + 1} wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter).`);
        return;
      }
    }
    setSessionModal((m) => (m ? { ...m, busy: true, err: null } : null));
    try {
      // 1. Suhu/berat: mode edit kirim semua (pencil koreksi, kosong = null);
      // mode create hanya kirim yang diisi lalu ke POST sesi.
      const shrimpFields: Record<string, unknown> = {};
      if (shrimpTempC.trim() !== '') shrimpFields.shrimpTempC = Number(shrimpTempC);
      if (shrimpWeightG.trim() !== '') shrimpFields.shrimpWeightG = Number(shrimpWeightG);

      let createdSessionId: string | undefined;
      let linkedCount: number | undefined;

      if (mode === 'edit') {
        const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId ?? '')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shrimpTempC: shrimpTempC.trim() === '' ? null : Number(shrimpTempC),
            shrimpWeightG: shrimpWeightG.trim() === '' ? null : Number(shrimpWeightG),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error?.message || `Gagal menyimpan data tahap (kode ${res.status}).`);
        // Grup "langsung di kulkas" (butir 1) tidak pernah ditautkan ke chamber.
        const targetGroup = batch?.sampleGroups.find((grp) => grp.groupId === groupId);
        const chosenChamberId =
          targetGroup?.coldStorageMode === 'plain_fridge'
            ? null
            : (sessionModal.chamberId || chSel[groupId] || targetGroup?.chamberId || null);

        if (captureMode === 'time_range' && targetGroup?.coldStorageMode !== 'plain_fridge' && !chosenChamberId) {
          fail('Pilih Chamber terlebih dahulu agar data sensor pada rentang waktu tersebut dapat ditarik.');
          return;
        }

        const durationSeconds = Math.round(durationMinutes * 60);

        const payload: Record<string, unknown> = {
          timepointCode,
          warmupDone: true,
          chamberId: chosenChamberId,
          durationSeconds,
          ...shrimpFields,
        };

        if (captureMode === 'time_range' && startedAtUtc && endedAtUtc) {
          payload.startedAtUtc = startedAtUtc.toISOString();
          payload.endedAtUtc = endedAtUtc.toISOString();
          payload.autoBackfill = true;
        }

        const created = (await callJson(
          `/api/v1/groups/${encodeURIComponent(groupId)}/sessions`,
          payload
        )) as { sessionId?: string; _meta?: { linkedReadings?: number } };

        createdSessionId = created?.sessionId;
        linkedCount = created?._meta?.linkedReadings;
      }

      // 2. Foto tahap terangkai ke sesi ini (caption wajib).
      if (photos.length > 0) {
        const targetSessionId = mode === 'edit' ? sessionId : createdSessionId;
        if (targetSessionId) {
          const form = new FormData();
          for (const f of photos) form.append('photos', f);
          form.append('captions', JSON.stringify(photoCaptions));
          form.append('sessionId', targetSessionId);
          const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
            method: 'POST',
            body: form,
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error?.message || `Gagal mengunggah foto (kode ${res.status}).`);
        }
      }
      setSessionModal(null);
      if (mode === 'edit') {
        notify(`Data tahap ${timepointCode} berhasil diperbarui.`);
      } else if (captureMode === 'time_range') {
        if (linkedCount && linkedCount > 0) {
          notify(`Sesi ${timepointCode} berhasil dibuat dari rentang waktu (${durationMinutes} mnt). Sebanyak ${linkedCount} data sensor berhasil dikaitkan.`);
        } else {
          notify(`Sesi ${timepointCode} berhasil dibuat (${durationMinutes} mnt), namun belum ada data sensor yang terekam pada jam tersebut.`);
        }
        if (createdSessionId) {
          setResultModalSessionId(createdSessionId);
        }
      } else {
        notify(`Sesi ${timepointCode} berhasil dimulai (${durationMinutes} menit).`);
      }
      refresh();
    } catch (err) {
      setSessionModal((m) => (m ? { ...m, err: err instanceof Error ? err.message : 'Gagal menyimpan', busy: false } : null));
    }
  };

  const handleComplete = async (s: SessionItem, isAuto = false) => {
    if (completingRef.current.has(s.sessionId)) return;
    completingRef.current.add(s.sessionId);

    if (!isAuto && !cleaning[s.sessionId]) {
      setError('Bersihkan chamber alkohol 70% dulu (centang cleaning) sebelum complete');
      completingRef.current.delete(s.sessionId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callJson(`/api/v1/sessions/${encodeURIComponent(s.sessionId)}/complete`, {
        cleaningDone: true,
      });
      notify(isAuto ? `Pengujian ${s.timepointCode} telah selesai. Data berhasil direkam.` : `Sesi ${s.timepointCode} berhasil diselesaikan.`);
      setResultModalSessionId(s.sessionId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal complete sesi');
    } finally {
      setBusy(false);
      completingRef.current.delete(s.sessionId);
    }
  };

  const handleCompleteRef = React.useRef(handleComplete);
  handleCompleteRef.current = handleComplete;

  // Monitor auto-complete saat countdown mencapai batas durasi
  useEffect(() => {
    if (!batch || !!batch.lockedAt) return;
    for (const g of batch.sampleGroups) {
      for (const s of g.sessions) {
        if (s.status === 'open' && s.startedAtUtc) {
          const startedMs = new Date(s.startedAtUtc).getTime();
          const targetSeconds = s.durationSeconds ?? (durationMins[g.groupId] ? durationMins[g.groupId] * 60 : 900);
          const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
          if (elapsedSeconds >= targetSeconds) {
            void handleCompleteRef.current(s, true);
          }
        }
      }
    }
  }, [nowMs, batch, durationMins]);

  /** Pilih foto: tambah ke yang sudah ada (bukan mengganti). */
  const handlePhotoSelect = (list: FileList | null, input: HTMLInputElement) => {
    const incoming = Array.from(list ?? []);
    const usable = incoming.filter((f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0);
    const fitting = usable.filter((f) => f.size <= MAX_PHOTO_BYTES);
    const accepted = fitting;
    if (accepted.length < incoming.length) {
      setError('Ada file yang dilewati: hanya JPG/PNG dan maksimal 5 MB per file.');
    }
    setFiles((prev) => [...prev, ...accepted]);
    setFilePreviews((prev) => [...prev, ...accepted.map((f) => URL.createObjectURL(f))]);
    setFileCaptions((prev) => [...prev, ...accepted.map(() => '')]);
    input.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(filePreviews[index]);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
    setFileCaptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Pilih minimal 1 file foto dulu');
      return;
    }
    const badCaption = fileCaptions.findIndex(
      (c) => c.trim() === '' || c.trim().length > MAX_PHOTO_CAPTION_LENGTH
    );
    if (badCaption >= 0) {
      setError(`Caption foto ke-${badCaption + 1} wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) {
        form.append('photos', f);
      }
      form.append('captions', JSON.stringify(fileCaptions));
      const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal mengunggah foto (kode ${res.status}). Periksa koneksi lalu coba lagi.`);
      }
      notify(`Berhasil mengunggah ${files.length} foto.`);
      filePreviews.forEach((src) => URL.revokeObjectURL(src));
      setFiles([]);
      setFilePreviews([]);
      setFileCaptions([]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal upload foto');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCaption = async (photoUrl: string) => {
    const caption = (captionEdits[photoUrl] ?? '').trim();
    if (caption === '' || caption.length > MAX_PHOTO_CAPTION_LENGTH) {
      setError(`Caption wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter).`);
      return;
    }
    setSavingCaption(photoUrl);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: [{ url: photoUrl, caption }] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal menyimpan caption (kode ${res.status}). Periksa koneksi lalu coba lagi.`);
      }
      notify('Caption foto berhasil disimpan.');
      setCaptionEdits((prev) => {
        const next = { ...prev };
        delete next[photoUrl];
        return next;
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan caption');
    } finally {
      setSavingCaption(null);
    }
  };

  const handleLock = async () => {
    if (!window.confirm(`Kunci batch ${batchId}? Setelah terkunci tidak bisa diubah.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callJson(`/api/v1/batches/${encodeURIComponent(batchId)}/lock`, {});
      notify(`Batch ${batchId} berhasil dikunci.`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunci batch');
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePhoto = async (photoUrl: string) => {
    setConfirmPhoto(null);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrls: [photoUrl] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal menghapus foto (kode ${res.status}). Periksa koneksi lalu coba lagi.`);
      }
      notify('Foto berhasil dihapus.');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus foto');
    } finally {
      setBusy(false);
    }
  };

  /** Buka form edit semua bagian (pengadaan, kondisi & dokumentasi, pengelompokan). */
  const startEdit = () => {
    if (!batch) return;
    const wib = (iso: string | null) => (iso ? wibDateTimeLocal(new Date(iso)) : '');
    setEditErrors(null);
    setEditDraft({
      stepA: {
        departedAt: wib(batch.departedAtUtc),
        coolerDeparture: batch.coolerTempDepartureC === null ? '' : String(batch.coolerTempDepartureC),
        marketSource: batch.marketSource,
        sourceType: batch.sourceType,
      },
      stepB: {
        procuredAt: wib(batch.procuredAtUtc),
        arrivedAt: wib(batch.arrivedAtUtc),
        deviationAck: false,
        initialCondition: batch.initialCondition,
        shrimpCount: String(batch.shrimpCount),
        totalWeightG: batch.totalWeightG === null ? '' : String(batch.totalWeightG),
        shrimpLengthCm: batch.shrimpLengthCm === null ? '' : String(batch.shrimpLengthCm),
        initialTempC: batch.initialTempC === null ? '' : String(batch.initialTempC),
        coolerMarket: batch.coolerTempMarketC === null ? '' : String(batch.coolerTempMarketC),
        coolerLab: batch.coolerTempLabC === null ? '' : String(batch.coolerTempLabC),
      },
      groups: Object.fromEntries(
        batch.sampleGroups.map((g) => [
          g.groupId,
          {
            labTempC: g.labTempC === null ? '' : String(g.labTempC),
            labWeightBeforeG: g.labWeightBeforeG === null ? '' : String(g.labWeightBeforeG),
            labWeightAfterG: g.labWeightAfterG === null ? '' : String(g.labWeightAfterG),
            coldStorageMode: g.coldStorageMode === 'plain_fridge' ? 'plain_fridge' : 'chamber',
          },
        ])
      ),
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditDraft(null);
    setEditErrors(null);
  };

  /** Update satu kolom langkah Pengadaan di form edit utuh + bersihkan galatnya. */
  const updateStepA = (key: keyof EditDraftStepA, value: string) => {
    setEditDraft((d) => (d ? { ...d, stepA: { ...d.stepA, [key]: value } } : d));
    setEditErrors((prev) => {
      if (!prev?.stepA[key]) return prev;
      const next = { ...prev, stepA: { ...prev.stepA } };
      delete next.stepA[key];
      return next;
    });
  };

  /** Update satu kolom langkah Kondisi & dokumentasi (kecuali checkbox deviasi). */
  const updateStepB = (key: EditStepBField, value: string) => {
    setEditDraft((d) => (d ? { ...d, stepB: { ...d.stepB, [key]: value } } : d));
    setEditErrors((prev) => {
      if (!prev?.stepB[key]) return prev;
      const next = { ...prev, stepB: { ...prev.stepB } };
      delete next.stepB[key];
      return next;
    });
  };

  /** Update kolom satu grup (pengelompokan) di form edit utuh. */
  const updateGroup = (groupId: string, key: string, value: string) => {
    setEditDraft((d) =>
      d ? { ...d, groups: { ...d.groups, [groupId]: { ...d.groups[groupId], [key]: value } } } : d
    );
    setEditErrors((prev) => {
      if (!prev?.groups[groupId]?.[key]) return prev;
      return {
        ...prev,
        groups: {
          ...prev.groups,
          [groupId]: (() => {
            const next = { ...prev.groups[groupId] };
            delete next[key];
            return next;
          })(),
        },
      };
    });
  };

  /** Sunting form edit utuh: PATCH batch lalu PATCH tiap grup yang diubah. */  const saveEdit = async () => {
    if (!editDraft || !batch) return;
    const errs = {
      stepA: validateStepA(editDraft.stepA),
      stepB: validateStepB({ ...editDraft.stepB, departedAt: editDraft.stepA.departedAt }),
      groups: {} as Record<string, WizardErrors>,
    };
    for (const g of batch.sampleGroups) {
      const draft = editDraft.groups[g.groupId];
      if (!draft) continue;
      errs.groups[g.groupId] = validateGroupFields({
        labTempC: draft.labTempC,
        visualCheck: g.visualCheck,
        labWeightBeforeG: draft.labWeightBeforeG,
        labWeightAfterG: draft.labWeightAfterG,
        sampleShrimpCount: String(g.sampleShrimpCount),
      });
    }
    if (
      Object.keys(errs.stepA).length > 0 ||
      Object.keys(errs.stepB).length > 0 ||
      Object.values(errs.groups).some((e) => Object.keys(e).length > 0)
    ) {
      setEditErrors(errs);
      notify('Periksa lagi kolom yang ditandai.');
      return;
    }
    setEditErrors(null);
    setSavingEdit(true);
    try {
      // Deviasi cold-chain dicatat otomatis bila durasi beli→tiba di form >3 jam.
      const durasiJam =
        (Date.parse(wibInputToUtcIso(editDraft.stepB.arrivedAt)) -
          Date.parse(wibInputToUtcIso(editDraft.stepB.procuredAt))) / 3_600_000;
      const batchRes = await apiFetch(`/api/v1/batches/${encodeURIComponent(batch.batchId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departedAtUtc: wibInputToUtcIso(editDraft.stepA.departedAt),
          marketSource: editDraft.stepA.marketSource.trim(),
          sourceType: editDraft.stepA.sourceType,
          coolerTempDepartureC: Number(editDraft.stepA.coolerDeparture),
          procuredAtUtc: wibInputToUtcIso(editDraft.stepB.procuredAt),
          arrivedAtUtc: wibInputToUtcIso(editDraft.stepB.arrivedAt),
          deviationAcknowledged: durasiJam > 3 ? true : undefined,
          initialCondition: editDraft.stepB.initialCondition,
          shrimpCount: Number(editDraft.stepB.shrimpCount),
          totalWeightG: Number(editDraft.stepB.totalWeightG),
          shrimpLengthCm: Number(editDraft.stepB.shrimpLengthCm),
          initialTempC: Number(editDraft.stepB.initialTempC),
          coolerTempMarketC: Number(editDraft.stepB.coolerMarket),
          coolerTempLabC: Number(editDraft.stepB.coolerLab),
        }),
      });
      const batchBody = await batchRes.json().catch(() => ({}));
      if (!batchRes.ok) {
        throw new Error(batchBody.error?.message || `Gagal menyimpan data batch (kode ${batchRes.status}).`);
      }
      for (const g of batch.sampleGroups) {
        const draft = editDraft.groups[g.groupId];
        if (!draft) continue;
        const res = await apiFetch(`/api/v1/groups/${encodeURIComponent(g.groupId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            labTempC: Number(draft.labTempC),
            labWeightBeforeG: Number(draft.labWeightBeforeG),
            labWeightAfterG: Number(draft.labWeightAfterG),
            ...(g.storageCondition === 'cold'
              ? { coldStorageMode: draft.coldStorageMode }
              : {}),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error?.message || `Gagal menyimpan grup ${g.groupId} (kode ${res.status}).`);
        }
      }
      closeEdit();
      notify('Data batch berhasil diperbarui.');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan data batch.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  if (error && !batch) {
    return (
      <div role="alert" className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
        {error}
      </div>
    );
  }

  if (!batch) {
    return null;
  }

  const isAdmin = user.role === 'ADMIN';
  const locked = !!batch.lockedAt;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-mono font-black text-white tracking-widest">{batch.batchId}</h2>
          <p className="text-xs font-mono text-white/60 mt-1">
            {batch.marketSource} • {batch.shrimpCount} ekor • {batch.totalWeightG ?? '--'} g • {batch.shrimpLengthCm ?? '--'} cm
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/v1/batches/${encodeURIComponent(batch.batchId)}/export?format=metadata`}
            download
            className="px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold tracking-wider transition-all"
          >
            Unduh Metadata
          </a>
          <a
            href={`/api/v1/batches/${encodeURIComponent(batch.batchId)}/export`}
            download
            className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-mono font-bold tracking-wider transition-all"
          >
            Unduh CSV Data
          </a>
          {locked ? (
            <span className="text-[10px] font-mono px-2 py-1 rounded border uppercase bg-white/10 text-white/60 border-white/20">
              Terkunci
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-1 rounded border uppercase bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
              Terbuka
            </span>
          )}
          {isAdmin && !locked && (
            <button onClick={() => void handleLock()} disabled={busy} className={btnPrimary}>
              Kunci Batch
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmPhoto !== null}
        title="Hapus foto ini?"
        message={confirmPhoto?.message ?? ''}
        confirmLabel="Ya, hapus"
        busy={busy}
        onConfirm={() => {
          if (confirmPhoto) {
            void handleDeletePhoto(confirmPhoto.photoUrl);
          }
        }}
        onCancel={() => setConfirmPhoto(null)}
      />

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
          {error}
        </div>
      )}

      <SuccessNotice message={notice} onDismiss={dismiss} />

      <div className={cardCls}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-mono font-bold text-white tracking-widest">DATA PENCATATAN</h3>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-mono text-white/45">
              Unduh metadata bersifat opsional — data form tampil di sini.
            </p>
            {isAdmin && !locked && !editOpen && (
              <button type="button" onClick={startEdit} className={btnGhost}>
                <PencilIcon className="w-3.5 h-3.5" aria-hidden="true" />
                Edit data
              </button>
            )}
          </div>
        </div>

        {editOpen && editDraft && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
            className="rounded-2xl border border-emerald-400/25 bg-black/20 p-4 space-y-5"
          >
            <p className="text-[11px] font-mono text-white/55">
              Aturan sama dengan wizard: waktu WIB 05:00–08:00, suhu -2..30 °C, cool box -10..10 °C, berat &gt; 0 g.
            </p>

            <fieldset className="space-y-3">
              <legend className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengadaan
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 col-span-1 sm:col-span-2">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Tanggal dan jam berangkat (WIB) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    type="datetime-local"
                    autoComplete="off"
                    value={editDraft.stepA.departedAt}
                    aria-invalid={!!editErrors?.stepA['departedAt']}
                    onChange={(e) => updateStepA('departedAt', e.target.value)}
                    className={editCls(!!editErrors?.stepA['departedAt'])}
                  />
                  {editErrors?.stepA['departedAt'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepA['departedAt']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Jenis sumber <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <select
                    value={editDraft.stepA.sourceType}
                    aria-invalid={!!editErrors?.stepA['sourceType']}
                    onChange={(e) => updateStepA('sourceType', e.target.value)}
                    className={editCls(!!editErrors?.stepA['sourceType'])}
                  >
                    <option value="market" className="bg-slate-900">Pasar</option>
                    <option value="supermarket" className="bg-slate-900">Supermarket</option>
                    <option value="farm" className="bg-slate-900">Tambak</option>
                  </select>
                  {editErrors?.stepA['sourceType'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepA['sourceType']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Sumber <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={editDraft.stepA.marketSource}
                    aria-invalid={!!editErrors?.stepA['marketSource']}
                    onChange={(e) => updateStepA('marketSource', e.target.value)}
                    placeholder="Pasar Induk Kramat Jati, Supermarket X…"
                    className={editCls(!!editErrors?.stepA['marketSource'])}
                  />
                  {editErrors?.stepA['marketSource'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepA['marketSource']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Suhu cool box saat berangkat (°C) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepA.coolerDeparture}
                    aria-invalid={!!editErrors?.stepA['coolerDeparture']}
                    onChange={(e) => updateStepA('coolerDeparture', e.target.value)}
                    className={editCls(!!editErrors?.stepA['coolerDeparture'])}
                  />
                  {editErrors?.stepA['coolerDeparture'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepA['coolerDeparture']}</span>
                  )}
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Kondisi &amp; dokumentasi
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Tanggal dan jam beli (WIB) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    type="datetime-local"
                    autoComplete="off"
                    value={editDraft.stepB.procuredAt}
                    aria-invalid={!!editErrors?.stepB['procuredAt']}
                    onChange={(e) => updateStepB('procuredAt', e.target.value)}
                    className={editCls(!!editErrors?.stepB['procuredAt'])}
                  />
                  {editErrors?.stepB['procuredAt'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['procuredAt']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Tanggal dan jam tiba di lab (WIB) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    type="datetime-local"
                    autoComplete="off"
                    value={editDraft.stepB.arrivedAt}
                    aria-invalid={!!editErrors?.stepB['arrivedAt']}
                    onChange={(e) => updateStepB('arrivedAt', e.target.value)}
                    className={editCls(!!editErrors?.stepB['arrivedAt'])}
                  />
                  {editErrors?.stepB['arrivedAt'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['arrivedAt']}</span>
                  )}
                  {deviasiJamWib(editDraft.stepB.procuredAt, editDraft.stepB.arrivedAt) > 3 && (
                    <label className="flex items-center gap-1.5 text-[10px] font-mono text-amber-200/90 mt-0.5">
                      <input
                        type="checkbox"
                        checked={editDraft.stepB.deviationAck}
                        onChange={(e) =>
                          setEditDraft((d) =>
                            d ? { ...d, stepB: { ...d.stepB, deviationAck: e.target.checked } } : d
                          )
                        }
                        className="accent-amber-400"
                      />
                      Deviasi cold-chain (&gt; 3 jam) — catat sebagai deviasi
                    </label>
                  )}
                </label>
                <span className="hidden md:block" />
                <RadioPair
                  legend="Kondisi awal udang"
                  name="edit-initialCondition"
                  value={editDraft.stepB.initialCondition}
                  options={[['alive', 'Hidup saat dibeli'], ['dead', 'Mati saat dibeli']]}
                  onChange={(v) => updateStepB('initialCondition', v)}
                />
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Jumlah total udang (ekor) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-shrimpCount"
                    type="number"
                    step="1"
                    inputMode="numeric"
                    autoComplete="off"
                    value={editDraft.stepB.shrimpCount}
                    aria-invalid={!!editErrors?.stepB['shrimpCount']}
                    onChange={(e) => updateStepB('shrimpCount', e.target.value)}
                    className={editCls(!!editErrors?.stepB['shrimpCount'])}
                  />
                  {editErrors?.stepB['shrimpCount'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['shrimpCount']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Berat total udang (gram) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-totalWeightG"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepB.totalWeightG}
                    aria-invalid={!!editErrors?.stepB['totalWeightG']}
                    onChange={(e) => updateStepB('totalWeightG', e.target.value)}
                    className={editCls(!!editErrors?.stepB['totalWeightG'])}
                  />
                  {editErrors?.stepB['totalWeightG'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['totalWeightG']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Panjang udang (cm) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-shrimpLengthCm"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepB.shrimpLengthCm}
                    aria-invalid={!!editErrors?.stepB['shrimpLengthCm']}
                    onChange={(e) => updateStepB('shrimpLengthCm', e.target.value)}
                    className={editCls(!!editErrors?.stepB['shrimpLengthCm'])}
                  />
                  {editErrors?.stepB['shrimpLengthCm'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['shrimpLengthCm']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Suhu awal udang (°C) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-initialTempC"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepB.initialTempC}
                    aria-invalid={!!editErrors?.stepB['initialTempC']}
                    onChange={(e) => updateStepB('initialTempC', e.target.value)}
                    className={editCls(!!editErrors?.stepB['initialTempC'])}
                  />
                  {editErrors?.stepB['initialTempC'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['initialTempC']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Suhu cool box saat di pasar (°C) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-coolerMarket"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepB.coolerMarket}
                    aria-invalid={!!editErrors?.stepB['coolerMarket']}
                    onChange={(e) => updateStepB('coolerMarket', e.target.value)}
                    className={editCls(!!editErrors?.stepB['coolerMarket'])}
                  />
                  {editErrors?.stepB['coolerMarket'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['coolerMarket']}</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-mono font-semibold text-white/80">
                    Suhu cool box saat di lab (°C) <span aria-hidden="true" className="text-rose-400">*</span>
                  </span>
                  <input
                    name="edit-coolerLab"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    autoComplete="off"
                    value={editDraft.stepB.coolerLab}
                    aria-invalid={!!editErrors?.stepB['coolerLab']}
                    onChange={(e) => updateStepB('coolerLab', e.target.value)}
                    className={editCls(!!editErrors?.stepB['coolerLab'])}
                  />
                  {editErrors?.stepB['coolerLab'] && (
                    <span role="alert" className="text-[11px] font-mono text-rose-300">{editErrors.stepB['coolerLab']}</span>
                  )}
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengelompokan
              </legend>
              {batch.sampleGroups.map((g) => {
                const draft = editDraft.groups[g.groupId];
                const gErr = editErrors?.groups[g.groupId] ?? {};
                if (!draft) return null;
                return (
                  <div
                    key={g.groupId}
                    className={`rounded-xl p-3 space-y-2 bg-black/25 pl-3 border-l-2 ${
                      g.storageCondition === 'cold' ? 'border-cyan-400/60' : 'border-amber-300/60'
                    }`}
                  >
                    <p className="text-xs font-mono font-bold text-white">
                      {g.groupId} •{' '}
                      {g.storageCondition === 'cold'
                        ? `Suhu Dingin, ${draft.coldStorageMode === 'plain_fridge' ? 'langsung di kulkas' : 'chamber'} (4 ± 1 °C)`
                        : 'Suhu Ruang (25 ± 2 °C)'}
                    </p>
                    {g.storageCondition === 'cold' && (
                      <RadioPair
                        legend="Tempat penyimpanan"
                        name={`edit-cold-mode-${g.groupId}`}
                        value={draft.coldStorageMode}
                        options={[['chamber', 'Dalam chamber'], ['plain_fridge', 'Langsung di kulkas, tanpa chamber']]}
                        onChange={(v) => updateGroup(g.groupId, 'coldStorageMode', v)}
                      />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(
                        [
                          ['labTempC', 'Suhu udang (°C)', '6.5…'],
                          ['labWeightBeforeG', 'Berat sampel sebelum observasi (g)', '482.0…'],
                          ['labWeightAfterG', 'Berat total udang (g)', '478.5…'],
                        ] as const
                      ).map(([key, label, placeholder]) => (
                        <label key={key} className="flex flex-col gap-1">
                          <span className="text-[11px] font-mono font-semibold text-white/80">
                            {label} <span aria-hidden="true" className="text-rose-400">*</span>
                          </span>
                          <input
                            name={`edit-${g.groupId}-${key}`}
                            type="number"
                            step="0.1"
                            inputMode="decimal"
                            autoComplete="off"
                            value={draft[key]}
                            aria-invalid={!!gErr[key]}
                            onChange={(e) => updateGroup(g.groupId, key, e.target.value)}
                            placeholder={placeholder}
                            className={editCls(!!gErr[key])}
                          />
                          {gErr[key] && (
                            <span role="alert" className="text-[11px] font-mono text-rose-300">{gErr[key]}</span>
                          )}
                        </label>
                      ))}
                    </div>
                    {groupWeightWarning({
                      labTempC: draft.labTempC,
                      visualCheck: g.visualCheck,
                      labWeightBeforeG: draft.labWeightBeforeG,
                      labWeightAfterG: draft.labWeightAfterG,
                      sampleShrimpCount: String(g.sampleShrimpCount),
                    }) && (
                      <p className="text-[11px] font-mono text-amber-200/90">
                        {groupWeightWarning({
                          labTempC: draft.labTempC,
                          visualCheck: g.visualCheck,
                          labWeightBeforeG: draft.labWeightBeforeG,
                          labWeightAfterG: draft.labWeightAfterG,
                          sampleShrimpCount: String(g.sampleShrimpCount),
                        })}
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>

            <div className="flex gap-2">
              <button type="submit" disabled={savingEdit} className={btnPrimary}>
                Simpan perubahan
              </button>
              <button type="button" onClick={closeEdit} disabled={savingEdit} className={btnGhost}>
                Batal
              </button>
            </div>
          </form>
        )}

        {!editOpen && (
          <>
            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengadaan
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                <DataPair
                  label="Tanggal dan jam berangkat (WIB)"
                  value={batch.departedAtUtc ? dtFmt.format(new Date(batch.departedAtUtc)) : '—'}
                />
                <DataPair label="Sumber" value={batch.marketSource} />
                <DataPair label="Jenis sumber" value={SOURCE_LABEL[batch.sourceType] ?? batch.sourceType} />
                <DataPair label="Suhu cool box saat berangkat (°C)" value={num(batch.coolerTempDepartureC, ' °C')} />
              </dl>
            </div>

            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Kondisi &amp; dokumentasi
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                <DataPair label="Tanggal dan jam beli (WIB)" value={dtFmt.format(new Date(batch.procuredAtUtc))} />
                <DataPair label="Tanggal dan jam tiba di lab (WIB)" value={dtFmt.format(new Date(batch.arrivedAtUtc))} />
                <DataPair label="Durasi beli ke tiba" value={durationText(batch.procuredAtUtc, batch.arrivedAtUtc)} />
                <DataPair label="Kondisi awal udang" value={CONDITION_LABEL[batch.initialCondition] ?? batch.initialCondition} />
                <DataPair label="Jumlah total udang (ekor)" value={num(batch.shrimpCount)} />
                <DataPair label="Berat total udang (g)" value={num(batch.totalWeightG, ' g')} />
                <DataPair label="Panjang udang (cm)" value={num(batch.shrimpLengthCm, ' cm')} />
                <DataPair label="Ukuran (ekor/kg)" value={num(batch.sizeGrade)} />
                <DataPair label="Suhu awal udang (°C)" value={num(batch.initialTempC, ' °C')} />
                <DataPair label="Suhu cool box saat di pasar (°C)" value={num(batch.coolerTempMarketC, ' °C')} />
                <DataPair label="Suhu cool box saat di lab (°C)" value={num(batch.coolerTempLabC, ' °C')} />
              </dl>
              <p className="text-[11px] font-mono text-white/40 mt-1.5">
                Foto kondisi awal tampil di kartu Foto Dokumentasi di bawah.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengelompokan
              </p>
              <div className="space-y-4">
                {batch.sampleGroups.map((g) => (
                  <div
                    key={g.groupId}
                    className={`pl-3 border-l-2 ${
                      g.storageCondition === 'cold' ? 'border-cyan-400/60' : 'border-amber-300/60'
                    }`}
                  >
                    <p className="text-xs font-mono font-bold text-white">
                      {g.groupId} •{' '}
                      {g.storageCondition === 'cold'
                        ? `Suhu Dingin, ${g.coldStorageMode === 'plain_fridge' ? 'langsung di kulkas' : 'chamber'} (4 ± 1 °C)`
                        : 'Suhu Ruang (25 ± 2 °C)'}
                    </p>
                    <p className="text-[11px] font-mono text-white/50">
                      {g.storageCondition === 'cold'
                        ? g.coldStorageMode === 'plain_fridge'
                          ? 'Penyimpanan: langsung di kulkas (tanpa chamber).'
                          : `Penyimpanan: dalam chamber${g.chamberId ? ` — ${chamberName(g.chamberId)}` : ' (belum ditugaskan)'}.`
                        : 'Penyimpanan: ruang (25 ± 1 °C).'}
                    </p>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 mt-1.5">
                      <DataPair label="Suhu udang (°C)" value={num(g.labTempC, ' °C')} />
                      <DataPair label="Temuan visual udang" value={VISUAL_LABEL[g.visualCheck] ?? g.visualCheck} />
                      <DataPair label="Jumlah udang per sesi (ekor)" value={num(g.sampleShrimpCount)} />
                      <DataPair label="Berat sampel sebelum observasi (g)" value={num(g.labWeightBeforeG, ' g')} />
                      <DataPair label="Berat total udang (g)" value={num(g.labWeightAfterG, ' g')} />
                    </dl>
                    {/* Butir 2: foto grup tampil di section grupnya. */}
                    {batch.photos.some((p) => p.groupId === g.groupId) && (
                      <div className="mt-2">
                        <p className="text-[11px] font-mono text-white/45">Foto grup</p>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                          {batch.photos
                            .filter((p) => p.groupId === g.groupId)
                            .map((p) => (
                              <figure key={p.url} className="space-y-1">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/${p.url}`}
                                  alt={p.caption || `Foto grup ${g.groupId}`}
                                  className="w-full h-20 object-cover rounded-lg border border-white/10"
                                />
                                <figcaption className="text-[10px] font-mono text-white/50 truncate">
                                  {p.caption}
                                </figcaption>
                              </figure>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="text-sm font-mono font-bold text-white tracking-widest">FOTO DOKUMENTASI ({batch.photos.length})</h3>
        {batch.photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {batch.photos.map((p, i) => (
              <div key={p.url} className="relative space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/${p.url}`} alt={p.caption || `Dokumentasi batch ${i + 1}`} className="w-full h-20 object-cover rounded-lg border border-white/10" />
                {p.groupId ? (
                  <span
                    aria-label={`Foto grup ${p.groupId.slice(-2)}`}
                    className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded-md bg-cyan-500/30 border border-cyan-300/40 text-cyan-100 text-[9px] font-mono font-bold"
                  >
                    {p.groupId.slice(-2)}
                  </span>
                ) : null}
                {isAdmin && !locked ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      maxLength={MAX_PHOTO_CAPTION_LENGTH}
                      autoComplete="off"
                      value={captionEdits[p.url] ?? p.caption}
                      aria-required="true"
                      aria-label={`Caption foto ${i + 1}`}
                      onChange={(e) => setCaptionEdits((prev) => ({ ...prev, [p.url]: e.target.value }))}
                      placeholder="Caption…"
                      className="w-full text-[11px] font-mono px-2 py-1 rounded-lg bg-black/25 border border-white/10 text-white/80 placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    />
                    {captionEdits[p.url] !== undefined && captionEdits[p.url] !== p.caption && (
                      <button
                        type="button"
                        onClick={() => void handleSaveCaption(p.url)}
                        disabled={busy || savingCaption === p.url}
                        className="shrink-0 px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[11px] font-mono font-bold disabled:opacity-50"
                      >
                        {savingCaption === p.url ? '…' : 'OK'}
                      </button>
                    )}
                  </div>
                ) : (
                  p.caption !== '' && (
                    <p className="text-[10px] font-mono text-white/60 leading-tight">{p.caption}</p>
                  )
                )}
                {isAdmin && !locked && (
                  <button
                    onClick={() => setConfirmPhoto({
                      photoUrl: p.url,
                      message: `Hapus foto ${i + 1} dari batch ini? File dihapus permanen.`,
                    })}
                    disabled={busy}
                    aria-label={`Hapus foto ${i + 1}`}
                    title={`Hapus foto ${i + 1}`}
                    className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 hover:bg-rose-500/80 border border-white/20 text-white text-xs font-bold leading-none flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && !locked && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                multiple
                aria-label="Pilih file foto untuk diunggah"
                onChange={(e) => handlePhotoSelect(e.target.files, e.currentTarget)}
                className="text-xs font-mono text-white/60 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:bg-white/10 file:border file:border-white/10 file:text-white/80 file:text-xs file:font-mono"
              />
              <button
                onClick={() => void handleUpload()}
                disabled={busy || files.length === 0}
                className={btnPrimary}
              >
                Upload{files.length > 0 ? ` (${files.length})` : ''}
              </button>
            </div>
            {files.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {filePreviews.map((src, i) => (
                  <div key={src} className="relative space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Pratinjau foto ${i + 1}`} className="w-full h-20 object-cover rounded-lg border border-white/10" />
                    <label className="flex items-center gap-1 text-[11px] font-mono font-semibold text-white/85" htmlFor={`upload-caption-${i}`}>
                      Caption <span aria-hidden="true" className="text-rose-400">*</span>
                    </label>
                    <input
                      id={`upload-caption-${i}`}
                      name={`upload-caption-${i}`}
                      type="text"
                      maxLength={MAX_PHOTO_CAPTION_LENGTH}
                      autoComplete="off"
                      value={fileCaptions[i] ?? ''}
                      aria-required="true"
                      onChange={(e) => setFileCaptions((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
                      placeholder="Di pasar…"
                      className="w-full text-[11px] font-mono px-2 py-1 rounded-lg bg-black/25 border border-white/10 text-white/80 placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Hapus foto ${i + 1} dari pilihan`}
                      className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500/90 text-white text-[12px] font-bold leading-none flex items-center justify-center hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {batch.sampleGroups.map((g) => {
        const seq = g.storageCondition === 'cold' ? SD_TIMEPOINTS : SR_TIMEPOINTS;
        const taken = usedCodes(g);
        const available = seq.filter((t) => !taken.has(t));
        return (
          <div key={g.groupId} className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-mono font-bold text-white tracking-widest">
                {g.groupId} • {g.storageCondition === 'cold' ? 'Dingin (4±1°C)' : 'Ruang (25±2°C)'} • {g.sampleShrimpCount} ekor
              </h3>
              <p className="text-[11px] font-mono text-white/45">
                Jadwal timepoint: {seq.join(' · ')}
              </p>
            </div>
            {g.sessions.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/15">
                <table className="w-full min-w-[620px] text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest font-mono text-white/50 border-b border-white/10">
                      <th scope="col" className="px-3 py-2">Tahap</th>
                      <th scope="col" className="px-3 py-2">Timepoint</th>
                      <th scope="col" className="px-3 py-2">Suhu</th>
                      <th scope="col" className="px-3 py-2">Berat</th>
                      <th scope="col" className="px-3 py-2">Foto</th>
                      <th scope="col" className="px-3 py-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sessions.map((s, idx) => {
                      const tahap = idx + 1;
                      const fotoTahap = batch.photos.filter((p) => p.sessionId === s.sessionId);
                      const runable = isAdmin && !locked && s.status === 'open';
                      const reopnable = isAdmin && !locked && s.status === 'incomplete';
                      const editable = isAdmin && !locked;
                      return (
                        <tr key={s.sessionId} className="border-b border-white/5 last:border-b-0">
                          <td className="px-3 py-2 text-sm font-mono font-bold text-white">{tahap}</td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-mono">
                              <span className="font-bold text-white">{s.timepointCode}</span>
                              <span className="text-white/45"> ({s.elapsedHours} jam)</span>
                            </div>
                            {s.status === 'open' ? (
                              (() => {
                                const startedMs = s.startedAtUtc ? new Date(s.startedAtUtc).getTime() : 0;
                                const targetSec = s.durationSeconds ?? (durationMins[g.groupId] ? durationMins[g.groupId] * 60 : 900);
                                const elapsedSec = startedMs > 0 ? Math.max(0, Math.floor((nowMs - startedMs) / 1000)) : 0;
                                const remSec = Math.max(0, targetSec - elapsedSec);
                                const remM = Math.floor(remSec / 60);
                                const remS = remSec % 60;
                                const timeStr = `${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse font-mono">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                    RECORDING {timeStr}
                                  </span>
                                );
                              })()
                            ) : (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded border uppercase font-mono ${
                                  s.status === 'complete'
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                    : 'bg-white/10 text-white/60 border-white/20'
                                }`}
                                title={s.status === 'incomplete' ? 'Selesai tanpa data tertaut — bisa diulang' : undefined}
                              >
                                {s.status}
                              </span>
                            )}
                            {s.chamberId && (
                              <div className="text-[10px] font-mono text-white/40 mt-0.5">
                                Chamber: {chamberName(s.chamberId)}
                                {deviceLabel(s.deviceId) ? ` — ${deviceLabel(s.deviceId)}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono" data-suhu-tahap={s.timepointCode}>
                            {s.shrimpTempC === null || s.shrimpTempC === undefined ? EM_DASH : `${tabelNumFmt.format(s.shrimpTempC)} °C`}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono" data-berat-tahap={s.timepointCode}>
                            {s.shrimpWeightG === null || s.shrimpWeightG === undefined ? EM_DASH : `${tabelNumFmt.format(s.shrimpWeightG)} g`}
                          </td>
                          <td className="px-3 py-2">
                            {fotoTahap.length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setPhotoViewer({
                                    title: `Foto ${g.groupId} tahap ${tahap} (${s.timepointCode})`,
                                    items: fotoTahap.map((p, i) => ({ url: p.url, caption: p.caption, index: i + 1 })),
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-200 text-[11px] font-mono"
                                aria-label={`Lihat ${fotoTahap.length} foto tahap ${tahap} (${s.timepointCode})`}
                                title="Tampilkan foto dan caption tahap ini"
                              >
                                <CameraIcon className="w-3.5 h-3.5" aria-hidden="true" />
                                {fotoTahap.length} foto
                              </button>
                            ) : (
                              <span className="text-white/30 font-mono text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col items-start gap-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {s.status === 'complete' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setResultModalSessionId(s.sessionId)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-semibold font-mono transition-all"
                                      title="Lihat grafik sensor dan hasil pengujian"
                                    >
                                      <span>📈</span> Hasil
                                    </button>
                                    <a
                                      href={`/api/v1/sessions/${encodeURIComponent(s.sessionId)}/export`}
                                      download
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-semibold font-mono transition-all"
                                      title="Unduh CSV data sensor tahap ini"
                                    >
                                      <span>📥</span> CSV
                                    </a>
                                  </>
                                )}
                                {editable && (
                                  <button
                                    type="button"
                                    onClick={() => openSessionEdit(g, s)}
                                    className={btnAksi}
                                    aria-label={`Edit data tahap ${tahap} (${s.timepointCode})`}
                                    title="Edit suhu, berat, dan foto tahap ini"
                                  >
                                    <PencilIcon className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                {reopnable && (
                                  <button
                                    type="button"
                                    onClick={() => void handleReopen(s)}
                                    className={btnAksi}
                                    aria-label={`Ulangi tahap ${tahap} (${s.timepointCode})`}
                                    title="Buka ulang sesi untuk mengukur ulang timepoint ini"
                                  >
                                    <RepeatIcon className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                {editable && (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteSession({ sessionId: s.sessionId, timepointCode: s.timepointCode, tahap })}
                                    disabled={busy || deletingSession}
                                    className={`${btnAksi} text-rose-300 hover:text-rose-200 hover:bg-rose-500/20 border-rose-500/30 flex items-center justify-center`}
                                    aria-label={`Hapus tahap ${tahap} (${s.timepointCode})`}
                                    title="Hapus tahap pengujian ini"
                                  >
                                    <span className="text-sm leading-none" aria-hidden="true">🗑️</span>
                                  </button>
                                )}
                              </div>
                              {runable && (
                                <label className="flex items-center gap-1.5 text-[10px] font-mono text-white/70 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!cleaning[s.sessionId]}
                                    onChange={(e) => setCleaning({ ...cleaning, [s.sessionId]: e.target.checked })}
                                    className="accent-emerald-500"
                                  />
                                  Cleaning 70%
                                  <button
                                    type="button"
                                    onClick={() => void handleComplete(s)}
                                    disabled={busy || !cleaning[s.sessionId]}
                                    className="px-2 py-1 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-100 text-[10px] font-mono font-bold disabled:opacity-50"
                                    title={!cleaning[s.sessionId] ? 'Centang cleaning 70% dulu' : 'Selesaikan sesi'}
                                  >
                                    Complete
                                  </button>
                                </label>
                              )}
                              {!editable && !runable && !reopnable && s.status !== 'complete' ? (
                                <span className="text-white/30 font-mono text-xs">—</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {g.sessions.length === 0 && (
              <p className="text-xs font-mono text-white/50">Belum ada sesi observasi. Pilih timepoint di bawah lalu mulai sesi pertama.</p>
            )}
            {isAdmin && !locked && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {(() => {
                  const nextSuggested = suggestNext(g);
                  const options = [...available];
                  if (nextSuggested && !options.includes(nextSuggested)) {
                    options.push(nextSuggested);
                  }
                  const currentSel = tpSel[g.groupId] || (options.length > 0 ? options[0] : 'CUSTOM');
                  const isCustom = currentSel === 'CUSTOM';

                  return (
                    <>
                      <select
                        value={currentSel}
                        onChange={(e) => setTpSel({ ...tpSel, [g.groupId]: e.target.value })}
                        aria-label="Timepoint sesi baru"
                        className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 text-xs font-mono text-white"
                      >
                        {options.map((t) => (
                          <option key={t} value={t} className="bg-slate-900">
                            {t}
                          </option>
                        ))}
                        <option value="CUSTOM" className="bg-slate-900 text-cyan-300 font-bold">
                          + Kustom (H... / D...)
                        </option>
                      </select>
                      {isCustom && (
                        <input
                          type="text"
                          value={customTp[g.groupId] || ''}
                          onChange={(e) => setCustomTp({ ...customTp, [g.groupId]: e.target.value.toUpperCase() })}
                          placeholder="Misal H3 / D15"
                          maxLength={8}
                          aria-label="Input kode timepoint kustom"
                          className="w-28 px-3 py-2 rounded-xl bg-black/35 border border-cyan-400/50 text-xs font-mono text-cyan-200 placeholder:text-white/30 uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
                        />
                      )}
                    </>
                  );
                })()}
                {g.coldStorageMode === 'plain_fridge' ? (
                  // Butir 1: grup "langsung di kulkas" tidak memakai chamber,
                  // jadi pemilih chamber disembunyikan.
                  <p className="text-[11px] font-mono text-amber-200/80">
                    Grup ini disimpan langsung di kulkas — tanpa chamber, jadi sensor chamber tidak ditautkan.
                  </p>
                ) : (
                  <>
                    <select
                      value={chSel[g.groupId] || ''}
                      onChange={(e) => setChSel({ ...chSel, [g.groupId]: e.target.value })}
                      aria-label="Chamber sesi (opsional, wajib agar data tertaut)"
                      className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 text-xs font-mono text-white max-w-[180px]"
                    >
                      <option value="" className="bg-slate-900">
                        Chamber: —
                      </option>
                      {chambers.map((c) => (
                        <option key={c.id} value={c.id} className="bg-slate-900">
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {/* Butir 4: device dibaca dari chamber, bukan dipilih user. */}
                    <span className="text-[11px] font-mono text-white/55">
                      {(() => {
                        const device = deviceForChamber(chSel[g.groupId] || null);
                        return device ? `Device: ${device.mqttDeviceId}` : 'Device: otomatis dari chamber';
                      })()}
                    </span>
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`dur-${g.groupId}`} className="text-[11px] font-mono text-white/60">
                    Durasi:
                  </label>
                  <div className="flex items-center">
                    <input
                      id={`dur-${g.groupId}`}
                      type="number"
                      min={1}
                      max={120}
                      value={durationMins[g.groupId] ?? 15}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDurationMins({ ...durationMins, [g.groupId]: val });
                      }}
                      className="w-16 px-2 py-1.5 rounded-l-xl bg-black/25 border border-white/10 text-xs font-mono text-white text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
                    />
                    <span className="px-2 py-1.5 rounded-r-xl bg-white/10 border-y border-r border-white/10 text-[11px] font-mono text-white/60">
                      mnt
                    </span>
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] font-mono text-white/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!warmup[g.groupId]}
                    onChange={(e) => setWarmup({ ...warmup, [g.groupId]: e.target.checked })}
                    className="accent-emerald-500"
                  />
                  Warmup 30 mnt
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleCreateSession(g, 'live')}
                    disabled={busy || !warmup[g.groupId]}
                    className={btnGhost}
                    title={!warmup[g.groupId] ? 'Centang warmup 30 menit dulu untuk rekam langsung' : 'Mulai rekam langsung (live countdown)'}
                  >
                    Start Sesi (Live)
                  </button>
                  <button
                    onClick={() => void handleCreateSession(g, 'time_range')}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 text-xs font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    title="Ambil data telemetri sensor berdasarkan rentang waktu tertentu"
                  >
                    ⏱️ Ambil Data Waktu
                  </button>
                </div>
                <p className="w-full text-[11px] font-mono text-white/45">
                  {g.coldStorageMode === 'plain_fridge'
                    ? 'Tanpa chamber: sesi ini sengaja tidak punya data sensor chamber.'
                    : chSel[g.groupId]
                      ? 'Chamber terisi: sensor chamber otomatis tertaut ke sesi.'
                      : 'Chamber kosong: sesi ini tidak akan punya data sensor.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
      {/* Modal form tahap: data observasi sebelum sesi dibuat, atau koreksi
          data tahap lewat ikon pensil di tabel riwayat. Judul dinamis: nomor
          tahap = posisi timepoint di jadwal grup (H0→Tahap 1, H6 SR→Tahap 2,
          H12 SD→Tahap 2, dst.). */}
      {sessionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setSessionModal(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pre-session-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)' }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 p-5 space-y-4"
          >
            <h3 id="pre-session-title" className="text-base font-mono font-bold text-white">
              {sessionModal.mode === 'edit' ? 'Edit Tahap' : 'Tahap'}{' '}
              {(() => {
                const modalGroup = batch.sampleGroups.find((g) => g.groupId === sessionModal.groupId);
                return modalGroup ? tahapOf(modalGroup, sessionModal.timepointCode) : '';
              })()}
            </h3>
            {sessionModal.mode === 'create' && (
              <div className="flex p-1 rounded-xl bg-black/40 border border-white/10 gap-1">
                <button
                  type="button"
                  onClick={() => setSessionModal((m) => (m ? { ...m, captureMode: 'live', err: null } : null))}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
                    sessionModal.captureMode !== 'time_range'
                      ? 'bg-rose-500/25 text-rose-200 border border-rose-400/40 shadow-sm'
                      : 'text-white/60 hover:text-white/90'
                  }`}
                >
                  🔴 Rekam Langsung (Live)
                </button>
                <button
                  type="button"
                  onClick={() => setSessionModal((m) => (m ? { ...m, captureMode: 'time_range', err: null } : null))}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
                    sessionModal.captureMode === 'time_range'
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 shadow-sm'
                      : 'text-white/60 hover:text-white/90'
                  }`}
                >
                  ⏱️ Rentang Waktu (Jam Tertentu)
                </button>
              </div>
            )}
            {sessionModal.err && (
              <p role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
                {sessionModal.err}
              </p>
            )}
            <div className="space-y-3">
              {sessionModal.mode === 'create' && sessionModal.captureMode === 'time_range' ? (
                <div className="space-y-3 p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/25">
                  <div>
                    <label htmlFor="pre-start-time" className="block text-[12px] font-mono text-cyan-200 font-semibold mb-1">
                      Waktu Mulai Pengujian (WIB)
                    </label>
                    <input
                      id="pre-start-time"
                      type="datetime-local"
                      value={sessionModal.startTimeWib ?? ''}
                      onChange={(e) =>
                        setSessionModal((m) => (m ? { ...m, startTimeWib: e.target.value } : null))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/30 border border-cyan-400/30 text-white text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    />
                    <p className="text-[11px] font-mono text-cyan-200/60 mt-1">
                      Format WIB (UTC+7). Masukkan tanggal dan jam mulai pengambilan data sensor.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="pre-dur-range" className="block text-[12px] font-mono text-cyan-200 font-semibold mb-1">
                      Periode / Durasi Pengujian (menit)
                    </label>
                    <input
                      id="pre-dur-range"
                      type="number"
                      min="1"
                      max="120"
                      value={sessionModal.durationMinutes}
                      onChange={(e) =>
                        setSessionModal((m) =>
                          m ? { ...m, durationMinutes: Math.max(1, Math.min(120, Number(e.target.value) || 15)) } : null
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/30 border border-cyan-400/30 text-white text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    />
                    <p className="text-[11px] font-mono text-cyan-200/60 mt-1">
                      Default 15 menit (1 s/d 120 menit).
                    </p>
                  </div>

                  {/* Pemilihan Chamber di dalam modal */}
                  {(() => {
                    const grp = batch.sampleGroups.find((g) => g.groupId === sessionModal.groupId);
                    if (grp?.coldStorageMode === 'plain_fridge') {
                      return (
                        <p className="text-[11px] font-mono text-amber-200/80 p-2.5 rounded-lg bg-black/40 border border-white/10">
                          Grup ini disimpan langsung di kulkas — tanpa chamber, jadi sensor chamber tidak ditautkan.
                        </p>
                      );
                    }
                    return (
                      <div>
                        <label htmlFor="modal-chamber-select" className="block text-[12px] font-mono text-cyan-200 font-semibold mb-1">
                          Pilih Chamber Pengujian <span className="text-rose-400">*</span>
                        </label>
                        <select
                          id="modal-chamber-select"
                          value={sessionModal.chamberId || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSessionModal((m) => (m ? { ...m, chamberId: val } : null));
                            setChSel((prev) => ({ ...prev, [sessionModal.groupId]: val }));
                          }}
                          className="w-full px-3 py-2 rounded-xl bg-black/30 border border-cyan-400/40 text-white text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                        >
                          <option value="" className="bg-slate-900">
                            -- Pilih Chamber --
                          </option>
                          {chambers.map((c) => (
                            <option key={c.id} value={c.id} className="bg-slate-900">
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] font-mono text-cyan-200/70 mt-1">
                          {(() => {
                            const dev = deviceForChamber(sessionModal.chamberId || null);
                            return dev ? `Device terhubung: ${dev.mqttDeviceId} (${dev.name})` : 'Pilih chamber agar data telemetri sensor dapat ditarik';
                          })()}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Info Box Ringkasan Rentang Waktu */}
                  {(() => {
                    const parsed = parseWibInput(sessionModal.startTimeWib ?? '');
                    if (!parsed.date) return null;
                    const end = new Date(parsed.date.getTime() + sessionModal.durationMinutes * 60_000);
                    const startWibStr = dtFmt.format(parsed.date);
                    const endHourStr = new Intl.DateTimeFormat('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    }).format(end);

                    const grp = batch.sampleGroups.find((g) => g.groupId === sessionModal.groupId);
                    const chamberCode = grp?.coldStorageMode === 'plain_fridge'
                      ? 'Tanpa Chamber (Kulkas)'
                      : (sessionModal.chamberId ? chamberName(sessionModal.chamberId) : '⚠️ Chamber Belum Dipilih');

                    const startUtcIso = parsed.date.toISOString().replace('T', ' ').slice(0, 19);
                    const endUtcIso = end.toISOString().replace('T', ' ').slice(0, 19);

                    const handleCheckData = async () => {
                      if (!sessionModal.chamberId) return;
                      setCheckingData(true);
                      setDataCheckResult(null);
                      try {
                        const fromIso = parsed.date!.toISOString();
                        const toIso = end.toISOString();
                        const res = await apiFetch(
                          `/api/v1/chambers/${encodeURIComponent(sessionModal.chamberId)}/history?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=1`
                        );
                        if (!res.ok) {
                          setDataCheckResult({ ok: false, msg: `Gagal memeriksa database (${res.status}).` });
                          return;
                        }
                        const json = await res.json();
                        if (Array.isArray(json?.data) && json.data.length > 0) {
                          setDataCheckResult({
                            ok: true,
                            msg: '✅ Data sensor ditemukan di database pada rentang waktu ini dan siap ditarik!',
                          });
                        } else {
                          setDataCheckResult({
                            ok: false,
                            msg: '⚠️ Belum ada pembacaan sensor pada rentang waktu ini di chamber tersebut. Periksa apakah jam WIB atau tanggal sudah sesuai dengan waktu pengiriman data ESP32.',
                          });
                        }
                      } catch (checkErr) {
                        setDataCheckResult({
                          ok: false,
                          msg: checkErr instanceof Error ? checkErr.message : 'Gagal menghubungi server.',
                        });
                      } finally {
                        setCheckingData(false);
                      }
                    };

                    return (
                      <div className="p-3 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono space-y-2">
                        <div>
                          <p className="text-white/80">
                            <span className="text-cyan-300 font-semibold">Rentang Waktu:</span> {startWibStr} – {endHourStr} WIB ({sessionModal.durationMinutes} menit)
                          </p>
                          <p className="text-[10px] text-white/40">
                            (Waktu UTC server: {startUtcIso} s/d {endUtcIso} UTC)
                          </p>
                        </div>
                        <p className="text-white/60">
                          <span className="text-white/80 font-semibold">Target Chamber:</span>{' '}
                          <span className={sessionModal.chamberId ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-bold'}>
                            {chamberCode}
                          </span>
                        </p>
                        {sessionModal.chamberId && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => void handleCheckData()}
                              disabled={checkingData}
                              className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-cyan-200 text-[11px] font-mono transition-colors disabled:opacity-50"
                            >
                              {checkingData ? '⏳ Memeriksa ke database…' : '🔍 Periksa Ketersediaan Data di Chamber Ini'}
                            </button>
                            {dataCheckResult && (
                              <p
                                className={`mt-2 p-2 rounded-lg border text-[11px] leading-relaxed ${
                                  dataCheckResult.ok
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                                    : 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                                }`}
                              >
                                {dataCheckResult.msg}
                              </p>
                            )}
                          </div>
                        )}
                        <p className="text-white/40 text-[10px]">
                          Data sensor pada rentang waktu ini akan otomatis diambil dan dikaitkan ke tahap pengujian ini.
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ) : sessionModal.mode === 'create' ? (
                <div>
                  <label htmlFor="pre-dur" className="block text-[12px] font-mono text-white/75 mb-1">
                    Durasi pengujian (menit)
                  </label>
                  <input
                    id="pre-dur"
                    type="number"
                    min="1"
                    max="120"
                    aria-label="Durasi pengujian sensor dalam menit (1 - 120 menit)"
                    value={sessionModal.durationMinutes}
                    onChange={(e) =>
                      setSessionModal((m) =>
                        m ? { ...m, durationMinutes: Math.max(1, Math.min(120, Number(e.target.value) || 15)) } : null
                      )
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-white text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  />
                  <p className="text-[11px] font-mono text-white/45 mt-1">
                    Default 15 menit. Grafik hasil pengujian sensor akan otomatis ditampilkan saat pengujian selesai.
                  </p>
                </div>
              ) : null}
              <div>
                <label htmlFor="pre-temp" className="block text-[12px] font-mono text-white/75 mb-1">
                  Suhu udang (°C)
                </label>
                <input
                  id="pre-temp"
                  type="number"
                  step="0.1"
                  lang="en"
                  aria-label="Suhu udang dalam derajat Celsius, titik desimal pakai titik"
                  value={sessionModal.shrimpTempC}
                  onChange={(e) =>
                    setSessionModal((m) => (m ? { ...m, shrimpTempC: e.target.value } : null))}
                  placeholder="Contoh: 28.5"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-white text-sm font-mono placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                />
                <p className="text-[11px] font-mono text-white/45 mt-1">
                  Angka desimal menggunakan titik, mis. 28.5
                </p>
              </div>
              <div>
                <label htmlFor="pre-weight" className="block text-[12px] font-mono text-white/75 mb-1">
                  Berat total udang (g)
                </label>
                <input
                  id="pre-weight"
                  type="number"
                  step="0.1"
                  aria-label="Berat total udang dalam gram, titik desimal pakai titik"
                  value={sessionModal.shrimpWeightG}
                  onChange={(e) =>
                    setSessionModal((m) => (m ? { ...m, shrimpWeightG: e.target.value } : null))}
                  placeholder="Contoh: 478.5"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-white text-sm font-mono placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                />
                <p className="text-[11px] font-mono text-white/45 mt-1">
                  Angka desimal menggunakan titik, mis. 478.5
                </p>
              </div>
              <div>
                <label htmlFor="pre-photo" className="block text-[12px] font-mono text-white/75 mb-1">
                  Foto dokumentasi
                </label>
                <input
                  id="pre-photo"
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  multiple
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files ?? []);
                    const usable = incoming.filter(
                      (f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0 && f.size <= MAX_PHOTO_BYTES
                    );
                    if (usable.length !== incoming.length) {
                      setSessionModal((m) => (m ? {
                        ...m,
                        err: 'Beberapa file dilewati: wajib jpg/png maks 5MB.',
                      } : null));
                    }
                    setSessionModal((m) => (m ? {
                      ...m,
                      photos: usable,
                      photoPreviews: usable.map((f) => URL.createObjectURL(f)),
                      photoCaptions: usable.map(() => ''),
                      err: null,
                    } : null));
                  }}
                  className="w-full text-xs font-mono text-white/60 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:bg-white/10 file:border file:border-white/10 file:text-white/80 file:text-xs file:font-mono"
                />
                {sessionModal.photoPreviews.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {sessionModal.photoPreviews.map((src, i) => (
                      <div key={src} className="relative space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Pratinjau foto ${i + 1}`}
                          className="w-full h-20 object-cover rounded-lg border border-white/10"
                        />
                        <input
                          type="text"
                          maxLength={MAX_PHOTO_CAPTION_LENGTH}
                          autoComplete="off"
                          aria-label={`Caption foto ${i + 1}`}
                          value={sessionModal.photoCaptions[i] ?? ''}
                          onChange={(e) =>
                            setSessionModal((m) => (m ? {
                              ...m,
                              photoCaptions: m.photoCaptions.map((c, j) => (j === i ? e.target.value : c)),
                            } : null))}
                          placeholder="Caption wajib"
                          className="w-full text-[11px] font-mono px-2 py-1 rounded-lg bg-black/25 border border-white/10 text-white/80 placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setSessionModal((m) => (m ? {
                              ...m,
                              photos: m.photos.filter((_, j) => j !== i),
                              photoPreviews: m.photoPreviews.filter((_, j) => j !== i),
                              photoCaptions: m.photoCaptions.filter((_, j) => j !== i),
                            } : null))}
                          aria-label={`Hapus foto ${i + 1} dari pilihan`}
                          className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500/90 text-white text-[12px] font-bold leading-none flex items-center justify-center hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSessionModal(null)}
                disabled={sessionModal.busy}
                className="flex-1 py-2.5 rounded-xl bg-transparent hover:bg-white/10 border border-white/15 text-white/80 text-sm font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                Batal
              </button>
              <button
                onClick={() => void handleSessionModalSubmit()}
                disabled={sessionModal.busy}
                className={`flex-1 py-2.5 rounded-xl text-sm font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 ${
                  sessionModal.mode === 'edit'
                    ? 'bg-blue-500/25 hover:bg-blue-500/35 border border-blue-400/50 text-blue-100 focus-visible:ring-blue-400/60'
                    : sessionModal.captureMode === 'time_range'
                      ? 'bg-cyan-500/25 hover:bg-cyan-500/35 border border-cyan-400/50 text-cyan-100 focus-visible:ring-cyan-400/60'
                      : 'bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/50 text-emerald-100 focus-visible:ring-emerald-400/60'
                }`}
              >
                {sessionModal.busy
                  ? 'Memproses…'
                  : sessionModal.mode === 'edit'
                    ? 'Simpan Perubahan'
                    : sessionModal.captureMode === 'time_range'
                      ? 'Ambil Data Sesi'
                      : 'Mulai Sesi (Live)'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Penampil foto tahap: gambar + caption per sesi, dari kolom Foto tabel. */}
      {photoViewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setPhotoViewer(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-viewer-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)' }}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="photo-viewer-title" className="text-base font-mono font-bold text-white">
                {photoViewer.title}
              </h3>
              <button
                type="button"
                onClick={() => setPhotoViewer(null)}
                aria-label="Tutup penampil foto"
                className={btnAksi}
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {photoViewer.items.map((item) => (
                <figure key={item.url} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/${item.url}`}
                    alt={item.caption}
                    className="w-full h-48 object-cover rounded-xl border border-white/15"
                  />
                  <figcaption className="text-[11px] font-mono text-white/70">
                    {item.index}. {item.caption}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Hasil Pengujian Sensor (Grafik MQ & DHT-22) */}
      {resultModalSessionId && (
        <SessionResultModal
          key={resultModalSessionId}
          sessionId={resultModalSessionId}
          isOpen={!!resultModalSessionId}
          onClose={() => setResultModalSessionId(null)}
        />
      )}

      {/* Dialog Konfirmasi Hapus Tahap Pengujian */}
      <ConfirmDialog
        open={confirmDeleteSession !== null}
        title={`Hapus Tahap ${confirmDeleteSession?.tahap ?? ''} (${confirmDeleteSession?.timepointCode ?? ''})?`}
        message={`Apakah Anda yakin ingin menghapus data tahap ${confirmDeleteSession?.timepointCode ?? ''}? Seluruh data observasi (suhu, berat), grafik sensor, dan foto pada tahap ini akan dihapus permanen.`}
        confirmLabel={deletingSession ? 'Menghapus…' : 'Ya, hapus tahap'}
        busy={deletingSession}
        onConfirm={() => {
          if (confirmDeleteSession) {
            void handleDeleteSession(confirmDeleteSession.sessionId);
          }
        }}
        onCancel={() => setConfirmDeleteSession(null)}
      />
    </div>
  );
}
