"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, OPERATOR_MAX_LENGTH } from '../auth/AuthProvider';

interface DeviceRow {
  id: string;
  deviceId: string | null;
  deviceLabel: string;
  operatorName: string | null;
  lastUsedAt: string;
  lastIp: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const clockOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

/**
 * Panel operator & perangkat.
 *
 * Aplikasi memakai satu akun yang dipakai bergiliran beberapa operator di
 * beberapa perangkat (HP di chamber, laptop di lab). Panel ini menjawab dua
 * pertanyaan yang muncul dari situ: "nama saya tercatat sebagai siapa di
 * perangkat ini?" dan "perangkat mana saja yang sedang memakai akun ini?".
 *
 * Nama operator tidak disimpan di server sebagai profil, melainkan dikirim
 * setiap permintaan sebagai header X-Operator (lihat AuthProvider.apiFetch)
 * dan dicatat pada baris dataset yang dibuat. Panel perangkat membaca
 * /api/v1/auth/devices, yang juga menampilkan sesi perangkat lain.
 */
export default function OperatorPanel() {
  const { user, operatorName, setOperatorName, device, sessionId, apiFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(operatorName);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadDevices = useCallback(async () => {
    setDevicesError(null);
    try {
      const res = await apiFetch('/api/v1/auth/devices');
      if (!res.ok) throw new Error(`Gagal memuat perangkat (kode ${res.status}).`);
      const body = (await res.json()) as { data?: DeviceRow[] };
      setDevices(Array.isArray(body.data) ? body.data : []);
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Gagal memuat perangkat.');
    }
  }, [apiFetch]);

  /**
   * Membuka panel: isian disegarkan dan daftar perangkat dimuat dari handler
   * klik, bukan dari efek — supaya tidak ada setState berantai saat render.
   */
  const openPanel = () => {
    setDraft(operatorName);
    setSaved(false);
    setDevices(null);
    setOpen(true);
    void loadDevices();
  };

  // Fokus ke isian & tutup dengan Escape selama panel terbuka.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await setOperatorName(draft);
      setSaved(true);
      // Daftar perangkat dimuat ulang supaya nama operator pada baris
      // "perangkat ini" langsung ikut berubah.
      await loadDevices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan operator.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (row: DeviceRow) => {
    setBusyId(row.id);
    setDevicesError(null);
    try {
      const res = await apiFetch(`/api/v1/auth/devices/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? `Gagal mengeluarkan perangkat (kode ${res.status}).`);
      }
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Gagal mengeluarkan perangkat.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-label={`Operator perangkat ini: ${operatorName || 'belum diisi'}`}
        className="flex items-center gap-2 min-h-[44px] px-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <span className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-tr from-amber-400/80 to-orange-500/80 flex items-center justify-center text-[11px] font-mono font-black text-slate-900">
          {(operatorName || '?').charAt(0).toUpperCase()}
        </span>
        <span className="hidden md:flex flex-col text-left leading-tight">
          <span className="text-[9px] font-mono uppercase tracking-widest text-white/45">Operator</span>
          <span className="text-[11px] font-mono font-semibold text-white/85 truncate max-w-[110px]">
            {operatorName || 'Belum diisi'}
          </span>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-16 overflow-y-auto"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-panel-title"
            ref={dialogRef}
            className="w-full max-w-lg rounded-2xl bg-[#16295c] border border-white/15 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)] p-5 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="operator-panel-title" className="text-base font-mono font-bold text-white">
                  Operator &amp; perangkat
                </h2>
                <p className="text-[11px] font-mono text-white/55 mt-1">
                  Satu akun dipakai bergiliran. Nama operator di perangkat ini ikut tercatat di setiap data
                  yang dibuat.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white/70 shrink-0"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="operator-name" className="block text-[12px] font-mono text-white/85">
                Operator di perangkat ini
              </label>
              <div className="flex gap-2">
                <input
                  id="operator-name"
                  ref={inputRef}
                  value={draft}
                  maxLength={OPERATOR_MAX_LENGTH}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setSaved(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      save();
                    }
                  }}
                  placeholder="mis. Budi (shift pagi)"
                  className="flex-1 px-3 py-2.5 rounded-xl bg-black/25 border border-white/20 text-sm font-mono text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                />
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="px-4 min-h-[44px] rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold disabled:opacity-50"
                >
                  {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
              <p className="text-[11px] font-mono text-white/45">
                Perangkat: {device?.label ?? 'belum dikenali'} · {device?.id ? device.id.slice(0, 8) : '—'}
              </p>
              {saveError && (
                <p role="alert" className="text-[11px] font-mono text-rose-300">
                  {saveError}
                </p>
              )}
              {saved && (
                <p role="status" className="text-[11px] font-mono text-emerald-300">
                  Nama operator tersimpan untuk perangkat ini.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-mono font-semibold text-white/85">
                  Perangkat aktif {devices ? `(${devices.length})` : ''}
                </h3>
                <button
                  type="button"
                  onClick={() => void loadDevices()}
                  className="text-[11px] font-mono text-cyan-200 hover:text-white"
                >
                  Muat ulang
                </button>
              </div>
              {devicesError && (
                <p role="alert" className="text-[11px] font-mono text-rose-300">
                  {devicesError}
                </p>
              )}
              <ul className="divide-y divide-white/10 rounded-xl border border-white/10 overflow-hidden">
                {devices === null && (
                  <li className="px-3 py-3 text-[11px] font-mono text-white/50">Memuat perangkat…</li>
                )}
                {devices?.length === 0 && (
                  <li className="px-3 py-3 text-[11px] font-mono text-white/50">Belum ada sesi aktif.</li>
                )}
                {devices?.map((row) => {
                  const isCurrent = row.current || row.id === sessionId;
                  return (
                    <li key={row.id} className="px-3 py-2.5 flex items-center justify-between gap-3 bg-black/10">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[12px] font-mono font-semibold text-white truncate">
                            {row.deviceLabel}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">
                              ini
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] font-mono text-white/50 truncate">
                          {row.operatorName || 'Tanpa nama'} · terakhir {clockOf(row.lastUsedAt)} (
                          {dateOf(row.lastUsedAt)})
                          {row.lastIp ? ` · ${row.lastIp}` : ''}
                        </span>
                      </span>
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => void revoke(row)}
                          disabled={busyId === row.id}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 text-rose-200 text-[11px] font-mono font-semibold hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          {busyId === row.id ? 'Keluar…' : 'Keluarkan'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
