"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { applyServerTimeFromHeader } from '../../lib/client-clock.ts';

export interface AuthUser {
  id: string;
  email: string;
  role: 'VIEWER' | 'ADMIN';
}

export class LogoutError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LogoutError';
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  csrfToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Throws LogoutError if logout failed on server (5xx or network). */
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Operator yang sedang memegang perangkat ini. Akun dipakai bergantian oleh
   * beberapa orang, jadi nama ini dikirim pada setiap permintaan (header
   * X-Operator) dan dicatat di baris dataset yang dibuat.
   *
   * Nilainya disimpan di server (auth_sessions.operator_name), bukan di
   * localStorage: perangkat baru langsung menampilkan operator yang benar dan
   * penggantian operator shift tercatat di sesi, bukan hanya di browser.
   */
  operatorName: string;
  setOperatorName: (name: string) => Promise<void>;
  /** Perangkat yang dikenali server (label dari User-Agent). */
  device: { id: string | null; label: string } | null;
  sessionId: string | null;
}

/** Batas panjang nama operator (sama dengan kolom di DB). */
export const OPERATOR_MAX_LENGTH = 40;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [operatorName, setOperatorNameState] = useState('');
  const [device, setDevice] = useState<{ id: string | null; label: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const router = useRouter();

  /**
   * Mengganti operator perangkat ini di server. Dipakai saat shift berganti:
   * satu akun, satu sesi, tapi nama pencatat di dataset berubah.
   */
  const setOperatorName = useCallback(async (name: string) => {
    const clean = name
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, OPERATOR_MAX_LENGTH);
    const res = await fetch('/api/v1/auth/operator', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: JSON.stringify({ operator: clean }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error?.message ?? `Gagal menyimpan operator (kode ${res.status}).`);
    }
    setOperatorNameState((body.data as { operator?: string } | undefined)?.operator ?? clean);
  }, [csrfToken]);

  /**
   * Menerapkan payload /auth/session atau /auth/login ke state. Operator ikut
   * dari server: perangkat yang sama setelah reload langsung menampilkan nama
   * operator terakhir yang menekan "Simpan".
   */
  const applySessionData = useCallback(
    (data: {
      user?: AuthUser | null;
      csrfToken?: string | null;
      device?: { id?: string | null; label?: string | null } | null;
      operator?: string | null;
      sessionId?: string | null;
    }) => {
      setUser(data.user ?? null);
      setCsrfToken(data.csrfToken ?? null);
      setDevice(
        data.device
          ? { id: data.device.id ?? null, label: data.device.label ?? 'Perangkat tanpa label' }
          : null
      );
      setSessionId(data.sessionId ?? null);
      // "Tanpa nama" adalah nilai bawaan server, bukan nama yang dipilih orang.
      const operator = typeof data.operator === 'string' ? data.operator.trim() : '';
      setOperatorNameState(operator === 'Tanpa nama' ? '' : operator);
    },
    []
  );

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/session', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        applySessionData({});
        return;
      }
      const body = (await res.json()) as { data?: Parameters<typeof applySessionData>[0] };
      applySessionData(body.data ?? {});
    } catch {
      applySessionData({});
    } finally {
      setIsLoading(false);
    }
  }, [applySessionData]);

  /**
   * Memuat profil sesi saat halaman dibuka. Rantai `.then` dipakai (bukan
   * `await` di badan efek) supaya setState hanya terjadi setelah respons
   * datang — pola yang sama dengan pemuatan data lain di aplikasi ini.
   */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/auth/session', {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          applySessionData({});
          return;
        }
        const body = (await res.json()) as { data?: Parameters<typeof applySessionData>[0] };
        if (!cancelled) applySessionData(body.data ?? {});
      })
      .catch(() => {
        if (!cancelled) applySessionData({});
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySessionData]);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || 'Login gagal');
    }

    applySessionData(body.data ?? {});
  };

  const logout = async () => {
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    let res: Response;
    try {
      res = await fetch('/api/v1/auth/logout', { method: 'POST', headers });
    } catch {
      // Network / offline: session was NOT revoked on the server.
      // Do NOT clear local state; throw so the UI can inform the user.
      throw new LogoutError('Network error: logout request could not be sent', undefined);
    }

    if (res.ok) {
      // 200/204: server confirmed revocation — clear client state and redirect.
      setUser(null);
      setCsrfToken(null);
      router.push('/login');
      return;
    }

    if (res.status === 401) {
      // Session already invalid on server (expired, revoked elsewhere).
      // It is safe to clear client state as the cookie is already dead.
      setUser(null);
      setCsrfToken(null);
      router.push('/login');
      return;
    }

    // 5xx or any unexpected non-OK status: session may still be alive on server.
    // Do NOT treat this as a successful logout.
    throw new LogoutError(`Logout gagal (HTTP ${res.status}): sesi mungkin masih aktif di server.`, res.status);
  };

  /**
   * Wrapper fetch: menyertakan X-CSRF-Token pada mutasi dan X-Operator pada
   * setiap permintaan. Header operator inilah yang dicatat server sebagai
   * "siapa yang mencatat" — akun tetap satu, orangnya bisa bergantian.
   *
   * Setiap respons juga membawa `x-server-time` (jam server). Di sini sampel
   * itu dipakai untuk menyelaraskan jam klien (`lib/client-clock.ts`), supaya
   * hitungan mundur kalibrasi/sesi memakai jam server yang sama di semua
   * perangkat — bukan jam perangkat masing-masing.
   */
  const apiFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers);

      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      if (operatorName) {
        headers.set('X-Operator', operatorName);
      }

      const sentAtMs = Date.now();
      const res = await fetch(input, {
        ...init,
        headers,
      });
      applyServerTimeFromHeader(res.headers.get('x-server-time'), sentAtMs, Date.now());

      if (res.status === 401) {
        setUser(null);
        setCsrfToken(null);
        router.push('/login');
      }

      return res;
    },
    [csrfToken, operatorName, router]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        csrfToken,
        isLoading,
        login,
        logout,
        refreshSession: fetchSession,
        apiFetch,
        operatorName,
        setOperatorName,
        device,
        sessionId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
