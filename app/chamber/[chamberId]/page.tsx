"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import MetricCard from '../../../components/ui/MetricCard';
import ChartPanel from '../../../components/charts/ChartPanel';
import ExportPanel from '../../../components/layout/ExportPanel';
import SensorCard from '../../../components/ui/SensorCard';
import { useChamberLatest } from '../../../hooks/useChamberLatest';

const FRESHNESS_THRESHOLD_SECONDS = 15;

export default function Dashboard() {
  const params = useParams();
  const rawChamberId = params?.chamberId as string;

  const {
    data,
    requestState,
    isDegraded,
    resolvedChamberId,
  } = useChamberLatest(rawChamberId);

  // Extract first device status if available
  const deviceStatus = data?.devices?.[0] || null;
  const reading = deviceStatus?.reading || null;
  const connection = deviceStatus?.connection || null;
  const apiFresnhess = deviceStatus?.freshness || null;

  // ── Live freshness ticker ─────────────────────────────────────────────────
  // We recompute freshness locally every second so that the badge continuously
  // ages even when the poller is degraded (cached data).  API freshness is
  // used as fallback only when measuredAt is null (unknown-time readings).
  const [liveAgeSeconds, setLiveAgeSeconds] = useState<number | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const measuredAtRef = useRef<string | null>(null);

  useEffect(() => {
    // Stop any previous ticker
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }

    const measuredAt = reading?.measuredAt ?? null;
    measuredAtRef.current = measuredAt;

    const compute = () => {
      const t = measuredAtRef.current;
      if (!t) {
        setLiveAgeSeconds(null);
        return;
      }
      const age = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 1000));
      setLiveAgeSeconds(age);
    };

    compute(); // immediate call handles both null and non-null measuredAt
    if (measuredAt) {
      tickerRef.current = setInterval(compute, 1000);
    }

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [reading?.measuredAt]);

  // Derived freshness state (client-side, live)
  const liveFreshnessState: 'fresh' | 'stale' | 'unknown' =
    liveAgeSeconds === null
      ? (apiFresnhess?.state === 'fresh' || apiFresnhess?.state === 'stale'
          ? apiFresnhess.state
          : 'unknown')
      : liveAgeSeconds <= FRESHNESS_THRESHOLD_SECONDS
        ? 'fresh'
        : 'stale';

  // Formatting helper for status pills
  const renderConnectionPill = () => {
    if (!connection) {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-white/50 border border-white/10 uppercase">
          Device: Belum Terpasang
        </span>
      );
    }
    const state = connection.state;
    const isOnline = state === 'ONLINE';
    const isOffline = state === 'OFFLINE';

    return (
      <div className="flex items-center gap-1.5" title={`Evidence: ${connection.evidence || 'N/A'}`}>
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1 border ${
            isOnline
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : isOffline
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isOnline ? 'bg-emerald-400 animate-pulse' : isOffline ? 'bg-rose-400' : 'bg-amber-400'
            }`}
          />
          {state}
        </span>
        {connection.lastSeenAt && (
          <span className="text-[9px] font-mono text-white/50 hidden lg:inline">
            Seen: {new Date(connection.lastSeenAt).toLocaleTimeString('id-ID')}
          </span>
        )}
      </div>
    );
  };

  const renderFreshnessPill = () => {
    // Always show something when we have any freshness info (live or API)
    const hasData = reading !== null || apiFresnhess !== null;
    if (!hasData) return null;

    const isFresh = liveFreshnessState === 'fresh';
    const isStale = liveFreshnessState === 'stale';
    const displayAge = liveAgeSeconds ?? apiFresnhess?.ageSeconds ?? null;

    return (
      <span
        title={
          reading?.measuredAt
            ? `Waktu ukur: ${new Date(reading.measuredAt).toLocaleString('id-ID')}`
            : 'Belum ada waktu ukur'
        }
        className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
          isFresh
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
            : isStale
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            : 'bg-white/10 text-white/50 border-white/10'
        }`}
      >
        {isFresh ? 'Fresh' : isStale ? `Stale (${displayAge ?? '?'}s)` : 'Unknown Time'}
      </span>
    );
  };

  const renderRequestStatusPill = () => {
    if (isDegraded) {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-rose-500/25 text-rose-300 border border-rose-500/40 animate-pulse">
          Degraded (Cached)
        </span>
      );
    }
    if (requestState === 'loading' && !data) {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
          Connecting...
        </span>
      );
    }
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        Poller OK
      </span>
    );
  };

  const chamberName = data?.chamber?.name || `Chamber ${resolvedChamberId || rawChamberId}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Status Bar: 4 Independent Dimensions */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-bold text-white tracking-wide">
            {chamberName}
          </span>
          {deviceStatus && (
            <span className="text-xs font-mono text-white/60">
              ({deviceStatus.device.name || deviceStatus.device.mqttDeviceId})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {renderRequestStatusPill()}
          {renderConnectionPill()}
          {renderFreshnessPill()}
        </div>
      </div>

      {/* Main Grid: Metrics, Chart, and Export */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 min-h-[550px]">
        {/* Metric Cards */}
        <div className="flex flex-col gap-6 h-full">
          <MetricCard
            title={<>{chamberName}<br/>Sensor Suhu Lingkungan</>}
            value={reading?.values?.temperatureC?.value ?? null}
            unit="°C"
            quality={reading?.values?.temperatureC?.quality}
            isPrimary={true}
            subtitle={
              reading?.measuredAt
                ? `Ukur: ${new Date(reading.measuredAt).toLocaleTimeString('id-ID')}`
                : undefined
            }
          />
          <MetricCard
            title="Kelembaban Udara"
            value={reading?.values?.humidityPercent?.value ?? null}
            unit="%RH"
            quality={reading?.values?.humidityPercent?.quality}
            subtitle="Relative Humidity"
          />
        </div>

        {/* Time-series Chart */}
        <ChartPanel chamberId={resolvedChamberId || rawChamberId || 'CH-01'} />

        {/* CSV Export & History Panel */}
        <ExportPanel
          chamberId={resolvedChamberId || rawChamberId || 'CH-01'}
          activeDeviceId={deviceStatus?.device?.id || null}
        />
      </div>

      {/* Bottom Sensor Grid: Raw Gas Concentrations */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
        <SensorCard
          imageSrc="/mq137.png"
          name="MQ-137"
          compound="Amonia (NH₃)"
          value={reading?.values?.mq137Raw?.value ?? null}
          unit="raw"
          quality={reading?.values?.mq137Raw?.quality}
          dotColorClass="bg-[#38bdf8]"
          compoundColorClass="text-cyan-300"
        />
        <SensorCard
          imageSrc="/mq136.png"
          name="MQ-136"
          compound="Hidrogen Sulfida (H₂S)"
          value={reading?.values?.mq136Raw?.value ?? null}
          unit="raw"
          quality={reading?.values?.mq136Raw?.quality}
          dotColorClass="bg-[#d8b4fe]"
          compoundColorClass="text-purple-300"
        />
        <SensorCard
          imageSrc="/mq4.png"
          name="MQ-4"
          compound="Metana (CH₄)"
          value={reading?.values?.mq4Raw?.value ?? null}
          unit="raw"
          quality={reading?.values?.mq4Raw?.quality}
          dotColorClass="bg-[#a78bfa]"
          compoundColorClass="text-emerald-300"
        />
        <SensorCard
          imageSrc="/dht22.png"
          name="DHT-22"
          compound={`Suhu: ${reading?.values?.temperatureC?.value !== null && reading?.values?.temperatureC?.value !== undefined ? reading.values.temperatureC.value.toFixed(1) : '--'}°C | Kel: ${reading?.values?.humidityPercent?.value !== null && reading?.values?.humidityPercent?.value !== undefined ? reading.values.humidityPercent.value.toFixed(1) : '--'}%`}
          dotColorClass="bg-white/40"
          compoundColorClass="text-amber-300"
        />
      </div>
    </div>
  );
}