"use client";

import React, { useState } from "react";

interface SuccessNoticeProps {
  message: string | null;
  onDismiss: () => void;
}

/**
 * Pemberitahuan sukses untuk aksi mutasi (hapus batch, hapus foto, unggah,
 * kunci, sesi). Memakai `role="status"` + aria-live polite supaya pembaca
 * layar mengumumkan hasil tanpa memutus alur, melayang di sudut kanan bawah
 * agar tetap terlihat walau pengguna sedang menggulir, lalu menghilang
 * sendiri setelah 5 detik atau saat tombol tutup ditekan.
 */
export default function SuccessNotice({ message, onDismiss }: SuccessNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        message
          ? 'fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 flex items-start justify-between gap-3 p-3 rounded-xl bg-emerald-600/80 border border-emerald-400/50 text-emerald-50 text-xs font-mono shadow-lg shadow-black/40 backdrop-blur-md'
          : 'sr-only'
      }
    >
      {message && (
        <>
          <span>✓ {message}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Tutup pemberitahuan"
            className="shrink-0 w-5 h-5 leading-none rounded text-emerald-50/80 hover:bg-white/20 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/80"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

/** State + timer untuk menampilkan satu pemberitahuan sukses per aksi. */
export function useSuccessNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const notify = (text: string) => {
    setMessage(text);
    // Bersihkan hanya bila pesan belum diganti oleh aksi lain.
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 5000);
  };
  return { message, notify, dismiss: () => setMessage(null) };
}
