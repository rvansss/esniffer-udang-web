"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../components/auth/AuthProvider';
import { TIMEPOINT_SEQUENCES } from '../../../shared/dataset.ts';

interface SessionItem {
  sessionId: string;
  timepointCode: string;
  elapsedHours: number;
  status: string;
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
  const [files, setFiles] = useState<FileList | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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

  const suggestNext = (g: GroupItem): string => {
    const seq = g.storageCondition === 'cold' ? SD_TIMEPOINTS : SR_TIMEPOINTS;
    const used = new Set(g.sessions.map((s) => s.timepointCode));
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
      });
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
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal complete sesi');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      setError('Pilih minimal 1 file foto dulu');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) {
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
      setFiles(null);
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
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunci batch');
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

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
          {error}
        </div>
      )}

      <div className={cardCls}>
        <h3 className="text-sm font-mono font-bold text-white tracking-widest">FOTO DOKUMENTASI ({batch.photoUrls.length}/10)</h3>
        {batch.photoUrls.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {batch.photoUrls.map((u) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={u} src={`/${u}`} alt="Dokumentasi batch" className="w-full h-20 object-cover rounded-lg border border-white/10" />
            ))}
          </div>
        )}
        {isAdmin && !locked && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="text-xs font-mono text-white/60 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:bg-white/10 file:border file:border-white/10 file:text-white/80 file:text-xs file:font-mono"
            />
            <button onClick={() => void handleUpload()} disabled={busy} className={btnPrimary}>
              Upload
            </button>
          </div>
        )}
      </div>

      {batch.sampleGroups.map((g) => {
        const seq = g.storageCondition === 'cold' ? SD_TIMEPOINTS : SR_TIMEPOINTS;
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
            {g.sessions.length === 0 ? (
              <p className="text-xs font-mono text-white/50">Belum ada sesi pengukuran.</p>
            ) : (
              <ul className="space-y-2">
                {g.sessions.map((s) => (
                  <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/25 border border-white/10">
                    <div className="text-xs font-mono text-white/80">
                      <span className="font-bold text-white">{s.timepointCode}</span>
                      <span className="text-white/50"> ({s.elapsedHours} jam)</span>{' '}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${
                          s.status === 'COMPLETE'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : s.status === 'OPEN'
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                              : 'bg-white/10 text-white/60 border-white/20'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    {isAdmin && !locked && s.status === 'OPEN' && (
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
            )}
            {isAdmin && !locked && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  value={tpSel[g.groupId] || suggestNext(g)}
                  onChange={(e) => setTpSel({ ...tpSel, [g.groupId]: e.target.value })}
                  className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 text-xs font-mono text-white"
                >
                  {seq.map((t) => (
                    <option key={t} value={t} className="bg-slate-900">
                      {t}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
