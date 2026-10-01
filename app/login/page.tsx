"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, login, isLoading: isAuthLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already logged in, redirect to target or default chamber
  useEffect(() => {
    if (!isAuthLoading && user) {
      const redirectUrl = searchParams.get('redirect') || '/chamber/CH-01';
      router.replace(redirectUrl);
    }
  }, [user, isAuthLoading, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      const redirectUrl = searchParams.get('redirect') || '/chamber/CH-01';
      router.replace(redirectUrl);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md w-full space-y-8 bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
      <div>
        <div className="flex justify-center mb-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-bold tracking-widest bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            E-SNIFFER IoT
          </span>
        </div>
        <h2 className="text-center text-3xl font-extrabold font-mono tracking-wider text-white drop-shadow-md">
          Masuk Sesi
        </h2>
        <p className="mt-2 text-center text-sm text-white/70">
          Monitoring Gas Real-time & Telemetri Mutu Udang
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm flex items-start gap-3 backdrop-blur-md"
        >
          <svg
            className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-semibold">Autentikasi Gagal</p>
            <p className="text-xs text-rose-300/90 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-mono font-bold uppercase tracking-wider text-white/80 mb-1"
            >
              Email
            </label>
            <div className="relative">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                placeholder="admin@esniffer.local"
                className="w-full px-4 py-3 bg-black/25 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition-all font-mono text-sm disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-mono font-bold uppercase tracking-wider text-white/80 mb-1"
            >
              Kata Sandi
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                placeholder="••••••••••••"
                className="w-full px-4 py-3 pr-12 bg-black/25 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition-all font-mono text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/50 hover:text-white transition-colors"
              >
                {showPassword ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                    />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={isSubmitting || !email || !password}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono font-bold rounded-xl shadow-lg shadow-cyan-500/25 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wider flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Memverifikasi...</span>
              </>
            ) : (
              'Masuk ke Sistem'
            )}
          </button>
        </div>
      </form>

      <div className="pt-4 border-t border-white/10 text-center">
        <p className="text-xs text-white/50 font-mono">
          Default Admin: <code className="text-white/80">admin@esniffer.local</code> | Viewer: <code className="text-white/80">viewer@esniffer.local</code>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="max-w-md w-full p-8 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 text-center text-white/60 font-mono text-sm">
            Memuat form...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
