"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../components/auth/AuthProvider';

export interface SensorValue<T = number> {
  value: T | null;
  unit: string;
  quality: string;
}

export interface LatestReading {
  id: string;
  measuredAt: string | null;
  receivedAt: string;
  measurementTimeQuality: 'SYNCED' | 'RECONSTRUCTED' | 'UNKNOWN';
  values: {
    temperatureC: SensorValue;
    humidityPercent: SensorValue;
    mq137Raw: SensorValue;
    mq136Raw: SensorValue;
    mq4Raw: SensorValue;
  };
}

export interface DeviceStatus {
  device: {
    id: string;
    mqttDeviceId: string;
    name: string;
  };
  connection: {
    state: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    evidence: string | null;
    bootId: string | null;
    sessionId: string | null;
    lastSeenAt: string | null;
    statusProcessedAt: string | null;
  };
  freshness: {
    state: 'fresh' | 'stale' | 'unknown';
    ageSeconds: number | null;
    thresholdSeconds: number;
  };
  reading: LatestReading | null;
}

export interface ChamberLatestResponse {
  chamber: {
    id: string;
    code: string;
    name: string;
  };
  devices: DeviceStatus[];
}

export type RequestState = 'idle' | 'loading' | 'success' | 'error';

interface UseChamberLatestOptions {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
}

export function useChamberLatest(
  chamberParam: string | null,
  options: UseChamberLatestOptions = {}
) {
  const {
    initialIntervalMs = 5000,
    maxIntervalMs = 30000,
    timeoutMs = 8000,
  } = options;

  const router = useRouter();
  const { apiFetch } = useAuth();

  // Legacy URL compatibility: map '1' -> 'CH-01', '2' -> 'CH-02'
  const resolvedChamberId =
    chamberParam === '1' ? 'CH-01' : chamberParam === '2' ? 'CH-02' : chamberParam;

  const [data, setData] = useState<ChamberLatestResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [isDegraded, setIsDegraded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const backoffRef = useRef(initialIntervalMs);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeReqIdRef = useRef(0);
  const lastFetchTimeRef = useRef<number>(0);
  const isPollingHaltedRef = useRef(false);

  // Clear pending timers and active fetch
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const fetchLatestRef = useRef<(isInitial?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    fetchLatestRef.current = async (isInitial = false) => {
      if (!resolvedChamberId || isPollingHaltedRef.current) return;

    if (isInitial) {
      setData(null);
      setRequestState('loading');
      setIsDegraded(false);
      setError(null);
    }

    // Increment request ID to guard against out-of-order race conditions
    const reqId = ++activeReqIdRef.current;
    cleanup();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Timeout signal
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    if (!isInitial) {
      setRequestState((prev) => (prev === 'idle' ? 'loading' : prev));
    }

    try {
      const res = await apiFetch(
        `/api/v1/chambers/${encodeURIComponent(resolvedChamberId)}/latest`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      // Discard if chamber changed or a newer request was dispatched
      if (reqId !== activeReqIdRef.current) {
        return;
      }

      if (res.status === 401) {
        // Halting poller on 401 Unauthorized
        isPollingHaltedRef.current = true;
        setRequestState('error');
        setError(new Error('Unauthorized session. Please login.'));
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        throw new Error(errMsg);
      }

      const json = await res.json();

      // Guard check again
      if (reqId !== activeReqIdRef.current) return;

      setData(json.data);
      setRequestState('success');
      setIsDegraded(false);
      setError(null);
      lastFetchTimeRef.current = Date.now();

      // Reset exponential backoff on success
      backoffRef.current = initialIntervalMs;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      // Ignore aborted requests from navigation / unmount
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      if (reqId !== activeReqIdRef.current) return;

      const errorObj = err instanceof Error ? err : new Error('Network error');
      setError(errorObj);
      setRequestState('error');

      // If we previously had data, retain it but mark degraded/stale
      setData((prev) => {
        if (prev) setIsDegraded(true);
        return prev;
      });

      // Exponential backoff up to maxIntervalMs
      backoffRef.current = Math.min(backoffRef.current * 2, maxIntervalMs);
    } finally {
      // Schedule next polling run if not halted
      if (!isPollingHaltedRef.current && reqId === activeReqIdRef.current) {
        const isHidden = typeof document !== 'undefined' && document.hidden;
        // If tab is hidden, slow down polling to max interval (or 30s)
        const nextDelay = isHidden ? Math.max(backoffRef.current, 30000) : backoffRef.current;

        timerRef.current = setTimeout(() => {
          void fetchLatestRef.current(false);
        }, nextDelay);
      }
    }
    };
  });

  const refetch = useCallback(async () => {
    await fetchLatestRef.current(false);
  }, []);

  // Handle visibility change (tab hidden vs active)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: let the scheduled timer run or delay next execution
      } else {
        // Tab active again: if stale (> 5s since last fetch), poll immediately
        const elapsed = Date.now() - lastFetchTimeRef.current;
        if (elapsed >= 5000 && !isPollingHaltedRef.current) {
          void fetchLatestRef.current(false);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Main lifecycle for chamber param changes
  useEffect(() => {
    isPollingHaltedRef.current = false;
    backoffRef.current = initialIntervalMs;

    if (resolvedChamberId) {
      void fetchLatestRef.current(true);
    }

    return () => {
      cleanup();
    };
  }, [resolvedChamberId, initialIntervalMs, cleanup]);

  return {
    data,
    requestState,
    isDegraded,
    error,
    resolvedChamberId,
    refetch,
  };
}
