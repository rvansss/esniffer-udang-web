"use client";

import React, { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Dialog konfirmasi bertema kaca-biru aplikasi (pengganti window.confirm
 * bawaan browser). Aksesibel: fokus awal di tombol Batal (aman untuk aksi
 * destruktif), Escape/m klik-luar membatalkan, aria-modal + labelledby.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const confirmCls =
    tone === 'danger'
      ? 'bg-rose-500/25 hover:bg-rose-500/35 border-rose-400/50 text-rose-100'
      : 'bg-emerald-500/25 hover:bg-emerald-500/35 border-emerald-400/50 text-emerald-100';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)' }}
        className="w-full max-w-sm rounded-2xl border border-white/15 p-5 space-y-4"
      >
        <h3 id="confirm-dialog-title" className="text-base font-mono font-bold text-white">
          {title}
        </h3>
        <p id="confirm-dialog-message" className="text-[13px] font-mono text-white/75 leading-relaxed">
          {message}
        </p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-transparent hover:bg-white/10 border border-white/15 text-white/80 text-sm font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-mono font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 ${confirmCls}`}
          >
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
