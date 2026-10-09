"use client";

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../auth/AuthProvider';
import { toHistoryRows, nextCursorOf, type HistoryRow } from '../../lib/api/history.ts';

interface ExportPanelProps {
  chamberId?: string;
  activeDeviceId?: string | null;
}

export default function ExportPanel({ chamberId = 'CH-01', activeDeviceId }: ExportPanelProps) {
  const searchParams = useSearchParams();
  const { apiFetch } = useAuth();

  // Legacy URL compatibility
  const resolvedChamberId =
    chamberId === '1' ? 'CH-01' : chamberId === '2' ? 'CH-02' : chamberId;

  // Active range from URL
  const rangeParam = searchParams.get('range') || '1h';

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // History modal state
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const getRangeBounds = () => {
    const now = new Date();
    let durationMs = 60 * 60 * 1000; // 1h default
    if (rangeParam === '15m') durationMs = 15 * 60 * 1000;
    else if (rangeParam === '6h') durationMs = 6 * 60 * 60 * 1000;
    else if (rangeParam === '24h') durationMs = 24 * 60 * 60 * 1000;

    const from = new Date(now.getTime() - durationMs);
    return { from: from.toISOString(), to: now.toISOString() };
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportError(null);

    const { from, to } = getRangeBounds();
    const query = new URLSearchParams({ from, to });
    if (activeDeviceId) query.set('deviceId', activeDeviceId);

    try {
      const res = await apiFetch(
        `/api/v1/chambers/${encodeURIComponent(resolvedChamberId)}/export?${query.toString()}`
      );

      if (res.status === 413) {
        setExportError(
          'Rentang waktu menghasilkan lebih dari 50.000 baris (PAYLOAD_TOO_LARGE). Silakan persempit rentang waktu ekspor.'
        );
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson?.error?.message || `Gagal ekspor CSV (HTTP ${res.status})`;
        setExportError(msg);
        return;
      }

      // Download file directly
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `esniffer_${resolvedChamberId}_${rangeParam}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan jaringan saat ekspor CSV';
      setExportError(msg);
    } finally {
      setIsExporting(false);
    }
  };

  const fetchHistoryPage = async (cursorToken?: string | null) => {
    setIsHistoryLoading(true);
    setHistoryError(null);

    const { from, to } = getRangeBounds();
    const query = new URLSearchParams({
      from,
      to,
      limit: '15',
    });
    if (cursorToken) query.set('cursor', cursorToken);
    if (activeDeviceId) query.set('deviceId', activeDeviceId);

    try {
      const res = await apiFetch(
        `/api/v1/chambers/${encodeURIComponent(resolvedChamberId)}/history?${query.toString()}`
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Gagal memuat riwayat (HTTP ${res.status})`);
      }

      const json: unknown = await res.json();
      setHistoryRows(toHistoryRows(json));
      setNextCursor(nextCursorOf(json));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat riwayat data';
      setHistoryError(msg);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleOpenHistory = () => {
    setShowHistory(true);
    fetchHistoryPage(null);
  };

  return (
    <>
      <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-6 flex flex-col justify-between shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-black text-white/90 uppercase tracking-wider drop-shadow-md">
              Data & Ekspor
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold uppercase">
              Rentang: {rangeParam}
            </span>
          </div>
          <p className="text-xs text-white/60 font-mono mb-4 leading-relaxed">
            Unduh telemetri CSV atau buka tabel riwayat tersinkronisasi.
          </p>

          {exportError && (
            <div
              role="alert"
              className="p-3 mb-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-mono backdrop-blur-md"
            >
              <div className="font-bold">Pemberitahuan Ekspor:</div>
              <div>{exportError}</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* CSV Export Button */}
          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500/30 to-teal-600/30 hover:from-emerald-500/40 hover:to-teal-600/40 border border-emerald-400/40 text-emerald-200 font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Menyiapkan CSV...</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Unduh CSV ({rangeParam})</span>
              </>
            )}
          </button>

          {/* View History Table Button */}
          <button
            onClick={handleOpenHistory}
            className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white/90 font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
          >
            <svg className="h-4 w-4 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Tabel Riwayat</span>
          </button>

          {/* Audit Unresolved Readings Link */}
          {activeDeviceId && (
            <a
              href={`/api/v1/devices/${encodeURIComponent(activeDeviceId)}/readings?timeQuality=UNKNOWN`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-[10px] font-mono text-cyan-300/80 hover:text-cyan-200 underline mt-1"
            >
              Audit Pembacaan Belum Terpecahkan (Unknown Time)
            </a>
          )}
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/20 rounded-3xl p-6 max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/10">
              <div>
                <h3 className="text-lg font-bold font-mono text-white">
                  Riwayat Telemetri ({resolvedChamberId})
                </h3>
                <span className="text-xs font-mono text-white/60">
                  Rentang: {rangeParam} | Paginasi Keyset Aman
                </span>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {historyError && (
              <div className="my-3 p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-mono">
                {historyError}
              </div>
            )}

            <div className="flex-1 overflow-auto my-4 rounded-xl border border-white/10 bg-black/20">
              <table className="w-full text-left text-xs font-mono text-white/80">
                <thead className="bg-white/10 text-white uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md">
                  <tr>
                    <th className="p-3">Waktu Ukur</th>
                    <th className="p-3">Temp (°C)</th>
                    <th className="p-3">Kel (%)</th>
                    <th className="p-3">MQ-137 (raw)</th>
                    <th className="p-3">MQ-136 (raw)</th>
                    <th className="p-3">MQ-4 (raw)</th>
                    <th className="p-3">Kualitas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isHistoryLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-white/50">
                        Memuat data riwayat...
                      </td>
                    </tr>
                  ) : historyRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-white/50">
                        Tidak ada riwayat pembacaan dalam rentang ini.
                      </td>
                    </tr>
                  ) : (
                    historyRows.map((r) => (
                      <tr key={r.id} className="hover:bg-white/5">
                        <td className="p-3 whitespace-nowrap">
                          {r.measuredAt ? new Date(r.measuredAt).toLocaleString('id-ID') : '--'}
                        </td>
                        <td className="p-3 font-bold">
                          {r.temperatureC !== null ? `${r.temperatureC.toFixed(1)}` : '--'}
                        </td>
                        <td className="p-3 font-bold">
                          {r.humidityPercent !== null ? `${r.humidityPercent.toFixed(1)}` : '--'}
                        </td>
                        <td className="p-3 font-bold text-cyan-300">
                          {r.mq137Raw !== null ? `${r.mq137Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="p-3 font-bold text-purple-300">
                          {r.mq136Raw !== null ? `${r.mq136Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="p-3 font-bold text-emerald-300">
                          {r.mq4Raw !== null ? `${r.mq4Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[9px] bg-white/10 text-white/70">
                            {r.measurementTimeQuality}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-white/10">
              <span className="text-xs font-mono text-white/50">
                Menampilkan {historyRows.length} baris
              </span>
              <div className="flex gap-2">
                <button
                  disabled={!nextCursor || isHistoryLoading}
                  onClick={() => {
                    fetchHistoryPage(nextCursor);
                  }}
                  className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Halaman Berikutnya &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}