"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/session', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (res.ok) {
        const body = await res.json();
        if (body.data?.user) {
          setUser(body.data.user);
          if (body.data.csrfToken) {
            setCsrfToken(body.data.csrfToken);
          }
        } else {
          setUser(null);
          setCsrfToken(null);
        }
      } else {
        setUser(null);
        setCsrfToken(null);
      }
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const init = async () => {
      try {
        const res = await fetch('/api/v1/auth/session', {
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' },
        });

        if (ignore) return;
        if (res.ok) {
          const body = await res.json();
          if (body.data?.user) {
            setUser(body.data.user);
            if (body.data.csrfToken) {
              setCsrfToken(body.data.csrfToken);
            }
          } else {
            setUser(null);
            setCsrfToken(null);
          }
        } else {
          setUser(null);
          setCsrfToken(null);
        }
      } catch {
        if (!ignore) {
          setUser(null);
          setCsrfToken(null);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    void init();
    return () => {
      ignore = true;
    };
  }, []);

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

    setUser(body.data.user);
    if (body.data.csrfToken) {
      setCsrfToken(body.data.csrfToken);
    }
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

  // Wrapper fetch yang otomatis menyertakan X-CSRF-Token pada mutasi state
  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }

    const res = await fetch(input, {
      ...init,
      headers,
    });

    if (res.status === 401) {
      setUser(null);
      setCsrfToken(null);
      router.push('/login');
    }

    return res;
  };

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
