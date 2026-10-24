"use client";

import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts';
import { formatWibTime } from '../../shared/datetime.ts';
import { useAuth } from '../auth/AuthProvider';

interface SessionResultModalProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ReadingPoint {
  id: string;
  measuredAt: string;
  seconds: number;
  isBaseline: boolean;
  mq137: number | null;
  mq136: number | null;
  mq4: number | null;
  temperature: number | null;
  humidity: number | null;
}

interface SessionData {
  session: {
    id: string;
    sessionId: string;
    groupId: string;
    batchId: string;
    timepointCode: string;
    elapsedHours: number;
    startedAtUtc: string;
    endedAtUtc: string | null;
    durationSeconds: number | null;
    sampleWeightG: number | null;
    sampleTempC: number | null;
    status: string;
    chamber: { id: string; code: string; name: string } | null;
    device: { id: string; mqttDeviceId: string; name: string } | null;
    photos: Array<{ id: string; url: string; caption: string }>;
  };
  metrics: {
    totalReadings: number;
    baselineCount: number;
    sampleCount: number;
    baseline: { mq137: number | null; mq136: number | null; mq4: number | null };
    peak: { mq137: number | null; mq136: number | null; mq4: number | null };
    delta: { mq137: number | null; mq136: number | null; mq4: number | null };
    avgTemperature: number | null;
    avgHumidity: number | null;
  };
  readings: ReadingPoint[];
}

