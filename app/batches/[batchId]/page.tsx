"use client";
import BatchQualityPanel from '../../../components/batches/BatchQualityPanel';
import BatchEditForm from '../../../components/batches/BatchEditForm';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WIB_TIME_ZONE, formatWibClockRange, formatWibDateTime } from '../../../shared/datetime.ts';
import { useAuth } from '../../../components/auth/AuthProvider';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import SuccessNotice, { useSuccessNotice } from '../../../components/ui/SuccessNotice';
import SessionResultModal from '../../../components/batches/SessionResultModal';
import ObservationTempFields from '../../../components/batches/ObservationTempFields';
import { PencilIcon, RepeatIcon, CameraIcon } from '../../../components/ui/icons';
import { CAPTION_PLACEHOLDER, CaptionGuide, PhotoSourcePicker } from '../../../components/batches/PhotoUploadControls';
import { TIMEPOINT_SEQUENCES, MAX_PHOTO_BYTES, MAX_PHOTO_CAPTION_LENGTH, wibDateTimeLocal } from '../../../shared/dataset.ts';
import { coolerTempWarning, observationRowCount, observationTempMean, parseWibInput, shrimpCountWarning } from '../../../lib/batch-wizard.ts';
import {
  CALIBRATION_DEFAULT_MINS,
  CALIBRATION_MAX_MINS,
  CALIBRATION_MIN_MINS,
  calibrationDone,
  calibrationRemainingMs,
  calibrationRunKey,
  clearCalibrationRun,
  formatCalibrationCountdown,
  normalizeCalibrationMins,
  readCalibrationHistory,
  readCalibrationRun,
  rememberCalibrationMins,
  writeCalibrationRun,
  type CalibrationRun,
} from '../../../lib/calibration.ts';
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
  endedAtUtc?: string | null;
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
  shrimpType: string | null;
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

/**
 * Durasi bawaan sesi baru. Satu sumber angka: form tahap ke-N yang mengisi
 * `durationMinutes`, sesi baru memakai angka ini sampai operator mengubahnya.
 */
const DEFAULT_DURATION_MINS = 15;
const DEFAULT_DURATION_SECONDS = DEFAULT_DURATION_MINS * 60;

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
  timeZone: WIB_TIME_ZONE,
});
/** Angka id-ID (koma desimal) — dipakai semua nilai numerik di section ini. */
const numFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

const SOURCE_LABEL: Record<string, string> = { market: 'Pasar', supermarket: 'Supermarket', farm: 'Tambak' };
const CONDITION_LABEL: Record<string, string> = { alive: 'Hidup saat dibeli', dead: 'Mati saat dibeli' };

const VISUAL_LABEL: Record<string, string> = {
  normal: 'Normal',
  melanosis: 'Melanosis (bintik hitam)',
  damaged: 'Rusak fisik',
  mixed_species: 'Campur spesies lain',
};

const EM_DASH = '—';

const num = (v: number | null | undefined, unit = '') =>
  v === null || v === undefined ? EM_DASH : `${numFmt.format(v)}${unit}`;

/**
 * Nilai angka dengan penanda amber bila menyimpang dari acuan protokol
 * (suhu cool box 0–4 °C, jumlah udang 1–10 ekor). Data yang tersimpan tidak
 * diubah — penanda ini murni informasi saat membaca/mengoreksi batch.
 */
