"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { formatWibDateTime } from '../../shared/datetime.ts';
import { useAuth } from '../auth/AuthProvider';

interface NotificationItem {
  id: string;
  kind: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  batchId: string | null;
  sessionId: string | null;
}

// Symmetrical bell icon (Lucide-style) - 24x24 viewBox, centered
const BellIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={`w-5 h-5 ${className}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13.73 21a2 2 0 0 1-3.46 0"
    />
  </svg>
);

export default function NotificationBell() {
  const { user, apiFetch } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalNotification, setModalNotification] = useState<NotificationItem | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(false);
  const historyFetchedRef = useRef(false);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch('/api/v1/notifications/unread-count');
      if (res.ok) {
        const json = await res.json();
        setUnreadCount(json.data.count);
      }
    } catch {
      // silent
    }
  }, [user, apiFetch]);

  // Fetch notification history (first page)
  const fetchNotifications = useCallback(async (isLoadMore = false) => {
    if (!user || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (isLoadMore && cursor) params.set('cursor', cursor);
      const res = await apiFetch(`/api/v1/notifications?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (isLoadMore) {
          setNotifications((prev) => [...prev, ...json.data]);
        } else {
          setNotifications(json.data);
        }
        setHasMore(!!json.meta.nextCursor);
        setCursor(json.meta.nextCursor);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user, apiFetch, cursor, loading]);

  // Mark single notification as read
  const markRead = useCallback(
    async (id: string) => {
      try {
        const res = await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
        if (res.ok) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
          );
          fetchUnreadCount();
        }
      } catch {
        // silent
      }
    },
    [apiFetch, fetchUnreadCount]
  );

  // Mark all as read
  const markAllRead = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/notifications/read-all', { method: 'PATCH' });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
        );
        fetchUnreadCount();
      }
    } catch {
      // silent
    }
  }, [apiFetch, fetchUnreadCount]);

  // Handle new notification from worker (polling)
  useEffect(() => {
    if (!user) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      fetchUnreadCount();
    }
    const interval = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(interval);
  }, [user, fetchUnreadCount]);

  // Load history when dropdown opens (once)
  useEffect(() => {
    if (isOpen && !historyFetchedRef.current && notifications.length === 0) {
      historyFetchedRef.current = true;
      fetchNotifications(false);
    }
  }, [isOpen, fetchNotifications, notifications.length]);

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  // Audio setup on first user interaction (autoplay policy)
  useEffect(() => {
    if (!audioEnabled) return;
    audioRef.current = new Audio('/assets/Better Call Saul Ringtone.mp3');
    audioRef.current.loop = true;
    audioRef.current.volume = 0.6;
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [audioEnabled]);

  // Play audio when modal opens
  useEffect(() => {
    if (showModal && audioEnabled && audioRef.current) {
      audioRef.current.play().catch(() => {
        // Autoplay blocked; user must interact first
      });
    } else if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [showModal, audioEnabled]);

  // Helper: format date for display
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return formatWibDateTime(d);
  };

  if (!user) return null;

  return (
    <>
      {/* Bell button in header */}
      <div className="relative" ref={dropdownRef}>
        <button
          ref={bellRef}
          onClick={() => setIsOpen((v) => !v)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={unreadCount > 0 ? `${unreadCount} notifikasi belum dibaca` : 'Notifikasi'}
          className="relative min-h-[44px] min-w-[44px] p-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 flex items-center justify-center"
        >
          <BellIcon className="text-white/90" />
          {unreadCount > 0 && (
            <span
              className="absolute top-1 right-1 min-w-[18px] h-5 rounded-full bg-rose-500 text-[10px] font-mono font-bold text-white flex items-center justify-center px-1.5 animate-pulse"
              aria-hidden="true"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div
            role="menu"
            aria-label="Riwayat notifikasi"
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 overflow-hidden z-20"
            style={{
              background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)',
              boxShadow: '0 20px 60px -10px rgba(0,0,0,0.7)',
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <h3 className="text-sm font-mono font-bold text-white">Notifikasi</h3>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0 || loading}
                className="text-[11px] font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded px-1.5"
                style={{
                  color: unreadCount > 0 ? '#6EE7B7' : '#6B7280',
                }}
              >
                Tandai semua dibaca
              </button>
            </div>

            {notifications.length === 0 && !loading ? (
              <div className="px-3 py-6 text-center text-[12px] font-mono text-white/50">
                Tidak ada notifikasi
              </div>
            ) : (
              <>
                <div className="max-h-[320px] overflow-y-auto">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      role="menuitem"
                      className={`w-full px-3 py-2.5 text-left border-b border-white/5 hover:bg-white/5 transition-colors ${
                        n.readAt ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${
                            n.readAt ? 'bg-white/30' : 'bg-emerald-400'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-mono font-medium text-white truncate">
                            {n.message}
                          </p>
                          <p className="text-[10px] font-mono text-white/50 mt-0.5">
                            {formatDate(n.createdAt)}
                          </p>
                          {n.sessionId && (
                            <p className="text-[10px] font-mono text-white/40 truncate">
                              Sesi: {n.sessionId}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {hasMore && (
                  <button
                    onClick={() => fetchNotifications(true)}
                    disabled={loading}
                    className="w-full px-3 py-2 text-center text-[12px] font-mono text-white/70 hover:text-white border-t border-white/10 disabled:opacity-50"
                  >
                    {loading ? 'Memuat…' : 'Lebih banyak'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal for new notification (warmup_stable) */}
      {showModal && modalNotification && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
            }
            setShowModal(false);
            setModalNotification(null);
          }}
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="notify-modal-title"
            aria-describedby="notify-modal-message"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)',
              boxShadow: '0 20px 60px -10px rgba(0,0,0,0.7)',
            }}
            className="w-full max-w-md rounded-2xl border border-white/15 p-5 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 shrink-0 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-emerald-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <h3
                  id="notify-modal-title"
                  className="text-base font-mono font-bold text-white"
                >
                  Sesi Siap Dimulai
                </h3>
                <p
                  id="notify-modal-message"
                  className="text-[12px] font-mono text-white/75"
                >
                  {modalNotification.message}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 text-[12px] font-mono text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioEnabled}
                  onChange={(e) => setAudioEnabled(e.target.checked)}
                  className="accent-emerald-500 w-4 h-4"
                />
                Audio lonceng
              </label>
            </div>

            <button
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current.currentTime = 0;
                }
                markRead(modalNotification.id);
                setShowModal(false);
                setModalNotification(null);
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400/50 text-emerald-100 text-sm font-mono font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
}