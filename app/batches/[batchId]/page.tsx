"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import SuccessNotice, { useSuccessNotice } from '../../../components/ui/SuccessNotice';
import { TIMEPOINT_SEQUENCES, MAX_BATCH_PHOTOS, MAX_PHOTO_BYTES } from '../../../shared/dataset.ts';
import type { ApiSessionStatus } from '../../../lib/api/dataset.ts';

interface SessionItem {
  sessionId: string;
  timepointCode: string;
  elapsedHours: number;
  status: ApiSessionStatus;
  warmupDone: boolean;
  cleaningDone: boolean;
}

interface GroupItem {
  groupId: string;
  storageCondition: string;
  targetTempC: number | null;
  sampleShrimpCount: number;
  sampleWeightG: number | null;
  sessions: SessionItem[];
}

interface BatchDetail {
  batchId: string;
  marketSource: string;
  shrimpCount: number;
  totalWeightG: number | null;
  photoUrls: string[];
  lockedAt: string | null;
  sampleGroups: GroupItem[];
}

const SR_TIMEPOINTS = TIMEPOINT_SEQUENCES.room_temp;
const SD_TIMEPOINTS = TIMEPOINT_SEQUENCES.cold;

const cardCls = 'p-5 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 space-y-3';
const btnPrimary =
  'px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold tracking-wider transition-all disabled:opacity-50';