const numWithWarning = (v: number | null | undefined, warning: string | null, unit = '') => {
  const text = num(v, unit);
  if (!warning) return text;
  return <>{text} <span role="status" className="block text-[11px] font-normal text-amber-200">{warning}</span></>;
};

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
  // Kalibrasi sensor per grup (lib/calibration.ts). Menggantikan checkbox
  // "warmup 30 menit": durasi diisi operator, hitungan mundur mengunci tombol
  // Start Tahap sampai habis. Riwayat durasi dipakai sebagai pilihan cepat.
  const [calibRun, setCalibRun] = useState<Record<string, CalibrationRun | null>>({});
  const [calibMins, setCalibMins] = useState<Record<string, string>>({});
  const [calibHistory, setCalibHistory] = useState<number[]>([]);
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({});
  const [chSel, setChSel] = useState<Record<string, string>>({});
  const [coldChamberDraft, setColdChamberDraft] = useState<Record<string, string>>({});
  const [savingColdChamber, setSavingColdChamber] = useState<string | null>(null);
  const [coldChamberErrors, setColdChamberErrors] = useState<Record<string, string | null>>({});
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
  const [savingEdit, setSavingEdit] = useState(false);
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

  // Riwayat durasi kalibrasi: pilihan cepat agar angka yang sama tidak diketik ulang.
  useEffect(() => {
    setCalibHistory(readCalibrationHistory());
  }, []);

  // Pulihkan kalibrasi yang sedang berjalan setelah muat ulang halaman, supaya
  // hitungan mundur tidak tereset dan operator bisa lanjut memantau.
  useEffect(() => {
    if (!batch) return;
    const restored: Record<string, CalibrationRun | null> = {};
    for (const g of batch.sampleGroups) {
      restored[g.groupId] = readCalibrationRun(calibrationRunKey(batchId, g.groupId));
    }
    setCalibRun(restored);
  }, [batch, batchId]);

  // Modal form pra-sesi: input suhu berat foto sebelum start sesi atau ambil data waktu.
  // Suhu disimpan sebagai baris per ekor (`shrimpTemps`), bukan satu angka:
  // jumlah udang per sesi grup menentukan panjangnya, dan kolom "Suhu udang"
  // yang tersimpan adalah rata-ratanya (lihat observationTempMean).
  const [sessionModal, setSessionModal] = useState<{
    mode: 'create' | 'edit';
    captureMode?: 'live' | 'time_range';
    startTimeWib?: string;
    groupId: string;
    chamberId?: string;
    sessionId?: string;
    timepointCode: string;
    durationMinutes: number;
    shrimpTemps: string[];
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

  const handleSaveColdChamber = async (group: GroupItem) => {
    const chamberId = coldChamberDraft[group.groupId] ?? group.chamberId ?? '';
    if (!chamberId) return;
    setSavingColdChamber(group.groupId);
    setColdChamberErrors((prev) => ({ ...prev, [group.groupId]: null }));
    try {
      const res = await apiFetch(`/api/v1/groups/${encodeURIComponent(group.groupId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chamberId, coldStorageMode: 'chamber' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || `Gagal menyimpan chamber (kode ${res.status}).`);
      setBatch((current) => current ? {
        ...current,
        sampleGroups: current.sampleGroups.map((g) => g.groupId === group.groupId ? { ...g, ...body.data } : g),
      } : current);
      setChSel((prev) => ({ ...prev, [group.groupId]: chamberId }));
      setColdChamberDraft((prev) => {
        const next = { ...prev };
        delete next[group.groupId];
        return next;
      });
      notify('Chamber pengujian berhasil disimpan.');
    } catch (err) {
      setColdChamberErrors((prev) => ({ ...prev, [group.groupId]: err instanceof Error ? err.message : 'Gagal menyimpan chamber.' }));
    } finally {
      setSavingColdChamber(null);
    }
  };

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

  /** Grup milik modal tahap yang sedang terbuka — sumber jumlah udang per sesi. */
  const modalGroupOf = (groupId: string): GroupItem | null =>
    batch?.sampleGroups.find((g) => g.groupId === groupId) ?? null;

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

  /** Durasi kalibrasi yang sedang diisi: isian operator, riwayat terakhir, bawaan. */
  const calibMinsFor = (g: GroupItem): string =>
    calibMins[g.groupId] ?? String(calibHistory[0] ?? CALIBRATION_DEFAULT_MINS);

  /** Tombol Start Tahap terbuka hanya setelah hitungan kalibrasi habis. */
  const isCalibrated = (groupId: string): boolean =>
    calibrationDone(calibRun[groupId] ?? null, nowMs);

  const handleStartCalibration = (g: GroupItem) => {
    const mins = normalizeCalibrationMins(calibMinsFor(g));
    if (mins === null) {
      setError(`Durasi kalibrasi harus bilangan bulat ${CALIBRATION_MIN_MINS}–${CALIBRATION_MAX_MINS} menit.`);
      return;
    }
    const run: CalibrationRun = { mins, startedAtMs: Date.now() };
    writeCalibrationRun(calibrationRunKey(batchId, g.groupId), run);
    setCalibRun((prev) => ({ ...prev, [g.groupId]: run }));
    setCalibHistory(rememberCalibrationMins(mins));
  };

  /** Batalkan / ulangi kalibrasi: hitungan kembali ke nol, Start Tahap terkunci lagi. */
  const resetCalibration = (groupId: string) => {
    clearCalibrationRun(calibrationRunKey(batchId, groupId));
    setCalibRun((prev) => ({ ...prev, [groupId]: null }));
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
    if (captureMode === 'live' && !isCalibrated(g.groupId)) {
      setError('Selesaikan kalibrasi sensor dulu: tunggu hitungan mundur kalibrasi habis sebelum Start Tahap.');
      return;
    }
    const defaultMins = DEFAULT_DURATION_MINS;
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
      shrimpTemps: Array.from({ length: observationRowCount(g.sampleShrimpCount) }, () => ''),
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
    // Mode edit sengaja satu baris: yang tersimpan di sesi hanya satu angka
    // rata-rata, jadi tidak ada pengukuran per ekor yang bisa ditampilkan.
    setSessionModal({
      mode: 'edit',
      groupId: g.groupId,
      sessionId: s.sessionId,
      timepointCode: s.timepointCode,
      durationMinutes: s.durationSeconds ? Math.round(s.durationSeconds / 60) : DEFAULT_DURATION_MINS,
      shrimpTemps: [s.shrimpTempC === null ? '' : String(s.shrimpTempC)],
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
      shrimpTemps,
      shrimpWeightG,
      photos,
      photoCaptions,
    } = sessionModal;
    const fail = (msg: string) =>
      setSessionModal((m) => (m ? { ...m, err: msg, busy: false } : null));
    // Suhu yang disimpan diturunkan dari baris per ekor (mode create) atau dari
    // satu angka tersimpan (mode edit). Di mode edit baris kosong tetap sah:
    // artinya pengguna menghapus nilai lama, jadi hanya isian terisi yang
    // divalidasi. Mode create wajib lengkap karena rata-rata dari data
    // setengah jadi tidak boleh masuk dataset.
    const tempRowCount = mode === 'edit' ? 1 : shrimpTemps.length;
    const measuredTempC = observationTempMean(shrimpTemps, tempRowCount);
    const tempBlank = mode === 'edit' && (shrimpTemps[0] ?? '').trim() === '';
    const tempOk = mode === 'edit' ? tempBlank || measuredTempC !== null : measuredTempC !== null;
    const weightOk = shrimpWeightG.trim() === '' ? mode === 'edit' : Number.isFinite(Number(shrimpWeightG)) && Number(shrimpWeightG) > 0 && Number(shrimpWeightG) <= 2000;
    const durationOk = Number.isFinite(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 120;
    if (!durationOk) {
      fail('Durasi pengujian harus antara 1 sampai 120 menit.');
      return;
    }
    if (!tempOk) {
      if (tempRowCount < 1) {
        fail('Jumlah udang per sesi grup ini belum terbaca atau melebihi 1.000 baris pengukuran. Perbaiki pengelompokan batch sebelum memulai sesi.');
      } else if (mode === 'edit') {
        fail('Suhu udang harus berupa angka (desimal pakai titik).');
      } else {
        fail('Isi suhu tiap udang pada baris per ekor dengan angka.');
      }
      return;
    }
    if (!weightOk) {
      fail('Berat total udang harus lebih dari 0 sampai 2000 g untuk tahap ini.');
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
    } else if (mode === 'create' && captureMode !== 'time_range' && !calibrationDone(calibRun[groupId] ?? null, nowMs)) {
      fail('Selesaikan kalibrasi sensor dulu (tunggu hitungan mundur habis) sebelum mulai rekam langsung.');
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
      // 1. Suhu/berat: yang dikirim adalah nilai turunan (rata-rata baris per
      // ekor) di mode create, atau angka tunggal tersimpan di mode edit.
      const shrimpFields: Record<string, unknown> = {};
      if (measuredTempC !== null) shrimpFields.shrimpTempC = measuredTempC;
      if (shrimpWeightG.trim() !== '') shrimpFields.shrimpWeightG = Number(shrimpWeightG);

      let createdSessionId: string | undefined;
      let linkedCount: number | undefined;

      if (mode === 'edit') {
        const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId ?? '')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shrimpTempC: measuredTempC,
            shrimpWeightG: shrimpWeightG.trim() === '' ? null : Number(shrimpWeightG),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error?.message || `Gagal menyimpan data tahap (kode ${res.status}).`);
      } else {
        const chosenChamberId = sessionModal.chamberId || chSel[groupId] || batch?.sampleGroups.find((g) => g.groupId === groupId)?.chamberId || '';
        if (!chosenChamberId) { fail('Pilih chamber sebelum membuat sesi.'); return; }

        const durationSeconds = durationMinutes * 60;
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

        if (!created?.sessionId) {
          throw new Error('Server belum mengonfirmasi sesi tersimpan. Muat ulang halaman sebelum mencoba lagi.');
        }
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
        // Kalibrasi terpakai: tahap berikutnya wajib kalibrasi ulang, bukan
        // mewarisi hitungan yang sudah selesai dari tahap sebelumnya.
        resetCalibration(groupId);
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
          const targetSeconds = s.durationSeconds ?? DEFAULT_DURATION_SECONDS;
          const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
          if (elapsedSeconds >= targetSeconds) {
            void handleCompleteRef.current(s, true);
          }
        }
      }
    }
  }, [nowMs, batch]);

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

  const startEdit = () => setEditOpen(true);
  const closeEdit = () => setEditOpen(false);
  const saveEdit = async (payload: Record<string, unknown>) => {
    setSavingEdit(true);
    try {
      const response = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Gagal menyimpan perubahan');
      closeEdit(); notify('Data batch berhasil diperbarui.'); refresh();
    } catch (err) { notify(err instanceof Error ? err.message : 'Gagal menyimpan perubahan'); }
    finally { setSavingEdit(false); }
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
  // Peringatan acuan untuk tampilan baca: angka tetap ditampilkan apa adanya,
  // penanda hanya memberi tahu bahwa nilainya menyimpang dari protokol.
  const sampleCountValues = [...new Set(batch.sampleGroups.map((g) => g.sampleShrimpCount))];
  const sampleCountWarning =
    sampleCountValues
      .map((count) => shrimpCountWarning(count))
      .find((message): message is string => Boolean(message)) ?? null;
  // Satu angka bila kedua grup sama, rincian per grup bila berbeda (perilaku lama).
  const sampleCountText = batch.sampleGroups.length === 0
    ? EM_DASH
    : sampleCountValues.length === 1
      ? num(sampleCountValues[0])
      : batch.sampleGroups.map((g) => `${g.storageCondition === 'cold' ? 'SD' : 'SR'}: ${g.sampleShrimpCount}`).join('; ');

  // Modal tahap: jumlah udang per sesi milik grup menentukan panjang baris
  // suhu per ekor. Mode edit tetap satu baris karena sesi hanya menyimpan
  // satu angka rata-rata yang bisa dikoreksi langsung.
  const modalGroup = sessionModal ? modalGroupOf(sessionModal.groupId) : null;
  const modalTempRows = !sessionModal
    ? 0
    : sessionModal.mode === 'edit'
      ? 1
      : observationRowCount(modalGroup?.sampleShrimpCount ?? 0);

  return (
    // `w-full` wajib: `mx-auto` (margin otomatis) mematikan stretch flex, sehingga
    // tanpa lebar pasti kontainer ini mengikuti konten terlebarnya (tabel riwayat
    // sesi min-w-[620px]) dan seluruh halaman melebar melewati viewport ponsel.
    <div className="w-full space-y-6 max-w-4xl mx-auto">
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

        {editOpen && <BatchEditForm batch={batch} saving={savingEdit} onSave={saveEdit} onCancel={closeEdit} />}

        {!editOpen && (
          <>
            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengadaan
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <DataPair
                  label="Tanggal dan jam berangkat (WIB)"
                  value={batch.departedAtUtc ? dtFmt.format(new Date(batch.departedAtUtc)) : '—'}
                />
                <DataPair label="Suhu cool box saat berangkat (°C)" value={numWithWarning(batch.coolerTempDepartureC, coolerTempWarning(batch.coolerTempDepartureC))} />
                <DataPair label="Jenis sumber" value={SOURCE_LABEL[batch.sourceType] ?? batch.sourceType} />
                <DataPair label="Lokasi pembelian" value={batch.marketSource} />
              </dl>
            </div>

            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Kondisi &amp; Dokumentasi
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <DataPair label="Tanggal dan jam beli (WIB)" value={dtFmt.format(new Date(batch.procuredAtUtc))} />
                <DataPair label="Suhu cool box saat di pasar (°C)" value={numWithWarning(batch.coolerTempMarketC, coolerTempWarning(batch.coolerTempMarketC))} />
                <DataPair label="Kondisi awal udang" value={CONDITION_LABEL[batch.initialCondition] ?? batch.initialCondition} />
                <DataPair label="Jenis udang" value={batch.shrimpType ? batch.shrimpType === 'vaname' ? 'Vaname' : 'Windu' : 'Belum tercatat'} />
                <DataPair label="Jumlah udang keseluruhan (ekor)" value={numWithWarning(batch.shrimpCount, shrimpCountWarning(batch.shrimpCount))} />
                <DataPair label="Berat total udang (gram)" value={num(batch.totalWeightG)} />
                <DataPair label="Suhu awal udang (°C)" value={num(batch.initialTempC)} />
                <DataPair label="Panjang udang (cm)" value={num(batch.shrimpLengthCm)} />
              </dl>
              <p className="text-[11px] font-mono text-white/40 mt-1.5">
                Foto kondisi awal tampil di kartu Foto Dokumentasi di bawah.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                Pengelompokan
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <DataPair label="Tanggal dan jam tiba di lab (WIB)" value={dtFmt.format(new Date(batch.arrivedAtUtc))} />
                <DataPair label="Suhu cool box saat di lab (°C)" value={numWithWarning(batch.coolerTempLabC, coolerTempWarning(batch.coolerTempLabC))} />
                <DataPair label="Jumlah udang per sesi (ekor)" value={
                  sampleCountWarning
                    ? <>{sampleCountText} <span role="status" className="block text-[11px] font-normal text-amber-200">{sampleCountWarning}</span></>
                    : sampleCountText
                } />
                <DataPair label="Temuan visual udang" value={new Set(batch.sampleGroups.map((g) => g.visualCheck)).size === 1 ? VISUAL_LABEL[batch.sampleGroups[0]?.visualCheck] : batch.sampleGroups.map((g) => `${g.storageCondition === 'cold' ? 'SD' : 'SR'}: ${VISUAL_LABEL[g.visualCheck]}`).join('; ') || '—'} />
                <DataPair label="Durasi beli ke tiba" value={durationText(batch.procuredAtUtc, batch.arrivedAtUtc)} />
              </dl>
            </div>
          </>
        )}
      </div>

      <BatchQualityPanel key={refreshKey} batchId={batchId} apiFetch={apiFetch} />

      <div className={cardCls}>
        <h3 className="text-sm font-mono font-bold text-white tracking-widest">FOTO DOKUMENTASI ({batch.photos.length})</h3>
        {isAdmin && !locked && <CaptionGuide />}
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
                      placeholder={CAPTION_PLACEHOLDER}
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
              <PhotoSourcePicker id="batch-photo" onFiles={handlePhotoSelect} />
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
                      placeholder={CAPTION_PLACEHOLDER}
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
        // Kalibrasi grup ini: durasi terisi, hitungan berjalan, sudah selesai.
        const calibRunOf = calibRun[g.groupId] ?? null;
        const calibDoneNow = calibrationDone(calibRunOf, nowMs);
        const calibRemaining = calibrationRemainingMs(calibRunOf, nowMs);
        const calibValue = calibMinsFor(g);
        const nextTahapCode =
          tpSel[g.groupId] === 'CUSTOM'
            ? customTp[g.groupId] ?? ''
            : tpSel[g.groupId] || suggestNext(g);
        return (
          <div key={g.groupId} className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-mono font-bold text-white tracking-widest">
                {g.groupId} • {g.storageCondition === 'cold' ? 'Suhu Dingin (4±1°C)' : 'Suhu Ruang (25±2°C)'} • {g.sampleShrimpCount} ekor
              </h3>
              <p className="text-[11px] font-mono text-white/45">
                Jadwal timepoint: {seq.join(' · ')}
              </p>
            </div>
            {(
              <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-400/20 space-y-2">
                <p className="text-[11px] font-mono text-cyan-100">
                  Chamber tersimpan: {g.chamberId ? chamberName(g.chamberId) : 'Belum dipilih'}
                </p>
                {isAdmin && !locked && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-[11px] font-mono text-white/80" htmlFor={`cold-chamber-${g.groupId}`}>
                      Chamber untuk pencatatan dingin
                      <select
                        id={`cold-chamber-${g.groupId}`}
                        value={coldChamberDraft[g.groupId] ?? g.chamberId ?? ''}
                        disabled={savingColdChamber === g.groupId}
                        onChange={(e) => {
                          setColdChamberDraft((prev) => ({ ...prev, [g.groupId]: e.target.value }));
                          setColdChamberErrors((prev) => ({ ...prev, [g.groupId]: null }));
                        }}
                        className="px-3 py-2 rounded-xl bg-black/25 border border-cyan-400/30 text-xs font-mono text-white min-h-[44px]"
                      >
                        <option value="" className="bg-slate-900">Pilih chamber</option>
                        {g.chamberId && !chambers.some((c) => c.id === g.chamberId) && (
                          <option value={g.chamberId} className="bg-slate-900">{chamberName(g.chamberId)} (tersimpan)</option>
                        )}
                        {chambers.map((c) => (
                          <option key={c.id} value={c.id} className="bg-slate-900">{c.name} ({c.code})</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSaveColdChamber(g)}
                      disabled={savingColdChamber !== null || !(coldChamberDraft[g.groupId] ?? g.chamberId) || (
                        (coldChamberDraft[g.groupId] ?? g.chamberId) === g.chamberId && g.coldStorageMode === 'chamber'
                      )}
                      className={btnPrimary}
                    >
                      {savingColdChamber === g.groupId ? 'Menyimpan…' : 'Simpan chamber'}
                    </button>
                  </div>
                )}
                <p className="text-[10px] font-mono text-white/50">
                  {g.coldStorageMode === 'plain_fridge'
                    ? 'Pilih dan simpan chamber untuk pengujian baru.'
                    : 'Chamber tersimpan otomatis menjadi pilihan awal untuk sesi pengujian baru.'}
                </p>
                {coldChamberErrors[g.groupId] && (
                  <p role="alert" className="text-xs font-mono text-rose-300">{coldChamberErrors[g.groupId]}</p>
                )}
              </div>
            )}
            {(g.labTempC !== null || g.labWeightBeforeG !== null || g.labWeightAfterG !== null) && <details className="text-xs text-white/60"><summary className="cursor-pointer min-h-11">Pengukuran awal historis</summary><dl className="grid sm:grid-cols-3 gap-3"><DataPair label="Suhu awal grup (°C)" value={num(g.labTempC)} /><DataPair label="Berat sebelum (g)" value={num(g.labWeightBeforeG)} /><DataPair label="Berat sesudah (g)" value={num(g.labWeightAfterG)} /></dl></details>}
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
                          {/* Nomor tahap + rentang jam WIB. Jam selesai dipakai
                              apa adanya dari DB (endedAtUtc); sesi yang masih
                              open ditandai "berjalan", bukan jam rencana. */}
                          <td className="px-3 py-2">
                            <span className="block text-sm font-mono font-bold text-white whitespace-nowrap">
                              Tahap {tahap}.
                            </span>
                            {s.startedAtUtc && (
                              <span
                                className="block text-[10px] font-mono text-white/55 whitespace-nowrap"
                                title={
                                  s.endedAtUtc
                                    ? `Mulai ${formatWibDateTime(new Date(s.startedAtUtc))}, selesai ${formatWibDateTime(new Date(s.endedAtUtc))}`
                                    : `Mulai ${formatWibDateTime(new Date(s.startedAtUtc))}, belum selesai`
                                }
                              >
                                ({formatWibClockRange(
                                  s.startedAtUtc,
                                  s.endedAtUtc,
                                  s.status === 'open' ? 'berjalan' : '…'
                                )})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-mono">
                              <span className="font-bold text-white">{s.timepointCode}</span>
                              <span className="text-white/45"> ({s.elapsedHours} jam)</span>
                            </div>
                            {s.status === 'open' ? (
                              (() => {
                                const startedMs = s.startedAtUtc ? new Date(s.startedAtUtc).getTime() : 0;
                                const targetSec = s.durationSeconds ?? DEFAULT_DURATION_SECONDS;
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
                {(
                  <>
                    <select
                      value={chSel[g.groupId] ?? g.chamberId ?? ''}
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
                        const device = deviceForChamber(chSel[g.groupId] ?? g.chamberId);
                        return device ? `Device: ${device.mqttDeviceId}` : 'Device: otomatis dari chamber';
                      })()}
                    </span>
                  </>
                )}
                {/* Durasi pengujian hanya diisi di form tahap ke-N (modal),
                    supaya tidak ada dua kolom durasi yang bisa bertentangan. */}
                {/* Kalibrasi sensor: durasi diisi operator. Dulu di sini ada
                    checkbox "warmup 30 menit" — durasinya tetap dan tidak ada
                    bukti waktunya. Chip di bawah = durasi yang pernah dipakai
                    (riwayat), supaya angka yang sama tidak diketik ulang. */}
                <div className="flex w-full flex-wrap items-center gap-2 pt-1">
                  <label htmlFor={`calib-mins-${g.groupId}`} className="text-[11px] font-mono text-white/60">
                    Durasi kalibrasi:
                  </label>
                  <div className="flex items-center">
                    <input
                      id={`calib-mins-${g.groupId}`}
                      type="number"
                      min={CALIBRATION_MIN_MINS}
                      max={CALIBRATION_MAX_MINS}
                      step={1}
                      inputMode="numeric"
                      disabled={calibRunOf !== null}
                      aria-describedby={`calib-hint-${g.groupId}`}
                      value={calibValue}
                      onChange={(e) => setCalibMins({ ...calibMins, [g.groupId]: e.target.value })}
                      // Angka lama langsung terpilih saat fokus: mengetik angka
                      // baru menimpanya, tidak menempel jadi "3015".
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-16 px-2 py-1.5 rounded-l-xl bg-black/25 border border-white/10 text-xs font-mono text-white text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300 disabled:opacity-60"
                    />
                    <span className="px-2 py-1.5 rounded-r-xl bg-white/10 border-y border-r border-white/10 text-[11px] font-mono text-white/60">
                      mnt
                    </span>
                  </div>
                  {calibHistory.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      disabled={calibRunOf !== null}
                      aria-pressed={calibValue === String(mins)}
                      onClick={() => setCalibMins({ ...calibMins, [g.groupId]: String(mins) })}
                      title={`Pakai durasi kalibrasi ${mins} menit (riwayat)`}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                        calibValue === String(mins)
                          ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                          : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {mins} mnt
                    </button>
                  ))}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2">
                  {calibRunOf === null ? (
                    <button
                      type="button"
                      onClick={() => handleStartCalibration(g)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 text-xs font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      title={`Mulai hitungan mundur kalibrasi ${calibValue} menit`}
                    >
                      Mulai Kalibrasi
                    </button>
                  ) : (
                    <>
                      <span
                        role={calibDoneNow ? 'status' : 'timer'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold ${
                          calibDoneNow
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                            : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-1.5 h-1.5 rounded-full ${calibDoneNow ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}
                        />
                        {calibDoneNow
                          ? 'Kalibrasi selesai'
                          : `Kalibrasi ${formatCalibrationCountdown(calibRemaining)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => resetCalibration(g.groupId)}
                        disabled={busy}
                        className="px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white/70 text-[11px] font-mono transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                        title={calibDoneNow ? 'Ulangi kalibrasi dari nol' : 'Batalkan hitungan kalibrasi'}
                      >
                        {calibDoneNow ? 'Ulangi' : 'Batalkan'}
                      </button>
                    </>
                  )}
                  <p id={`calib-hint-${g.groupId}`} className="w-full text-[11px] font-mono text-white/45">
                    {calibDoneNow
                      ? 'Kalibrasi selesai — Start Tahap terbuka. Hitungan diulang untuk tahap berikutnya.'
                      : calibRunOf
                        ? 'Tunggu hitungan mundur habis. Start Tahap terkunci sampai kalibrasi selesai.'
                        : 'Isi durasi kalibrasi lalu mulai. Start Tahap terkunci sampai hitungan mundur habis.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleCreateSession(g, 'live')}
                    disabled={busy || !calibDoneNow}
                    className={btnGhost}
                    title={!calibDoneNow ? 'Selesaikan kalibrasi dulu (tunggu hitungan mundur habis) untuk rekam langsung' : 'Mulai rekam langsung (live countdown)'}
                  >
                    Start Tahap {tahapOf(g, nextTahapCode)}
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
                  {(chSel[g.groupId] ?? g.chamberId) ? 'Sensor chamber ditautkan ke sesi sesuai rentang pengujian.' : 'Pilih chamber sebelum membuat sesi pengujian.'}
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
              {modalGroup ? tahapOf(modalGroup, sessionModal.timepointCode) : ''}
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
                      timeZone: WIB_TIME_ZONE,
                    }).format(end);

                    const chamberCode = (sessionModal.chamberId ? chamberName(sessionModal.chamberId) : '⚠️ Chamber Belum Dipilih');

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
                    Default {DEFAULT_DURATION_MINS} menit (1–120). Angka ini menjadi durasi sesi yang tersimpan dan rentang jam di kolom Tahap. Grafik hasil pengujian sensor akan otomatis ditampilkan saat pengujian selesai.
                  </p>
                </div>
              ) : null}
              {/* Jumlah udang per sesi berasal dari pengelompokan batch (wizard
                  langkah 3). Disabled karena mengubahnya berarti mengubah
                  batch, bukan sesi ini — dan angkanya menentukan panjang baris
                  suhu per ekor di bawah. */}
              <div>
                <label htmlFor="pre-sample-count" className="block text-[12px] font-mono text-white/75 mb-1">
                  Jumlah udang per sesi {modalGroup?.storageCondition === 'cold' ? 'suhu dingin (SD)' : 'suhu ruang (SR)'} (ekor)
                </label>
                <input
                  id="pre-sample-count"
                  type="text"
                  disabled
                  value={modalGroup ? `${modalGroup.sampleShrimpCount} ekor` : EM_DASH}
                  aria-describedby="pre-sample-count-hint"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-white/70 text-sm font-mono cursor-not-allowed opacity-70"
                />
                <p id="pre-sample-count-hint" className="text-[11px] font-mono text-white/45 mt-1">
                  Dari pengelompokan batch. Untuk mengubahnya, koreksi pengelompokan lewat ikon pensil.
                </p>
              </div>
              {sessionModal.mode === 'create' ? (
                <ObservationTempFields
                  count={modalTempRows}
                  values={sessionModal.shrimpTemps}
                  onChangeRow={(index, value) =>
                    setSessionModal((m) =>
                      m ? { ...m, shrimpTemps: m.shrimpTemps.map((t, i) => (i === index ? value : t)) } : null
                    )}
                />
              ) : (
                <div>
                  <label htmlFor="pre-temp" className="block text-[12px] font-mono text-white/75 mb-1">
                    Suhu udang (°C)
                  </label>
                  <input
                    id="pre-temp"
                    type="number"
                    step="any"
                    lang="en"
                    inputMode="decimal"
                    aria-label="Suhu udang dalam derajat Celsius, titik desimal pakai titik"
                    value={sessionModal.shrimpTemps[0] ?? ''}
                    onChange={(e) =>
                      setSessionModal((m) => (m ? { ...m, shrimpTemps: [e.target.value] } : null))}
                    placeholder="Contoh: 28.5"
                    className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-white text-sm font-mono placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  />
                  <p className="text-[11px] font-mono text-white/45 mt-1">
                    Angka desimal menggunakan titik, mis. 28.5 (tanpa batas rentang). Kosongkan untuk menghapus nilai tahap ini.
                  </p>
                </div>
              )}
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
              <div className="space-y-1.5">
                <p className="block text-[12px] font-mono text-white/75">
                  Foto dokumentasi
                </p>
                <CaptionGuide />
                <PhotoSourcePicker
                  id="session-photo"
                  onFiles={(list) => {
                    const incoming = Array.from(list ?? []);
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
                          placeholder={CAPTION_PLACEHOLDER}
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
