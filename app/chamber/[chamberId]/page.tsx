"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MetricCard from '../../../components/ui/MetricCard';
import ChartPanel from '../../../components/charts/ChartPanel';
import ExportPanel from '../../../components/layout/ExportPanel';
import SensorCard from '../../../components/ui/SensorCard';
import { useChamberLatest } from '../../../hooks/useChamberLatest';
import { useChamberStream } from '../../../hooks/useChamberStream';
import { useAuth } from '../../../components/auth/AuthProvider';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { formatWibDateTime, formatWibTime } from '../../../shared/datetime.ts';

const FRESHNESS_THRESHOLD_SECONDS = 15;

export default function Dashboard() {
  const router = useRouter();
  const params = useParams();
  const rawChamberId = params?.chamberId as string;

  const mappedChamberId =
    rawChamberId === '1' ? 'CH-01' : rawChamberId === '2' ? 'CH-02' : rawChamberId;

  // Dorongan SSE 0,5 dtk (primer): tick yang lebih baru
  // dari hasil polling langsung dipakai kartu + grafik.
  // Polling REST 0,5 dtk saat SSE mati, melambat 5 dtk saat SSE live (status tetap segar).
  const { tick: streamTick, status: streamStatus } = useChamberStream(mappedChamberId || null);
  const {
    data,
    requestState,
    isDegraded,
    resolvedChamberId,
  } = useChamberLatest(rawChamberId, { paused: streamStatus === 'live' });

  // Extract first device status if available
  const deviceStatus = data?.devices?.[0] || null;
  const reading = deviceStatus?.reading || null;
  const connection = deviceStatus?.connection || null;
  const apiFresnhess = deviceStatus?.freshness || null;

  const shown =
    streamTick && (!reading?.measuredAt || streamTick.measuredAt >= reading.measuredAt)
      ? {
          id: reading?.id ?? `stream-${streamTick.historySequence}`,
          measuredAt: streamTick.measuredAt,
          receivedAt: streamTick.receivedAt,
          measurementTimeQuality: streamTick.measurementTimeQuality as
            | 'SYNCED'
            | 'RECONSTRUCTED'
            | 'UNKNOWN',
          values: streamTick.values,
        }
      : reading;

  // ── Live freshness ticker ─────────────────────────────────────────────────
  // We recompute freshness locally every second so that the badge continuously
  // ages even when the poller is degraded (cached data).  API freshness is
  // used as fallback only when measuredAt is null (unknown-time readings).
  const [liveAgeSeconds, setLiveAgeSeconds] = useState<number | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const measuredAtRef = useRef<string | null>(null);

  // Peringatan alat tanpa pasangan chamber (pesannya ditolak worker).
  // Dibaca dari endpoint kesehatan ingest agar tidak diam-diam hilang.
  const [ingestWarn, setIngestWarn] = useState<string | null>(null);
  const { apiFetch, user } = useAuth();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteChamber = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const targetId = resolvedChamberId || mappedChamberId || rawChamberId;
      const res = await apiFetch(`/api/v1/chambers/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `Gagal menghapus chamber (HTTP ${res.status})`);
      }
      setIsDeleteDialogOpen(false);
      router.replace('/');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menghapus chamber';
      setDeleteError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/v1/ingest/health?hours=24')
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = await res.json().catch(() => null);
        const devices = Array.isArray(json?.data?.devices) ? json.data.devices : [];
        const senders = Array.isArray(json?.data?.unknownSenders) ? json.data.unknownSenders : [];
        let dropped = 0;
        for (const d of devices) {
          const n = d?.outcomes?.['rejected:ASSIGNMENT_NOT_FOUND'];
          if (typeof n === 'number') dropped += n;
        }
        for (const s of senders) {
          for (const c of Object.values(s?.outcomes ?? {})) {
            if (typeof c === 'number') dropped += c;
          }
        }
        if (!cancelled && dropped > 0) {
          setIngestWarn(
            `Ada alat mengirim tanpa pasangan chamber (${dropped} pesan ditolak 24 jam terakhir). Minta teknisi memasangkan alat ke chamber.`
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  useEffect(() => {
    // Stop any previous ticker
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }

    const measuredAt = shown?.measuredAt ?? null;
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
  }, [shown?.measuredAt]);

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
            Seen: {formatWibTime(new Date(connection.lastSeenAt))}
          </span>
        )}
      </div>
    );
  };

  const renderFreshnessPill = () => {
    // Always show something when we have any freshness info (live or API)
    const hasData = shown !== null || apiFresnhess !== null;
    if (!hasData) return null;

    const isFresh = liveFreshnessState === 'fresh';
    const isStale = liveFreshnessState === 'stale';
    const displayAge = liveAgeSeconds ?? apiFresnhess?.ageSeconds ?? null;

    return (
      <span
        title={
          shown?.measuredAt
            ? `Waktu ukur: ${formatWibDateTime(new Date(shown.measuredAt), true)}`
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
          {user?.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setIsDeleteDialogOpen(true);
              }}
              title={`Hapus ${chamberName}`}
              className="ml-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-mono font-medium text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 hover:border-rose-500/60 transition-colors focus:outline-none focus:ring-1 focus:ring-rose-400"
            >
              <svg
                className="w-3 h-3 text-rose-300"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
              <span>Hapus Chamber</span>
            </button>
          )}
        </div>
      </div>

      {/* Peringatan ingest: alat tanpa pasangan chamber */}
      {ingestWarn && (
        <div
          role="alert"
          className="px-6 py-3 rounded-2xl bg-rose-500/10 backdrop-blur-md border border-rose-500/30 shadow-sm"
        >
          <p className="text-xs font-mono text-rose-200">{ingestWarn}</p>
        </div>
      )}

      {/* Banner mode riwayat: eksplisit saat data terakhir basi */}
      {liveFreshnessState === 'stale' && shown?.measuredAt && (
        <div
          role="status"
          className="px-6 py-3 rounded-2xl bg-amber-500/10 backdrop-blur-md border border-amber-500/30 shadow-sm"
        >
          <p className="text-xs font-mono text-amber-200">
            Mode riwayat — alat offline sejak {formatWibDateTime(new Date(shown.measuredAt), true)}.
            Menampilkan data terakhir yang tersimpan.
          </p>
        </div>
      )}

      {/* Main Grid: Metrics, Chart, and Export */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 min-h-[550px]">
        {/* Metric Cards */}
        <div className="flex flex-col gap-6 h-full">
          <MetricCard
            title={<>{chamberName}<br/>Sensor Suhu Lingkungan</>}
            value={shown?.values?.temperatureC?.value ?? null}
            unit="°C"
            quality={shown?.values?.temperatureC?.quality}
            isPrimary={true}
            subtitle={
              shown?.measuredAt
                ? `Ukur: ${formatWibTime(new Date(shown.measuredAt))}`
                : undefined
            }
          />
          <MetricCard
            title="Kelembaban Udara"
            value={shown?.values?.humidityPercent?.value ?? null}
            unit="%RH"
            quality={shown?.values?.humidityPercent?.quality}
            subtitle="Relative Humidity"
          />
        </div>

        {/* Time-series Chart */}
        <ChartPanel
          chamberId={resolvedChamberId || rawChamberId || 'CH-01'}
          lastMeasuredAt={shown?.measuredAt ?? null}
          streamTick={streamTick}
        />

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
          value={shown?.values?.mq137Raw?.value ?? null}
          unit="raw"
          quality={shown?.values?.mq137Raw?.quality}
          dotColorClass="bg-[#38bdf8]"
          compoundColorClass="text-cyan-300"
        />
        <SensorCard
          imageSrc="/mq136.png"
          name="MQ-136"
          compound="Hidrogen Sulfida (H₂S)"
          value={shown?.values?.mq136Raw?.value ?? null}
          unit="raw"
          quality={shown?.values?.mq136Raw?.quality}
          dotColorClass="bg-[#d8b4fe]"
          compoundColorClass="text-purple-300"
        />
        <SensorCard
          imageSrc="/mq4.png"
          name="MQ-4"
          compound="Metana (CH₄)"
          value={shown?.values?.mq4Raw?.value ?? null}
          unit="raw"
          quality={shown?.values?.mq4Raw?.quality}
          dotColorClass="bg-[#a78bfa]"
          compoundColorClass="text-emerald-300"
        />
        <SensorCard
          imageSrc="/dht22.png"
          name="DHT-22"
          compound={`Suhu: ${shown?.values?.temperatureC?.value !== null && shown?.values?.temperatureC?.value !== undefined ? shown.values.temperatureC.value.toFixed(1) : '--'}°C | Kel: ${shown?.values?.humidityPercent?.value !== null && shown?.values?.humidityPercent?.value !== undefined ? shown.values.humidityPercent.value.toFixed(1) : '--'}%`}
          dotColorClass="bg-white/40"
          compoundColorClass="text-amber-300"
        />
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Hapus ${chamberName}?`}
        message={`Apakah Anda yakin ingin menghapus ${chamberName}? Jika belum ada data riwayat, chamber akan dihapus secara permanen. Jika sudah ada data sensor atau sesi pengukuran, chamber akan dinonaktifkan (diarsipkan) dengan aman tanpa menghilangkan riwayat.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        tone="danger"
        busy={isDeleting}
        error={deleteError}
        onCancel={() => {
          if (!isDeleting) {
            setIsDeleteDialogOpen(false);
            setDeleteError(null);
          }
        }}
        onConfirm={handleDeleteChamber}
      />
    </div>
  );
}