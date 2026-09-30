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

export type TimeRange = '15m' | '1h' | '6h' | '24h';

interface SensorChartPoint {
  time: string;
  rawTimestamp: string;
  mq137: number | null;
  mq136: number | null;
  mq4: number | null;
}

interface ChartPanelProps {
  chamberId: string;
}

const RANGE_DURATIONS: Record<TimeRange, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export default function ChartPanel({ chamberId }: ChartPanelProps) {
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

  const isMountedRef = useRef(true);

  const handleRangeChange = (newRange: TimeRange) => {
    if (newRange === activeRange) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', newRange);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [retryCount, setRetryCount] = useState(0);

  // Trigger fetch on chamberId or range change
  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;

    const loadSeries = async () => {
      if (!resolvedChamberId) return;

      const durationMs = RANGE_DURATIONS[activeRange];
      const now = new Date();
      const from = new Date(now.getTime() - durationMs);

      try {
        const query = new URLSearchParams({
          from: from.toISOString(),
          to: now.toISOString(),
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
          const timeStr = d.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            ...(activeRange === '15m' ? { second: '2-digit' } : {}),
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

    // Refresh every 10 seconds for live mode without UI flicker
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && !isCancelled) {
        void loadSeries();
      }
    }, 10000);

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [resolvedChamberId, activeRange, apiFetch, retryCount]);

  return (
    <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6">
      {/* Header and Controls */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-white/90 uppercase tracking-wider drop-shadow-md">
            Pergerakan Gas Aktif
          </h2>
          <span className="text-[10px] font-mono text-white/60 tracking-wider">
            Telemetri Konsentrasi ADC (Nilai Gas: Raw ADC)
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Time range buttons */}
          <div className="flex items-center p-1 rounded-xl bg-black/25 border border-white/10 backdrop-blur-md">
            {(['15m', '1h', '6h', '24h'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                  activeRange === r
                    ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 shadow-sm'
                    : 'text-white/50 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Live Indicator */}
          <div className="flex items-center gap-1.5 pl-1">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
            </span>
            <span className="text-[10px] font-mono text-cyan-300 font-bold uppercase tracking-widest">
              Live
            </span>
          </div>
        </div>
      </div>

      {/* Chart Body */}
      <div className="flex-1 w-full min-h-[220px]">
        {isLoading && chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/50 font-mono text-sm">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Memuat data deret waktu...</span>
            </div>
          </div>
        ) : fetchError && chartData.length === 0 ? (
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
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/40 font-mono text-sm">
            Tidak ada data sensor pada rentang {activeRange}.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#ffffff60"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={5}
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
                name="MQ-137 (raw)"
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
                name="MQ-136 (raw)"
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
                name="MQ-4 (raw)"
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}