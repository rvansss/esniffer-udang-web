"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider';

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
          <Link
            href="/batches/new"
            className="px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-mono font-bold tracking-wider transition-all"
          >
            ＋ Batch Baru
          </Link>
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

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center">
          <p className="text-sm font-mono text-white/60">Belum ada batch. Buat batch pertama dari pengadaan pasar.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {batches.map((b) => (
            <Link
              key={b.batchId}
              href={`/batches/${encodeURIComponent(b.batchId)}`}
              className="block p-5 rounded-2xl bg-white/10 hover:bg-white/15 backdrop-blur-lg border border-white/20 transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-white">{b.batchId}</span>
                {b.lockedAt ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-white/10 text-white/60 border-white/20">
                    Terkunci
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded border uppercase bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                    Terbuka
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs font-mono text-white/60">
                {b.marketSource} • {b.shrimpCount} ekor • {b.totalWeightG ?? '--'} g
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
