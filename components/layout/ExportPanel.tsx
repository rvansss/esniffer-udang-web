"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatWibDateTime, wibDateTimeLocal } from '../../shared/datetime.ts';
import { parseWibInput } from '../../lib/batch-wizard.ts';
import { useAuth } from '../auth/AuthProvider';
import { toHistoryRows, nextCursorOf, historyMetaOf, type HistoryRow } from '../../lib/api/history.ts';

interface ExportPanelProps {
  chamberId?: string;
  activeDeviceId?: string | null;
}

/** Jeda sebelum rentang kustom dipakai ulang (ms) — satu request, bukan per ketikan. */
const HISTORY_APPLY_DEBOUNCE_MS = 400;

export default function ExportPanel({ chamberId = 'CH-01', activeDeviceId }: ExportPanelProps) {
  const searchParams = useSearchParams();
  const { apiFetch } = useAuth();

  // Legacy URL compatibility
  const resolvedChamberId =
    chamberId === '1' ? 'CH-01' : chamberId === '2' ? 'CH-02' : chamberId;

  // Active range from URL
  const rangeParam = searchParams.get('range') || '1h';

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ bytes: number; totalRows: number | null } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // History modal state
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [, setWatermark] = useState<string | null>(null);
  const [aboveCount, setAboveCount] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  // Halaman keyset saat ini (ref: hanya penjaga refresh, tak dirender).
  const historyPageRef = useRef(1);
  // Tumpukan kursor per halaman: [null, cursorHal2, ...]. Kursor ditandatangani
  // server dan terikat pada jendela from/to, jadi halaman sebelumnya
  // dikunjungi ulang lewat kursor simpanan, bukan fetch ulang halaman 1.
  const cursorStackRef = useRef<(string | null)[]>([null]);
  // Jendela waktu dibekukan saat modal dibuka; halaman lanjutan wajib memakai
  // from/to yang identik atau kursor ditolak server (filter hash mismatch).
  const windowRef = useRef<{ from: string; to: string } | null>(null);
  const [activeWindow, setActiveWindow] = useState<{ from: string; to: string } | null>(null);

  // Filter jarak waktu tabel riwayat & ekspor
  // (1h, 6h, 12h, 24h, 7d, 30d, 1y, kustom)
  type HistoryRangeMode = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '1y' | 'custom';
  const [historyMode, setHistoryMode] = useState<HistoryRangeMode>('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Nilai input terkini (ref) agar apply ber-debounce memakai nilai terbaru.
  const customFromRef = useRef('');
  const customToRef = useRef('');
  // Timer apply rentang kustom (debounce: bukan satu request per ketikan).
  const applyRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Batas rentang preset. "1 Tahun" memakai aritmetika kalender (tahun kalender
   * lalu), bukan 365 hari, agar identik dengan batas API satu tahun kalender.
   */
  const presetBounds = (
    mode: Exclude<HistoryRangeMode, 'custom'>
  ): { from: Date; to: Date } => {
    const to = new Date();
    const from = new Date(to.getTime());
    if (mode === '1h') from.setTime(to.getTime() - 3_600_000);
    else if (mode === '6h') from.setTime(to.getTime() - 6 * 3_600_000);
    else if (mode === '12h') from.setTime(to.getTime() - 12 * 3_600_000);
    else if (mode === '24h') from.setTime(to.getTime() - 24 * 3_600_000);
    else if (mode === '7d') from.setTime(to.getTime() - 7 * 24 * 3_600_000);
    else if (mode === '30d') from.setTime(to.getTime() - 30 * 24 * 3_600_000);
    else if (mode === '1y') from.setUTCFullYear(from.getUTCFullYear() - 1);
    return { from, to };
  };

  const getHistoryBounds = (
    mode: HistoryRangeMode = historyMode,
    fromRaw = customFrom,
    toRaw = customTo
  ): { from: string; to: string } | null => {
    if (mode !== 'custom') {
      const { from, to } = presetBounds(mode);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (!fromRaw || !toRaw) return null;
    const from = parseWibInput(fromRaw).date;
    const to = parseWibInput(toRaw).date;
    if (!from || !to || from >= to) return null;
    return { from: from.toISOString(), to: to.toISOString() };
  };

  const formatRangeLabel = (
    mode: HistoryRangeMode,
    bounds?: { from: string; to: string } | null
  ): string => {
    if (mode === '1h') return '1 jam terakhir';
    if (mode === '6h') return '6 jam terakhir';
    if (mode === '12h') return '12 jam terakhir';
    if (mode === '24h') return '24 jam terakhir';
    if (mode === '7d') return '7 hari terakhir';
    if (mode === '30d') return '30 hari terakhir';
    if (mode === '1y') return '1 tahun terakhir';
    if (bounds?.from && bounds?.to) {
      const f = new Date(bounds.from);
      const t = new Date(bounds.to);
      return `${formatWibDateTime(f)} → ${formatWibDateTime(t)}`;
    }
    return 'kustom';
  };

  /** Ganti rentang tabel riwayat dan muat ulang halaman 1. */
  const applyHistoryRange = (mode: HistoryRangeMode, from = '', to = '') => {
    // Batalkan apply tertunda (mis. dari ketikan input) — rentang ini yang berlaku.
    if (applyRangeTimerRef.current) {
      clearTimeout(applyRangeTimerRef.current);
      applyRangeTimerRef.current = null;
    }
    let f = from;
    let t = to;
    if (mode === 'custom') {
      f = from || customFromRef.current;
      t = to || customToRef.current;
      if (!f || !t) {
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 3_600_000);
        f = wibDateTimeLocal(sixHoursAgo);
        t = wibDateTimeLocal(now);
      }
    } else {
      // Preset mengisi kedua input (butir 10) — rentang efektif selalu terlihat.
      const preset = presetBounds(mode);
      f = wibDateTimeLocal(preset.from);
      t = wibDateTimeLocal(preset.to);
    }
    customFromRef.current = f;
    customToRef.current = t;
    setCustomFrom(f);
    setCustomTo(t);
    const bounds = getHistoryBounds(mode, f, t);
    if (!bounds) {
      setHistoryError('Isi kedua tanggal dan jam kustom; "dari" harus sebelum "tujuan".');
      return;
    }
    setHistoryMode(mode);
    setHistoryError(null);
    cursorStackRef.current = [null];
    windowRef.current = bounds;
    setActiveWindow(bounds);
    void fetchHistoryPage(null, 1, true, bounds);
  };

  /**
   * Input rentang kustom: diterapkan otomatis setelah jeda (debounce) supaya
   * tidak ada satu request per ketikan.
   */
  const onCustomInputChange = (which: 'from' | 'to', value: string) => {
    if (which === 'from') {
      customFromRef.current = value;
      setCustomFrom(value);
    } else {
      customToRef.current = value;
      setCustomTo(value);
    }
    if (applyRangeTimerRef.current) {
      clearTimeout(applyRangeTimerRef.current);
    }
    applyRangeTimerRef.current = setTimeout(() => {
      applyRangeTimerRef.current = null;
      // Field kosong = belum valid; tunggu pengguna mengisi lagi.
      if (!customFromRef.current || !customToRef.current) return;
      applyHistoryRange('custom', customFromRef.current, customToRef.current);
    }, HISTORY_APPLY_DEBOUNCE_MS);
  };

  const getRangeBounds = () => {
    const now = new Date();
    let durationMs = 60 * 60 * 1000; // 1h default
    if (rangeParam === '30s') durationMs = 30 * 1000;
    else if (rangeParam === '1m') durationMs = 60 * 1000;
    else if (rangeParam === '15m') durationMs = 15 * 60 * 1000;
    else if (rangeParam === '6h') durationMs = 6 * 60 * 60 * 1000;
    else if (rangeParam === '24h') durationMs = 24 * 60 * 60 * 1000;

    const from = new Date(now.getTime() - durationMs);
    return { from: from.toISOString(), to: now.toISOString() };
  };

  const handleExportCsv = async (customBounds?: { from: string; to: string } | null, label?: string) => {
    setIsExporting(true);
    setExportError(null);
    setExportProgress(null);

    const bounds = customBounds || getRangeBounds();
    if (!bounds) {
      setExportError('Rentang waktu belum valid untuk ekspor.');
      setIsExporting(false);
      return;
    }
    const { from, to } = bounds;
    const query = new URLSearchParams({ from, to });
    if (activeDeviceId) query.set('deviceId', activeDeviceId);

    try {
      const res = await apiFetch(
        `/api/v1/chambers/${encodeURIComponent(resolvedChamberId)}/export?${query.toString()}`
      );

      if (res.status === 413) {
        const errJson = await res.json().catch(() => ({}));
        const msg =
          errJson?.error?.message ||
          'Rentang waktu menghasilkan data melebihi batas maksimum 200.000 baris (PAYLOAD_TOO_LARGE). Silakan persempit rentang waktu ekspor (misal: 1 jam, 6 jam, atau 12 jam).';
        setExportError(msg);
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson?.error?.message || `Gagal ekspor CSV (HTTP ${res.status})`;
        setExportError(msg);
        return;
      }

      const totalHeader = res.headers.get('x-total-count');
      const totalRows = totalHeader ? parseInt(totalHeader, 10) : null;

      let blob: Blob;
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: BlobPart[] = [];
        let receivedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
            setExportProgress({
              bytes: receivedBytes,
              totalRows,
            });
          }
        }
        blob = new Blob(chunks, { type: 'text/csv; charset=utf-8' });
      } else {
        blob = await res.blob();
      }

      // Download file directly
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileLabel = label || rangeParam;
      a.download = `esniffer_${resolvedChamberId}_${fileLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan jaringan saat ekspor CSV';
      setExportError(msg);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const fetchHistoryPage = async (
    cursorToken?: string | null,
    page = 1,
    resetWindow = false,
    boundsOverride?: { from: string; to: string } | null
  ) => {
    setIsHistoryLoading(true);
    setHistoryError(null);

    if (resetWindow || !windowRef.current) {
      const bounds = boundsOverride || getHistoryBounds();
      if (!bounds) {
        setHistoryError('Rentang kustom belum lengkap atau urutannya salah.');
        setIsHistoryLoading(false);
        return;
      }
      windowRef.current = bounds;
      setActiveWindow(bounds);
    }
    const { from, to } = windowRef.current;
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
      const meta = historyMetaOf(json);
      setWatermark(meta.snapshotWatermark);
      setAboveCount(meta.aboveWatermarkCount);
      setHistoryPage(page);
      historyPageRef.current = page;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat riwayat data';
      setHistoryError(msg);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  // Bersihkan timer apply tertunda saat komponen dilepas.
  useEffect(
    () => () => {
      if (applyRangeTimerRef.current) {
        clearTimeout(applyRangeTimerRef.current);
      }
    },
    []
  );

  const handleOpenHistory = () => {
    setShowHistory(true);
    setHistoryRows([]);
    setNextCursor(null);
    setWatermark(null);
    setAboveCount(0);
    setHistoryPage(1);
    historyPageRef.current = 1;
    cursorStackRef.current = [null];
    windowRef.current = null;
    setActiveWindow(null);
    fetchHistoryPage(null, 1, true);
  };

  const handleHistoryNext = () => {
    if (!nextCursor || isHistoryLoading) return;
    cursorStackRef.current = [...cursorStackRef.current, nextCursor];
    fetchHistoryPage(nextCursor, historyPage + 1);
  };

  const handleHistoryPrev = () => {
    if (historyPage <= 1 || isHistoryLoading) return;
    const stack = cursorStackRef.current.slice(0, -1);
    cursorStackRef.current = stack;
    fetchHistoryPage(stack[stack.length - 1] ?? null, historyPage - 1);
  };

  const handleHistoryReload = () => {
    const stack = cursorStackRef.current;
    // Halaman 1 selalu memakai jendela terbaru; halaman >1 memakai jendela beku.
    if (historyPage === 1) {
      cursorStackRef.current = [null];
      fetchHistoryPage(null, 1, true);
    } else {
      fetchHistoryPage(stack[stack.length - 1] ?? null, historyPage);
    }
  };

  // Refresh otomatis tiap 10 dtk selagi modal terbuka di halaman pertama.
  // Halaman lanjut tidak disentuh agar posisi baca tak melompat.
  useEffect(() => {
    if (!showHistory) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (historyPageRef.current !== 1) return;
      cursorStackRef.current = [null];
      void fetchHistoryPage(null, 1, true);
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, resolvedChamberId, rangeParam, activeDeviceId]);

  // Standar modal: Esc menutup, klik backdrop menutup.
  useEffect(() => {
    if (!showHistory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHistory(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showHistory]);

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
            CSV dan riwayat diambil dari database. Tetap bisa diunduh saat alat mati.
            Data yang baru masuk detik ini ikut unduhan berikutnya.
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
            onClick={() => void handleExportCsv()}
            disabled={isExporting}
            className="w-full py-3 px-4 min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-500/30 to-teal-600/30 hover:from-emerald-500/40 hover:to-teal-600/40 border border-emerald-400/40 text-emerald-200 font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 transition-all disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>
                  {exportProgress
                    ? `Mengunduh... (${(exportProgress.bytes / 1024).toFixed(0)} KB)`
                    : 'Menyiapkan CSV...'}
                </span>
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
            className="w-full py-2.5 px-4 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white/90 font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowHistory(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Riwayat telemetri ${resolvedChamberId}`}
            className="bg-slate-900 border border-white/15 rounded-3xl max-w-5xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
          >
            <div className="flex justify-between items-start gap-3 px-6 pt-5 pb-4 border-b border-white/10">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                  </span>
                  <h3 className="text-base font-bold text-white truncate">
                    Riwayat Telemetri
                    <span className="ml-2 text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {resolvedChamberId}
                    </span>
                  </h3>
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-white/50">
                  Rentang {formatRangeLabel(historyMode, activeWindow)} · 15 baris/halaman · Halaman {historyPage}
                </p>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                aria-label="Tutup riwayat"
                autoFocus
                className="shrink-0 p-2 min-h-[44px] min-w-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-white/60 hover:text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 pt-4 pb-1 border-b border-white/10 space-y-3">
              {/* Pilihan Jarak Waktu Data */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/60">
                    Pilih Jarak Waktu Data:
                  </span>
                  <span className="text-[10px] font-mono text-cyan-300">
                    Aktif: {formatRangeLabel(historyMode, activeWindow)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { mode: '1h', label: '1 Jam' },
                      { mode: '6h', label: '6 Jam' },
                      { mode: '12h', label: '12 Jam' },
                      { mode: '24h', label: '24 Jam' },
                      { mode: '7d', label: '7 Hari' },
                      { mode: '30d', label: '30 Hari' },
                      { mode: '1y', label: '1 Tahun' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => applyHistoryRange(item.mode)}
                      className={`px-3 py-1.5 min-h-[44px] rounded-xl border text-[11px] font-mono cursor-pointer touch-manipulation transition-all font-semibold ${
                        item.mode === historyMode
                          ? 'bg-cyan-500/25 border-cyan-400 text-white shadow-sm shadow-cyan-500/20'
                          : 'bg-black/20 border-white/10 text-white/70 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] font-mono text-white/45">
                  Data dari riwayat tersimpan; tidak perlu alat terhubung.
                </p>
              </div>

              {/* Rentang kustom: dua input tanggal/jam, terapkan otomatis ber-debounce. */}
              <div className="p-3 rounded-xl bg-black/30 border border-white/10 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-white/60">Dari (WIB):</span>
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => onCustomInputChange('from', e.target.value)}
                    aria-label="Dari tanggal dan jam (WIB)"
                    className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-[11px] font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <span aria-hidden="true" className="text-white/40 text-[11px] font-mono">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-white/60">Sampai (WIB):</span>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => onCustomInputChange('to', e.target.value)}
                    aria-label="Sampai tanggal dan jam (WIB)"
                    className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-[11px] font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => applyHistoryRange('custom', customFromRef.current, customToRef.current)}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg border border-cyan-400/50 bg-cyan-500/20 text-cyan-200 text-[11px] font-mono font-bold hover:bg-cyan-500/30 cursor-pointer ml-auto"
                >
                  Terapkan Rentang
                </button>
              </div>

              {/* Action Box: Download CSV for this specific range */}
              <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/40 to-teal-950/40 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-emerald-200">
                      Ekspor CSV Jarak Waktu Ini
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                      {formatRangeLabel(historyMode, activeWindow)}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-white/50 mt-0.5">
                    {historyMode === '7d' || historyMode === '30d' || historyMode === '1y'
                      ? '⚠️ Rentang panjang memiliki volume data besar. Unduh 1 - 24 jam untuk respon instan.'
                      : 'Unduh file CSV hasil rekaman telemetri sesuai rentang waktu yang sedang dipilih.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const bounds = activeWindow || getHistoryBounds();
                    if (!bounds) {
                      setHistoryError('Rentang waktu belum valid untuk unduhan.');
                      return;
                    }
                    void handleExportCsv(bounds, historyMode);
                  }}
                  disabled={isExporting}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-emerald-400/50 bg-gradient-to-r from-emerald-500/30 to-teal-500/30 hover:from-emerald-500/40 hover:to-teal-500/40 text-emerald-100 text-xs font-mono font-bold flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer shadow-md shadow-emerald-950/30 shrink-0"
                >
                  {isExporting ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-emerald-300" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>
                        {exportProgress
                          ? `Mengunduh... (${(exportProgress.bytes / 1024).toFixed(0)} KB)`
                          : 'Menyiapkan CSV...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Unduh CSV Rentang Ini</span>
                    </>
                  )}
                </button>
              </div>

              {exportError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-mono"
                >
                  <div className="font-bold">Gagal Mengunduh CSV:</div>
                  <div>{exportError}</div>
                </div>
              )}

              {historyError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
                  {historyError}
                </div>
              )}

              {aboveCount > 0 && (
                <div
                  role="status"
                  className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200/90 text-[11px] font-mono"
                >
                  {aboveCount} data terbaru sudah tampil di grafik dan ikut tabel berikutnya. Bukan data hilang.
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto mx-6 my-3 rounded-2xl border border-white/10 bg-black/25 min-h-[280px] [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
              <table className="w-full min-w-[760px] text-left text-xs font-mono text-white/80">
                <thead className="bg-[#0f172a] text-white/60 uppercase text-[10px] tracking-widest sticky top-0 z-10 shadow-[0_1px_0_rgba(255,255,255,0.1)]">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-bold">Waktu ukur (WIB)</th>
                    <th scope="col" className="px-3 py-2.5 font-bold text-right">Temp (°C)</th>
                    <th scope="col" className="px-3 py-2.5 font-bold text-right">Kel (%RH)</th>
                    <th scope="col" className="px-3 py-2.5 font-bold text-right">MQ-137</th>
                    <th scope="col" className="px-3 py-2.5 font-bold text-right">MQ-136</th>
                    <th scope="col" className="px-3 py-2.5 font-bold text-right">MQ-4</th>
                    <th scope="col" className="px-4 py-2.5 font-bold text-right">Kualitas</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-white/5 ${isHistoryLoading && historyRows.length > 0 ? 'opacity-50' : ''}`}>
                  {isHistoryLoading && historyRows.length === 0 ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-3.5 w-32 rounded bg-white/10" /></td>
                        <td className="px-3 py-3"><div className="h-3.5 w-10 rounded bg-white/10 ml-auto" /></td>
                        <td className="px-3 py-3"><div className="h-3.5 w-10 rounded bg-white/10 ml-auto" /></td>
                        <td className="px-3 py-3"><div className="h-3.5 w-12 rounded bg-white/10 ml-auto" /></td>
                        <td className="px-3 py-3"><div className="h-3.5 w-12 rounded bg-white/10 ml-auto" /></td>
                        <td className="px-3 py-3"><div className="h-3.5 w-12 rounded bg-white/10 ml-auto" /></td>
                        <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-white/10 ml-auto" /></td>
                      </tr>
                    ))
                  ) : historyRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center">
                        <p className="text-white/60 font-bold">Belum ada data di halaman ini</p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {aboveCount > 0
                            ? 'Data terbaru menunggu giliran di atas watermark.'
                            : 'Tidak ada riwayat pembacaan dalam rentang ini. Coba preset lain atau perluas rentang di atas.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    historyRows.map((r, i) => (
                      <tr key={r.id} className={`transition-colors hover:bg-cyan-400/[0.06] ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-white/75 tabular-nums">
                          {r.measuredAt ? formatWibDateTime(new Date(r.measuredAt), true) : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums">
                          {r.temperatureC !== null ? `${r.temperatureC.toFixed(1)}` : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums">
                          {r.humidityPercent !== null ? `${r.humidityPercent.toFixed(1)}` : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-cyan-300 tabular-nums">
                          {r.mq137Raw !== null ? `${r.mq137Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-purple-300 tabular-nums">
                          {r.mq136Raw !== null ? `${r.mq136Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-emerald-300 tabular-nums">
                          {r.mq4Raw !== null ? `${r.mq4Raw.toFixed(1)}` : '--'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                              r.measurementTimeQuality === 'SYNCED'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : r.measurementTimeQuality === 'RECONSTRUCTED'
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                  : 'bg-white/10 text-white/50 border-white/15'
                            }`}
                          >
                            {r.measurementTimeQuality}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 px-6 py-3.5 border-t border-white/10">
              <span className="text-[11px] font-mono text-white/40 tabular-nums">
                Halaman {historyPage} · {historyRows.length} baris
                {!nextCursor && historyRows.length > 0 ? ' · terakhir' : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={isHistoryLoading}
                  onClick={handleHistoryReload}
                  title="Muat ulang halaman ini"
                  aria-label="Muat ulang halaman ini"
                  className="p-2 min-h-[44px] min-w-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-white/70 hover:text-white text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  <svg className={`w-4 h-4 ${isHistoryLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5 9a8 8 0 0114-3M19 15a8 8 0 01-14 3" />
                  </svg>
                </button>
                <button
                  disabled={historyPage <= 1 || isHistoryLoading}
                  onClick={handleHistoryPrev}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-white/80 hover:text-white text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  &larr; Kembali
                </button>
                <button
                  disabled={!nextCursor || isHistoryLoading}
                  onClick={handleHistoryNext}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  Berikutnya &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}