export default function SessionResultModal({
  sessionId,
  isOpen,
  onClose,
}: SessionResultModalProps) {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'gas' | 'climate'>('gas');
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);

  const handleDownloadCsv = async () => {
    if (!sessionId) return;
    try {
      setIsDownloadingCsv(true);
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/export`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `Gagal mengunduh CSV (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hasil-${data?.session?.sessionId ?? sessionId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal mengunduh CSV');
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !sessionId) return;

    let isMounted = true;

    const fetchData = async () => {
      try {
        const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/readings`);
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.error?.message || `Gagal memuat hasil pengujian (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (isMounted) {
          setData(json.data);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memuat data');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void fetchData();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      isMounted = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, sessionId, apiFetch, onClose]);

  if (!isOpen) return null;

  const session = data?.session;
  const metrics = data?.metrics;
  const readings = data?.readings ?? [];

  // Hitung durasi aktual dalam menit & detik
  const formatSeconds = (sec: number | null | undefined) => {
    if (sec === null || sec === undefined) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '—';
    return formatWibTime(new Date(isoString));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-result-title"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'linear-gradient(180deg, #1b2f60 0%, #0f1c3d 100%)' }}
        className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/20 p-5 sm:p-6 space-y-5 text-white shadow-2xl"
      >
        {/* Header Modal */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {session?.timepointCode ?? 'Timepoint'}
              </span>
              <span className="text-xs font-mono text-white/50">
                ({session?.elapsedHours ?? 0} jam)
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase font-bold border ${
                  session?.status === 'complete'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                {session?.status ?? 'UNKNOWN'}
              </span>
            </div>
            <h2 id="session-result-title" className="text-lg sm:text-xl font-mono font-bold text-white mt-1">
              Hasil Pengujian Sensor — {session?.groupId}
            </h2>
            <p className="text-xs font-mono text-white/60">
              Chamber: {session?.chamber?.name ?? '—'} • Device: {session?.device?.mqttDeviceId ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadCsv()}
              disabled={isDownloadingCsv || isLoading || !readings.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              title="Unduh seluruh data pembacaan sensor tahap ini sebagai file CSV"
            >
              <span>📥</span> {isDownloadingCsv ? 'Mengunduh…' : 'Unduh CSV'}
            </button>
            <button
              onClick={onClose}
              aria-label="Tutup modal hasil pengujian"
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-cyan-300">
            <div className="w-8 h-8 border-3 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono">Memuat deret data pengujian sensor…</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
            {error}
          </div>
        ) : (
          <>
            {/* Grid Kartu Metrik Parameter Pengujian */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-black/25 border border-white/10 space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">Durasi Pengujian</p>
                <p className="text-base font-mono font-bold text-cyan-300">
                  {formatSeconds(session?.durationSeconds)}
                </p>
                <p className="text-[10px] font-mono text-white/40">
                  {formatTime(session?.startedAtUtc)} – {formatTime(session?.endedAtUtc)}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/25 border border-white/10 space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">Berat Udang</p>
                <p className="text-base font-mono font-bold text-emerald-300">
                  {session?.sampleWeightG !== null && session?.sampleWeightG !== undefined
                    ? `${session.sampleWeightG} g`
                    : '—'}
                </p>
                <p className="text-[10px] font-mono text-white/40">Timbangan timepoint</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/25 border border-white/10 space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">Suhu Udang</p>
                <p className="text-base font-mono font-bold text-amber-300">
                  {session?.sampleTempC !== null && session?.sampleTempC !== undefined
                    ? `${session.sampleTempC} °C`
                    : '—'}
                </p>
                <p className="text-[10px] font-mono text-white/40">Suhu sampel laboratorium</p>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/25 border border-white/10 space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-white/50">Total Pembacaan</p>
                <p className="text-base font-mono font-bold text-purple-300">
                  {metrics?.totalReadings ?? 0} titik
                </p>
                <p className="text-[10px] font-mono text-white/40">
                  {metrics?.baselineCount ?? 0} baseline • {metrics?.sampleCount ?? 0} sampel
                </p>
              </div>
            </div>

            {/* Tab Pilihan Grafik Sensor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('gas')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors ${
                      activeTab === 'gas'
                        ? 'bg-cyan-500/25 border border-cyan-400/40 text-cyan-200'
                        : 'bg-white/5 hover:bg-white/10 text-white/60'
                    }`}
                  >
                    Sensor Gas (MQ-137, MQ-136, MQ-4)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('climate')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-colors ${
                      activeTab === 'climate'
                        ? 'bg-amber-500/25 border border-amber-400/40 text-amber-200'
                        : 'bg-white/5 hover:bg-white/10 text-white/60'
                    }`}
                  >
                    Suhu & Kelembaban (DHT-22)
                  </button>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-white/50">
                  <span className="w-2.5 h-2.5 rounded bg-cyan-500/30 border border-cyan-400/40 inline-block" />
                  <span>Area Arsiran: Fase Baseline (120 dtk awal)</span>
                </div>
              </div>

              {/* Area Grafik Recharts */}
              {readings.length === 0 ? (
                <div className="py-16 text-center rounded-2xl bg-black/20 border border-white/10">
                  <p className="text-xs font-mono text-white/50">
                    Tidak ada pembacaan sensor yang terekam pada rentang waktu sesi ini.
                  </p>
                </div>
              ) : (
                <div className="h-72 w-full p-2 rounded-2xl bg-black/30 border border-white/10">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readings} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis
                        dataKey="seconds"
                        stroke="rgba(255,255,255,0.4)"
                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                        tickFormatter={(val) => `${val}s`}
                      />
                      <YAxis
                        stroke="rgba(255,255,255,0.4)"
                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f1c3d',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          color: '#fff',
                        }}
                        labelFormatter={(sec) => `Detik ke-${sec} (${formatSeconds(Number(sec))})`}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />

                      {/* Area Baseline: 0 s/d 120 detik pertama */}
                      <ReferenceArea
                        x1={0}
                        x2={120}
                        fill="rgba(56, 189, 248, 0.08)"
                        stroke="rgba(56, 189, 248, 0.2)"
                        strokeDasharray="2 2"
                      />

                      {activeTab === 'gas' ? (
                        <>
                          <Line
                            type="monotone"
                            dataKey="mq137"
                            name="MQ-137 (Amonia/Busuk)"
                            stroke="#38bdf8"
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="mq136"
                            name="MQ-136 (H₂S)"
                            stroke="#c084fc"
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="mq4"
                            name="MQ-4 (Metana)"
                            stroke="#34d399"
                            dot={false}
                            strokeWidth={2}
                          />
                        </>
                      ) : (
                        <>
                          <Line
                            type="monotone"
                            dataKey="temperature"
                            name="Suhu DHT-22 (°C)"
                            stroke="#f59e0b"
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="humidity"
                            name="Kelembaban DHT-22 (%)"
                            stroke="#60a5fa"
                            dot={false}
                            strokeWidth={2}
                          />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Analisis Statistik Respon Sensor (Baseline vs Peak vs Delta) */}
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300/80">
                Analisis Respon Gas Sensor
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-black/20 border border-cyan-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-cyan-300">MQ-137 (Amonia)</span>
                    <span className="text-[10px] font-mono text-cyan-400/60">Aroma Busuk</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                    <div>
                      <p className="text-white/40 text-[9px]">Baseline</p>
                      <p className="text-white/80">{metrics?.baseline.mq137 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Puncak</p>
                      <p className="text-white/80">{metrics?.peak.mq137 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Delta (Δ)</p>
                      <p className={`font-bold ${((metrics?.delta.mq137 ?? 0) > 0) ? 'text-cyan-300' : 'text-white/70'}`}>
                        {metrics?.delta.mq137 !== null && metrics?.delta.mq137 !== undefined
                          ? `+${metrics.delta.mq137}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-black/20 border border-purple-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-purple-300">MQ-136 (H₂S)</span>
                    <span className="text-[10px] font-mono text-purple-400/60">Sulfida</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                    <div>
                      <p className="text-white/40 text-[9px]">Baseline</p>
                      <p className="text-white/80">{metrics?.baseline.mq136 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Puncak</p>
                      <p className="text-white/80">{metrics?.peak.mq136 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Delta (Δ)</p>
                      <p className={`font-bold ${((metrics?.delta.mq136 ?? 0) > 0) ? 'text-purple-300' : 'text-white/70'}`}>
                        {metrics?.delta.mq136 !== null && metrics?.delta.mq136 !== undefined
                          ? `+${metrics.delta.mq136}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-black/20 border border-emerald-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-emerald-300">MQ-4 (Metana)</span>
                    <span className="text-[10px] font-mono text-emerald-400/60">Hidrokarbon</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                    <div>
                      <p className="text-white/40 text-[9px]">Baseline</p>
                      <p className="text-white/80">{metrics?.baseline.mq4 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Puncak</p>
                      <p className="text-white/80">{metrics?.peak.mq4 ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[9px]">Delta (Δ)</p>
                      <p className={`font-bold ${((metrics?.delta.mq4 ?? 0) > 0) ? 'text-emerald-300' : 'text-white/70'}`}>
                        {metrics?.delta.mq4 !== null && metrics?.delta.mq4 !== undefined
                          ? `+${metrics.delta.mq4}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Foto Dokumentasi Udang pada Timepoint ini */}
            {session?.photos && session.photos.length > 0 && (
              <div className="space-y-2 border-t border-white/10 pt-3">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-white/70">
                  Dokumentasi Foto Udang ({session.photos.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {session.photos.map((p) => (
                    <div key={p.id} className="relative rounded-xl overflow-hidden border border-white/15 bg-black/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/${p.url}`}
                        alt={p.caption || 'Foto udang'}
                        className="w-full h-24 object-cover"
                      />
                      {p.caption && (
                        <p className="p-1.5 text-[10px] font-mono text-white/80 bg-black/60 truncate">
                          {p.caption}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between pt-3 border-t border-white/10 gap-3">
          <div>
            {readings.length > 0 && (
              <span className="text-[11px] font-mono text-white/50">
                {readings.length} titik pembacaan sensor siap diekspor ke CSV.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadCsv()}
              disabled={isDownloadingCsv || isLoading || !readings.length}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/50 text-emerald-100 font-mono text-xs font-bold transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <span>📥</span> {isDownloadingCsv ? 'Memproses Ekspor CSV…' : `Unduh CSV Hasil (${session?.timepointCode ?? 'Tahap'})`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-mono text-xs font-bold transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
