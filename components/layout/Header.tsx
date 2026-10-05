"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, LogoutError } from '../auth/AuthProvider';

interface ChamberItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export default function Header() {
  const pathname = usePathname();
  const { user, logout, apiFetch } = useAuth();
  const [chambers, setChambers] = useState<ChamberItem[]>([]);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLElement | null>>([]);

  const focusItem = React.useCallback((index: number) => {
    const items = itemRefs.current.filter((el): el is HTMLElement => el !== null && !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const next = ((index % items.length) + items.length) % items.length;
    items[next].focus();
  }, []);

  const isLoginPage = pathname === '/login';

  // Fetch chambers when user is authenticated and not on login page
  useEffect(() => {
    if (!user || isLoginPage) return;

    let isMounted = true;
    const fetchChambers = async () => {
      try {
        const res = await apiFetch('/api/v1/chambers?active=true&limit=50');
        if (res.ok) {
          const json = await res.json();
          if (isMounted && Array.isArray(json.data)) {
            setChambers(json.data);
          }
        }
      } catch {
        // Silently handle - poller / route handles degraded state
      }
    };

    fetchChambers();
    return () => {
      isMounted = false;
    };
  }, [user, isLoginPage, apiFetch]);

  // Extract current chamberId from path e.g. /chamber/CH-01 -> CH-01, or legacy /chamber/1 -> 1
  const pathParts = pathname?.split('/') || [];
  const currentChamberParam = pathParts[1] === 'chamber' ? pathParts[2] : null;

  // Tutup menu profil saat klik di luar atau tekan Escape/TAB
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
      if (e.key === 'Tab') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // Fokus item pertama saat menu dibuka (pola menu-button WAI-APG)
  useEffect(() => {
    if (menuOpen) {
      focusItem(0);
    }
  }, [menuOpen, focusItem]);

  const handleMenuKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(Number.MAX_SAFE_INTEGER - 1);
    }
  };

  // Determine if a chamber is currently active in the navigation
  const isChamberActive = (c: ChamberItem, index: number) => {
    if (!currentChamberParam) return false;
    if (currentChamberParam === c.code || currentChamberParam === c.id) return true;
    // Legacy support: /chamber/1 maps to 1st chamber, /chamber/2 to 2nd chamber
    const numericParam = parseInt(currentChamberParam, 10);
    if (!isNaN(numericParam) && numericParam === index + 1) return true;
    return false;
  };

  const handleLogout = async () => {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      // logout() throws LogoutError on network/server failure, and redirects on success/401.
      await logout();
    } catch (err) {
      if (err instanceof LogoutError) {
        setLogoutError(err.message);
      } else {
        setLogoutError('Logout gagal: terjadi kesalahan tidak terduga.');
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <header className="relative z-10 flex flex-wrap justify-between items-center px-6 py-4 rounded-2xl bg-white/10 backdrop-blur-lg border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] gap-4">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20 group-hover:scale-105 transition-transform">
            <span className="font-mono font-black text-white text-base">eS</span>
          </div>
          <h1 className="text-xl md:text-2xl font-mono text-white tracking-widest font-black drop-shadow-md">
            E-Sniffer
          </h1>
        </Link>
        <span className="hidden sm:inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/10 text-white/60 border border-white/10 uppercase tracking-widest">
          IoT Telemetry
        </span>
      </div>

      {/* Chamber Navigation (Hidden on Login) */}
      {!isLoginPage && (
        <nav aria-label="Chamber Navigation" className="flex items-center p-1 rounded-xl bg-black/25 border border-white/10 backdrop-blur-md overflow-x-auto max-w-full">
          {chambers.length > 0 ? (
            chambers.map((c, idx) => {
              const active = isChamberActive(c, idx);
              return (
                <Link
                  key={c.id}
                  href={`/chamber/${encodeURIComponent(c.code)}`}
                  className={`px-4 py-2 rounded-lg font-mono text-xs md:text-sm font-semibold transition-all whitespace-nowrap ${
                    active
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 shadow-sm shadow-cyan-500/20'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {c.name || c.code}
                </Link>
              );
            })
          ) : (
            <div className="flex gap-2">
              <Link
                href="/chamber/CH-01"
                className={`px-4 py-2 rounded-lg font-mono text-xs md:text-sm font-semibold transition-all ${
                  currentChamberParam === 'CH-01' || currentChamberParam === '1'
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Chamber 1
              </Link>
              <Link
                href="/chamber/CH-02"
                className={`px-4 py-2 rounded-lg font-mono text-xs md:text-sm font-semibold transition-all ${
                  currentChamberParam === 'CH-02' || currentChamberParam === '2'
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Chamber 2
              </Link>
            </div>
          )}
        </nav>
      )}

      {/* Profil & menu pengguna */}
      <div className="flex items-center gap-3">
        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              ref={triggerRef}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls="profile-menu"
              aria-label="Menu pengguna"
              className="flex items-center gap-2.5 min-h-[44px] px-2 pr-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <span className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-mono font-black text-white text-sm">
                {user.email.charAt(0).toUpperCase()}
              </span>
              <span className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-mono font-medium text-white/90 truncate max-w-[140px] md:max-w-[180px]">
                  {user.email}
                </span>
                <span
                  className={`text-[9px] font-mono font-bold tracking-widest uppercase px-1.5 py-0.2 rounded w-fit ${
                    user.role === 'ADMIN'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {user.role}
                </span>
              </span>
              <svg
                className={`w-4 h-4 shrink-0 text-white/50 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {logoutError && (
              <span
                role="alert"
                className="absolute right-0 top-full mt-1 text-[9px] font-mono text-rose-300 max-w-[180px] truncate"
                title={logoutError}
              >
                {logoutError}
              </span>
            )}
            {menuOpen && (
              <div
                role="menu"
                id="profile-menu"
                aria-label="Menu akun"
                style={{
                  background: 'linear-gradient(180deg, #24407f 0%, #16295c 100%)',
                  boxShadow: '0 20px 60px -10px rgba(0,0,0,0.7)',
                }}
                className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-white/15 overflow-hidden z-20 p-2"
              >
                <div className="flex items-center gap-3 px-2 pt-1 pb-3">
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-mono font-black text-white">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-mono font-semibold text-white truncate">{user.email}</span>
                    <span className="mt-0.5 inline-block text-[10px] font-mono font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-md bg-white/10 text-white/70 border border-white/10">
                      {user.role}
                    </span>
                  </span>
                </div>
                <div role="separator" className="mx-2 border-t border-white/10" />
                <div className="pt-2 space-y-1">
                  <Link
                    href="/batches"
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[0] = el;
                    }}
                    onKeyDown={(e) => handleMenuKeyDown(e, 0)}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-2 py-2 rounded-xl text-[13px] font-mono font-semibold text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:bg-white/10"
                  >
                    <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-400/15 border border-emerald-300/20 flex items-center justify-center text-emerald-200">
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </span>
                    Pencatatan
                  </Link>
                  <button
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[1] = el;
                    }}
                    onKeyDown={(e) => handleMenuKeyDown(e, 1)}
                    onClick={() => {
                      setMenuOpen(false);
                      void handleLogout();
                    }}
                    disabled={isLoggingOut}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-[13px] font-mono font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-white/10"
                  >
                    <span className="w-8 h-8 shrink-0 rounded-lg bg-rose-400/15 border border-rose-300/20 flex items-center justify-center text-rose-200">
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                    </span>
                    {isLoggingOut ? 'Keluar…' : 'Keluar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : !isLoginPage ? (
          <Link
            href="/login"
            className="px-4 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-mono font-bold tracking-wider transition-all"
          >
            Masuk
          </Link>
        ) : null}
      </div>
    </header>
  );
}