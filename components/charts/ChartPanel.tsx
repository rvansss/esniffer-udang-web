"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../auth/AuthProvider';
import { formatWibDateTime, formatWibTime } from '../../shared/datetime.ts';
import type { StreamTick } from '../../hooks/useChamberStream';

export type TimeRange = '30s' | '1m' | '15m' | '1h' | '6h' | '24h';

interface SensorChartPoint {
  time: string;
  rawTimestamp: string;
  mq137: number | null;
  mq136: number | null;
  mq4: number | null;
}

interface ChartPanelProps {
  chamberId: string;
  /** Waktu ukur terakhir (ISO) dari endpoint latest. Null bila belum pernah ada data. */
  lastMeasuredAt?: string | null;
  /**
   * @deprecated Tidak lagi dipakai untuk indikator chart.
   * Indikator Live/Riwayat hanya ditentukan oleh jendela tersemat (pinned),
   * agar status tetap "Live" walau alat offline. Disimpan opsional supaya
   * pemanggil lama tidak rusak.
   */
  isStale?: boolean;
  /** Tick terbaru dari SSE 0,5 dtk. Ditempel sebagai ekor mentah sampai refresh bucket berikutnya. */
  streamTick?: StreamTick | null;
}

const RANGE_DURATIONS: Record<TimeRange, number> = {
  '30s': 30 * 1000,
  '1m': 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export default function ChartPanel({ chamberId, lastMeasuredAt = null, streamTick = null }: ChartPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { apiFetch } = useAuth();

  // Legacy URL compatibility
  const resolvedChamberId =
    chamberId === '1' ? 'CH-01' : chamberId === '2' ? 'CH-02' : chamberId;

  // Sync time range with URL searchParams (?range=1h)
  const rangeParam = (searchParams.get('range') as TimeRange) || '1h';
  const activeRange: TimeRange = RANGE_DURATIONS[rangeParam] ? rangeParam : '1h';

  const [chartData, setChartData] = useState<SensorChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /**
   * Ekor mentah dari SSE: titik tick yang lebih baru dari bucket terakhir.
   * Dikosongkan tiap refresh series (bucket yang benar mengambil alih).
   * Maksimal 120 titik agar DOM SVG tidak membengkak. Pembaruan memakai
   * pola render-phase berpenjaga (sekali per tick baru).
   */
  const [tailState, setTailState] = useState<{ at: string | null; points: SensorChartPoint[] }>({
    at: null,
    points: [],
  });

  /**
   * Jendela data terakhir yang disematkan (mode riwayat): {chamberId, from, to}
   * ISO. Null = jendela live (sekarang minus durasi rentang). Menyimpan
   * chamberId agar sematan chamber lain tak pernah dipakai.
   */
  const [pinned, setPinned] = useState<{ chamberId: string; from: string; to: string } | null>(null);

  const isMountedRef = useRef(true);

  const handleRangeChange = (newRange: TimeRange) => {
    if (newRange === activeRange) return;
    setPinned(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', newRange);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  /** Sematkan jendela yang berakhir di data terakhir (dipakai tombol "data terakhir"). */
  const pinToLastData = () => {
    if (!lastMeasuredAt) return;
    const end = new Date(lastMeasuredAt).getTime();
    const from = new Date(end - RANGE_DURATIONS[activeRange]).toISOString();
    setIsLoading(true);
    setPinned({ chamberId: resolvedChamberId, from, to: lastMeasuredAt });
  };

  const [retryCount, setRetryCount] = useState(0);

  // Trigger fetch on chamberId or range change
  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;

    const loadSeries = async () => {
      if (!resolvedChamberId) return;

      const usePinned = pinned && pinned.chamberId === resolvedChamberId ? pinned : null;
      const durationMs = RANGE_DURATIONS[activeRange];
      const now = new Date();
      const from = new Date(now.getTime() - durationMs);
      const windowFrom = usePinned ? usePinned.from : from.toISOString();
      const windowTo = usePinned ? usePinned.to : now.toISOString();

      try {
        const query = new URLSearchParams({
          from: windowFrom,
          to: windowTo,
          bucket: 'auto',
          metrics: 'mq137Raw,mq136Raw,mq4Raw',
        });

        const res = await apiFetch(
          `/api/v1/chambers/${encodeURIComponent(resolvedChamberId)}/series?${query.toString()}`
        );

        if (!res.ok) {
          throw new Error(`Failed to load series (HTTP ${res.status})`);
        }

        const json = await res.json();
        if (isCancelled || !isMountedRef.current) return;

        interface SeriesBucket {
          bucketStart: string;
          totalCount: number;
          metrics: {
            mq137Raw?: { avg: number | null };
            mq136Raw?: { avg: number | null };
            mq4Raw?: { avg: number | null };
          };
        }

        const buckets: SeriesBucket[] = Array.isArray(json.data) ? json.data : [];

        const points: SensorChartPoint[] = buckets.map((b) => {
          const d = new Date(b.bucketStart);
          const timeStr = formatWibTime(d, {
            seconds: activeRange === '30s' || activeRange === '1m' || activeRange === '15m',
            label: false,
          });

          return {
            time: timeStr,
            rawTimestamp: b.bucketStart,
            mq137: b.metrics?.mq137Raw?.avg ?? null,
            mq136: b.metrics?.mq136Raw?.avg ?? null,
            mq4: b.metrics?.mq4Raw?.avg ?? null,
          };
        });

        setChartData(points);
        setTailState((prev) => ({ at: prev.at, points: [] }));
        setFetchError(null);
      } catch (err: unknown) {
        if (isCancelled || !isMountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Gagal menarik data deret waktu';
        setFetchError(msg);
      } finally {
        if (!isCancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadSeries();

    // Refresh every 10 seconds for live mode without UI flicker.
    // Jendela tersemat (mode riwayat) statis: tidak perlu refresh.
    const intervalId = setInterval(() => {
      if (pinned) return;
      if (typeof document !== 'undefined' && !document.hidden && !isCancelled) {
        void loadSeries();
      }
    }, 10000);

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [resolvedChamberId, activeRange, apiFetch, retryCount, pinned]);

  // Tempel tick SSE sebagai ekor mentah (diabaikan saat jendela tersemat).
  const pinnedWindow = pinned !== null && pinned.chamberId === resolvedChamberId ? pinned : null;
  // Alat kembali online selagi jendela tersemat: tick lebih baru dari
  // jendela berarti data live mengalir lagi, lepas pin agar status
  // kembali Live sendiri tanpa perlu tombol.
  if (pinnedWindow && streamTick && streamTick.measuredAt > pinnedWindow.to) {
    setPinned(null);
  }
  if (streamTick && streamTick.measuredAt !== tailState.at && !pinnedWindow) {
    const tickTime = new Date(streamTick.measuredAt).getTime();
    if (!Number.isNaN(tickTime)) {
      const d = new Date(streamTick.measuredAt);
      const point: SensorChartPoint = {
        time: formatWibTime(d, {
          seconds: activeRange === '30s' || activeRange === '1m' || activeRange === '15m',
          label: false,
        }),
        rawTimestamp: streamTick.measuredAt,
        mq137: streamTick.values.mq137Raw.value,
        mq136: streamTick.values.mq136Raw.value,
        mq4: streamTick.values.mq4Raw.value,
      };
      setTailState((prev) => {
        if (prev.at === streamTick.measuredAt) return prev;
        const next = prev.points.some((p) => p.rawTimestamp === point.rawTimestamp)
          ? prev.points
          : [...prev.points, point];
        const trimmed = next.length > 120 ? next.slice(next.length - 120) : next;
        return { at: streamTick.measuredAt, points: trimmed };
      });
    }
  }

  const mergedData = [...chartData, ...tailState.points.filter((p) => {
    if (chartData.length === 0) return true;
    return p.rawTimestamp > chartData[chartData.length - 1].rawTimestamp;
  })];

  return (
    <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6">
      {/* Header and Controls */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-white/90 uppercase tracking-wider drop-shadow-md">
            Pergerakan Sensor Gas Aktif
          </h2>
          <span className="text-[10px] font-mono text-white/60 tracking-wider">
            Nilai sensor gas mentah (ADC): MQ-137, MQ-136, MQ-4 · Waktu WIB
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Time range buttons */}
          <div className="flex items-center p-1 rounded-xl bg-black/25 border border-white/10 backdrop-blur-md">
            {(['30s', '1m', '15m', '1h', '6h', '24h'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`px-2.5 py-1 min-h-[44px] rounded-lg text-xs font-mono font-bold transition-all ${
                  activeRange === r
                    ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 shadow-sm'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Live / Riwayat Indicator: hanya mode jendela (pinned) yang tampil Riwayat.
              Status Live (cyan, berdenyut) tetap tampil walau alat offline. */}
          {pinnedWindow ? (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
              </span>
              <span className="text-[10px] font-mono text-amber-300 font-bold uppercase tracking-widest">
                Riwayat
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
              <span className="text-[10px] font-mono text-cyan-300 font-bold uppercase tracking-widest">
                Live
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Chart Body — layar sempit dapat sedikit tinggi ekstra agar tetap terbaca */}
      <div className="flex-1 w-full min-h-[320px] sm:min-h-[220px]">
        {isLoading && mergedData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/50 font-mono text-sm">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Memuat data deret waktu...</span>
            </div>
          </div>
        ) : fetchError && mergedData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-rose-300/80 font-mono text-xs gap-2 p-4 text-center">
            <svg className="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{fetchError}</span>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-white font-mono text-xs"
            >
              Coba Lagi
            </button>
          </div>
        ) : mergedData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40 font-mono text-sm gap-3 p-4 text-center">
            {pinned && pinned.chamberId === resolvedChamberId ? (
              <>
                <span>Tidak ada data sensor di jendela data terakhir ini.</span>
                <button
                  onClick={() => setPinned(null)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-white font-mono text-xs"
                >
                  Kembali live
                </button>
              </>
            ) : lastMeasuredAt ? (
              <>
                <span>
                  Tidak ada data sensor pada rentang {activeRange}. Data terakhir tercatat{' '}
                  {formatWibDateTime(new Date(lastMeasuredAt), true)}.
                </span>
                <button
                  onClick={pinToLastData}
                  className="px-3 py-1 min-h-[44px] bg-white/10 hover:bg-white/20 rounded-lg text-white font-mono text-xs"
                >
                  Tampilkan data terakhir
                </button>
              </>
            ) : (
              <span>Tidak ada data sensor pada rentang {activeRange}.</span>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#ffffff60"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={5}
                interval="preserveStartEnd"
                minTickGap={activeRange === '30s' || activeRange === '1m' ? 30 : 5}
              />
              <YAxis
                stroke="#ffffff60"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '12px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
                itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                formatter={(val: unknown, name: unknown) => [
                  val !== null && val !== undefined && typeof val === 'number'
                    ? `${val.toFixed(2)} raw`
                    : '-- (null)',
                  String(name ?? ''),
                ]}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  paddingBottom: '8px',
                }}
              />
              {/* CRITICAL: connectNulls={false} ensures null values create disconnected gaps */}
              <Line
                type="monotone"
                dataKey="mq137"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
                name="MQ-137 (mentah)"
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="mq136"
                stroke="#d8b4fe"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
                name="MQ-136 (mentah)"
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="mq4"
                stroke="#a78bfa"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
                name="MQ-4 (mentah)"
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer: legenda baca + bar mode riwayat */}
      {pinned && pinned.chamberId === resolvedChamberId ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <span className="text-[11px] font-mono text-amber-200">
            Jendela data terakhir (bukan live).
          </span>
          <button
            onClick={() => setPinned(null)}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-white font-mono text-xs"
          >
            Kembali live
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[10px] font-mono text-white/40">
          -- berarti tidak ada data. Garis terputus berarti tidak ada kiriman alat.
        </p>
      )}
    </div>
  );
}