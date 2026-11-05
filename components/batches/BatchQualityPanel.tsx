"use client";
import { useState } from 'react';

interface QualityReport {
  checked: number; included: number; excluded: number;
  reasons: Record<string, number>; batchIssues: string[];
}
const labels: Record<string, string> = {
  BATCH_UNLOCKED: 'Batch belum dikunci', SHRIMP_TYPE_MISSING: 'Jenis udang belum tercatat',
  SESSION_MISSING: 'Reading belum memiliki sesi', SESSION_NOT_COMPLETE: 'Sesi belum selesai',
  SESSION_DEVICE_MISSING: 'Chamber atau alat belum lengkap', RELATION_MISMATCH: 'Relasi data tidak konsisten',
  TIMEPOINT_MISMATCH: 'Tahap dan waktu pengamatan tidak konsisten', TIME_NOT_SYNCED: 'Waktu sensor belum tersinkron',
  OUTSIDE_SESSION_WINDOW: 'Reading di luar waktu sesi', OBSERVATION_INVALID: 'Berat atau suhu tahap belum valid',
  BASELINE_MISSING: 'Baseline valid belum tersedia', BASELINE_FLAG_MISMATCH: 'Penandaan baseline tidak sesuai waktu',
  BASELINE_READING: 'Reading baseline dipisahkan dari sampel',
};

export default function BatchQualityPanel({ batchId, apiFetch }: {
  batchId: string; apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = async (download: boolean) => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/v1/batches/${encodeURIComponent(batchId)}/export?format=${download ? 'ml' : 'quality'}`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? 'Pemeriksaan dataset gagal'); }
      if (!download) { setReport((await response.json()).data); return; }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ml-v1-${batchId}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Pemeriksaan dataset gagal'); }
    finally { setBusy(false); }
  };
  return <section className="p-5 rounded-2xl bg-white/10 border border-white/20 space-y-3" aria-label="Kualitas dataset">
    <h3 className="font-mono font-bold text-white text-sm">Kualitas dataset</h3>
    <p className="text-xs text-white/65">Periksa kelengkapan dan kualitas sensor sebelum mengunduh dataset. Data mentah tetap tersedia pada ekspor biasa.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void request(false)} className="min-h-11 px-4 border border-cyan-400/40 rounded-xl text-xs text-cyan-100">{busy ? 'Memproses…' : 'Periksa kualitas'}</button>
      <button type="button" disabled={busy || !report?.included} onClick={() => void request(true)} className="min-h-11 px-4 border border-emerald-400/40 rounded-xl text-xs text-emerald-100 disabled:opacity-50">Unduh dataset ML</button>
    </div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {report && <div aria-live="polite" className="text-xs text-white/80 space-y-2">
      <p>{report.checked} reading diperiksa · {report.included} lolos · {report.excluded} dikecualikan.</p>
      {report.batchIssues.map((reason) => <p key={reason} className="text-amber-200">{labels[reason] ?? reason}</p>)}
      <ul className="space-y-1">{Object.entries(report.reasons).map(([reason, count]) => <li key={reason}>{labels[reason] ?? (reason.startsWith('SENSOR_INVALID_') ? `Sensor ${reason.slice(15).toLowerCase()} tidak valid` : reason)}: {count}</li>)}</ul>
      <p className="text-white/50">Satu reading dapat memiliki lebih dari satu alasan pengecualian.</p>
    </div>}
  </section>;
}
