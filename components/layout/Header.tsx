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

      {/* User profile & actions */}
      <div className="flex items-center gap-3">
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex flex-col text-right">
              <span className="text-xs font-mono font-medium text-white/90 truncate max-w-[140px] md:max-w-[180px]">
                {user.email}
              </span>
              <span
                className={`text-[9px] font-mono font-bold tracking-widest uppercase px-1.5 py-0.2 rounded w-fit self-end ${
                  user.role === 'ADMIN'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                }`}
              >
                {user.role}
              </span>
              {logoutError && (
                <span
                  role="alert"
                  className="text-[9px] font-mono text-rose-300 max-w-[180px] mt-0.5 truncate"
                  title={logoutError}
                >
                  {logoutError}
                </span>
              )}
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              title={isLoggingOut ? 'Sedang keluar...' : 'Keluar dari sesi'}
              aria-label="Logout"
              className="p-2 rounded-xl bg-white/10 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 text-white/70 hover:text-rose-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
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