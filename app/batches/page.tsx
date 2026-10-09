"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import SuccessNotice, { useSuccessNotice } from '../../components/ui/SuccessNotice';

interface BatchItem {
  batchId: string;
  marketSource: string;
  shrimpCount: number;
  totalWeightG: number | null;
  lockedAt: string | null;
  createdAt: string;
}

export default function BatchesPage() {
  const { user, isLoading, apiFetch } = useAuth();
  const router = useRouter();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<{ force: boolean; message: string } | null>(null);
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
    apiFetch('/api/v1/batches?limit=100')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Gagal memuat (${res.status})`);
        }
        const json = await res.json();
        return Array.isArray(json.data) ? (json.data as BatchItem[]) : [];
      })
      .then((items) => {
        if (cancelled) return;
        setBatches(items);
        setSelected((prev) => prev.filter((id) => items.some((b) => b.batchId === id)));
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Gagal memuat daftar batch');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, apiFetch, refreshKey]);

  const toggleSelect = (batchId: string) => {
    setSelected((prev) => (prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]));
  };

  // Kelompokkan per pasar sesuai urutan kemunculan (daftar API sudah terbaru dulu).
  const marketGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BatchItem[]>();
    for (const b of batches) {
      if (!map.has(b.marketSource)) {
        map.set(b.marketSource, []);
        order.push(b.marketSource);
      }
      map.get(b.marketSource)!.push(b);
    }
    return order.map((marketSource) => ({ marketSource, items: map.get(marketSource)! }));
  }, [batches]);

  const handleBulkDelete = async (force: boolean) => {
    if (selected.length === 0) {
      return;
    }
    setConfirmBulk(null);
    setBulkBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/batches/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: selected, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || `Gagal menghapus (kode ${res.status}). Periksa koneksi lalu coba lagi.`);
      }
      const failed = (body.data as Array<{ batchId: string; deleted: boolean; error?: string }>).filter(
        (r) => !r.deleted
      );
      if (failed.length > 0 && !force) {
        const linked = failed.filter((r) => r.error?.includes('data tertaut'));
        if (linked.length === failed.length) {
          setConfirmBulk({
            force: true,
            message: `${failed.length} batch memiliki data tertaut (${linked.map((r) => r.batchId).join(', ')}). Hapus dan putuskan tautannya?`,
          });
          return;
        }
        throw new Error(failed.map((r) => r.error).join('; '));
      }
      if (failed.length > 0) {
        throw new Error(failed.map((r) => r.error).join('; '));
      }
      notify(`Berhasil menghapus ${selected.length} batch.`);
      setSelected([]);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus batch');
    } finally {
      setBulkBusy(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-mono font-black text-white tracking-widest">
            PENCATATAN DATASET
          </h2>
          <p className="text-xs font-mono text-white/60 mt-1">
            Protokol pengumpulan udang windu: pasar → cold-chain → lab → sensor
          </p>
        </div>
        {user.role === 'ADMIN' && (
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <button
                onClick={() => setConfirmBulk({
                  force: false,
                  message: `Hapus ${selected.length} batch terpilih (${selected.join(', ')})? Tindakan ini tidak bisa dibatalkan.`,
                })}
                disabled={bulkBusy}
                title={`Hapus ${selected.length} batch terpilih`}
                className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-mono font-bold tracking-wider transition-colors disabled:opacity-50"
              >
                Hapus ({selected.length})
              </button>
            )}
            <Link
              href="/batches/new"
              className="px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold tracking-wider transition-all"
            >
              ＋ Batch Baru
            </Link>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-mono">
          {error}{' '}
          <button onClick={() => setRefreshKey((k) => k + 1)} className="underline font-bold">
            Coba lagi
          </button>
        </div>
      )}

      <SuccessNotice message={notice} onDismiss={dismiss} />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center">
          <p className="text-sm font-mono text-white/60">Belum ada batch. Buat batch pertama dari pengadaan pasar.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {marketGroups.map((group) => (
            <section key={group.marketSource} aria-label={`Pasar ${group.marketSource}`}>
              <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                <h3 className="text-sm font-mono font-bold text-white tracking-widest">
                  {group.marketSource}
                </h3>
                <span className="text-[11px] font-mono text-white/50">
                  {group.items.length} batch
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {group.items.map((b) => (
                  <div
                    key={b.batchId}
              className="p-5 rounded-2xl bg-white/10 hover:bg-white/15 backdrop-blur-lg border border-white/20 transition-colors"
            >
              <Link
                href={`/batches/${encodeURIComponent(b.batchId)}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-white">{b.batchId}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {b.lockedAt ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-white/10 text-white/60 border-white/20">
                        Terkunci
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                        Terbuka
                      </span>
                    )}
                    {user.role === 'ADMIN' && (
                      <input
                        type="checkbox"
                        checked={selected.includes(b.batchId)}
                        onChange={() => toggleSelect(b.batchId)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Pilih batch ${b.batchId}`}
                        title="Pilih untuk hapus banyak"
                        className="w-5 h-5 accent-rose-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 rounded"
                      />
                    )}
                  </span>
                </div>
                <p className="mt-2 text-xs font-mono text-white/60">
                  {b.shrimpCount} ekor • {b.totalWeightG ?? '--'} g
                </p>
              </Link>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmBulk !== null}
        title={confirmBulk?.force ? 'Hapus dan putuskan tautan?' : 'Hapus batch terpilih?'}
        message={confirmBulk?.message ?? ''}
        confirmLabel="Ya, hapus"
        busy={bulkBusy}
        onConfirm={() => {
          if (confirmBulk) {
            void handleBulkDelete(confirmBulk.force);
          }
        }}
        onCancel={() => setConfirmBulk(null)}
      />
    </div>
  );
}