const btnGhost =
  'px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs font-mono font-bold transition-all disabled:opacity-50';

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
  const [devSel, setDevSel] = useState<Record<string, string>>({});
  const [chambers, setChambers] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [devices, setDevices] = useState<Array<{ id: string; mqttDeviceId: string; name: string }>>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmPhoto, setConfirmPhoto] = useState<{ message: string; photoUrl: string } | null>(null);
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
    apiFetch('/api/v1/devices?limit=100')
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json.data)) {
          setDevices(json.data.map((d: { id: string; mqttDeviceId?: string; name?: string }) => ({
            id: d.id,
            mqttDeviceId: d.mqttDeviceId || d.id,
            name: d.name || d.mqttDeviceId || d.id,
          })));
        }
      })
      .catch(() => {});
  }, [user, apiFetch]);

  const callJson = async (url: string, payload: unknown) => {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message || `Gagal (${res.status})`);
    }
    return body.data;
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
    return seq.find((t) => !used.has(t)) ?? seq[seq.length - 1];
  };

  const handleCreateSession = async (g: GroupItem) => {
    const timepointCode = tpSel[g.groupId] || suggestNext(g);
    if (!warmup[g.groupId]) {
      setError('Nyalakan sensor 30 menit dulu (centang warmup) sebelum Start sesi');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callJson(`/api/v1/groups/${encodeURIComponent(g.groupId)}/sessions`, {
        timepointCode,
        warmupDone: true,
        chamberId: chSel[g.groupId] || null,
        deviceId: devSel[g.groupId] || null,
      });
      notify(`Sesi ${timepointCode} berhasil dimulai.`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat sesi');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async (s: SessionItem) => {
    if (!cleaning[s.sessionId]) {
      setError('Bersihkan chamber alkohol 70% dulu (centang cleaning) sebelum complete');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callJson(`/api/v1/sessions/${encodeURIComponent(s.sessionId)}/complete`, {
        cleaningDone: true,
      });
      notify(`Sesi ${s.timepointCode} berhasil diselesaikan.`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal complete sesi');
    } finally {
      setBusy(false);
    }
  };

  /** Pilih foto: tambah ke yang sudah ada (bukan mengganti). */
  const handlePhotoSelect = (list: FileList | null, input: HTMLInputElement) => {
    const incoming = Array.from(list ?? []);
    const usable = incoming.filter((f) => /image\/(jpeg|png)/.test(f.type) && f.size > 0);
    const fitting = usable.filter((f) => f.size <= MAX_PHOTO_BYTES);
    const room = Math.max(MAX_BATCH_PHOTOS - (batch?.photoUrls.length ?? 0) - files.length, 0);
    const accepted = fitting.slice(0, room);
    if (accepted.length < incoming.length) {
      setError('Ada file yang dilewati: hanya JPG/PNG, maksimal 5 MB, dan maksimal 10 foto per batch.');
    }
    setFiles((prev) => [...prev, ...accepted]);
    setFilePreviews((prev) => [...prev, ...accepted.map((f) => URL.createObjectURL(f))]);
    input.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(filePreviews[index]);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Pilih minimal 1 file foto dulu');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) {
        form.append('photos', f);
      }
      const res = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/photos`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal (${res.status})`);
      }
      notify(`Berhasil mengunggah ${files.length} foto.`);
      filePreviews.forEach((src) => URL.revokeObjectURL(src));
      setFiles([]);
      setFilePreviews([]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal upload foto');
    } finally {
      setBusy(false);
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
        throw new Error(body.error?.message || `Gagal (${res.status})`);
      }
      notify('Foto berhasil dihapus.');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus foto');
    } finally {
      setBusy(false);
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
            {batch.marketSource} • {batch.shrimpCount} ekor • {batch.totalWeightG ?? '--'} g
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
        <h3 className="text-sm font-mono font-bold text-white tracking-widest">FOTO DOKUMENTASI ({batch.photoUrls.length}/10)</h3>
        {batch.photoUrls.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {batch.photoUrls.map((u, i) => (
              <div key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/${u}`} alt={`Dokumentasi batch ${i + 1}`} className="w-full h-20 object-cover rounded-lg border border-white/10" />
                {isAdmin && !locked && (
                  <button
                    onClick={() => setConfirmPhoto({
                      photoUrl: u,
                      message: `Hapus foto ${i + 1} dari batch ini? File dihapus permanen.`,
                    })}
                    disabled={busy}
                    aria-label={`Hapus foto ${i + 1}`}
                    title={`Hapus foto ${i + 1}`}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-rose-500/80 border border-white/20 text-white text-xs font-bold leading-none transition-colors disabled:opacity-50"
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
                multiple
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
            {files.length === 0 ? (
              <p className="text-[11px] font-mono text-white/50">Belum ada foto dipilih — pratinjau tampil di sini sebelum diunggah.</p>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {filePreviews.map((src, i) => (
                  <div key={src} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Pratinjau foto ${i + 1}`} className="w-full h-20 object-cover rounded-lg border border-white/10" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Hapus foto ${i + 1} dari pilihan`}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500/90 text-white text-[10px] font-bold leading-none hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
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
        const running = g.sessions.filter((s) => s.status === 'open');
        const history = g.sessions.filter((s) => s.status !== 'open');
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
            {running.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-300/80">
                  Sesi berjalan
                </p>
                <ul className="space-y-2">
                  {running.map((s) => (
                    <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/25 border border-cyan-400/20">
                      <div className="text-xs font-mono text-white/80">
                        <span className="font-bold text-white">{s.timepointCode}</span>
                        <span className="text-white/50"> ({s.elapsedHours} jam)</span>{' '}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border uppercase bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                          {s.status}
                        </span>
                      </div>
                      {isAdmin && !locked && (
                        <label className="flex items-center gap-2 text-[11px] font-mono text-white/70 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!cleaning[s.sessionId]}
                            onChange={(e) => setCleaning({ ...cleaning, [s.sessionId]: e.target.checked })}
                            className="accent-emerald-500"
                          />
                          Cleaning 70%
                          <button onClick={() => void handleComplete(s)} disabled={busy || !cleaning[s.sessionId]} className={btnPrimary} title={!cleaning[s.sessionId] ? 'Centang cleaning 70% dulu' : 'Selesaikan sesi'}>
                            Complete
                          </button>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {history.length > 0 && (
              <details className="rounded-xl bg-black/15 border border-white/10 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-mono font-bold tracking-widest uppercase text-white/50 hover:text-white/80">
                  Riwayat ({history.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {history.map((s) => (
                    <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/25 border border-white/10">
                      <div className="text-xs font-mono text-white/80">
                        <span className="font-bold text-white">{s.timepointCode}</span>
                        <span className="text-white/50"> ({s.elapsedHours} jam)</span>{' '}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${
                            s.status === 'complete'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-white/10 text-white/60 border-white/20'
                          }`}
                          title={s.status === 'incomplete' ? 'Selesai tanpa data tertaut — bisa diulang' : undefined}
                        >
                          {s.status}
                        </span>
                      </div>
                      {isAdmin && !locked && s.status === 'incomplete' && (
                        <button onClick={() => void handleReopen(s)} disabled={busy} className={btnGhost} title="Buka ulang sesi untuk mengukur ulang timepoint ini">
                          Ulangi
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {g.sessions.length === 0 && (
              <p className="text-xs font-mono text-white/50">Belum ada sesi pengukuran.</p>
            )}
            {isAdmin && !locked && available.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  value={tpSel[g.groupId] || suggestNext(g)}
                  onChange={(e) => setTpSel({ ...tpSel, [g.groupId]: e.target.value })}
                  aria-label="Timepoint sesi baru"
                  className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 text-xs font-mono text-white"
                >
                  {available.map((t) => (
                    <option key={t} value={t} className="bg-slate-900">
                      {t}
                    </option>
                  ))}
                </select>
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
                <select
                  value={devSel[g.groupId] || ''}
                  onChange={(e) => setDevSel({ ...devSel, [g.groupId]: e.target.value })}
                  aria-label="Device sesi (opsional, wajib agar data tertaut)"
                  className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 text-xs font-mono text-white max-w-[180px]"
                >
                  <option value="" className="bg-slate-900">
                    Device: —
                  </option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id} className="bg-slate-900">
                      {d.mqttDeviceId}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[11px] font-mono text-white/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!warmup[g.groupId]}
                    onChange={(e) => setWarmup({ ...warmup, [g.groupId]: e.target.checked })}
                    className="accent-emerald-500"
                  />
                  Warmup 30 mnt
                </label>
                <button onClick={() => void handleCreateSession(g)} disabled={busy || !warmup[g.groupId]} className={btnGhost} title={!warmup[g.groupId] ? 'Centang warmup 30 menit dulu' : 'Mulai sesi'}>
                  Start Sesi
                </button>
                <p className="w-full text-[11px] font-mono text-white/45">
                  Isi chamber + device agar data sensor otomatis tertaut ke sesi (kosong = sesi tanpa data).
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
