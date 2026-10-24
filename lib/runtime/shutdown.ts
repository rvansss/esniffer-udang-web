type ShutdownSignal = 'SIGTERM' | 'SIGINT';
interface SignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener(signal: ShutdownSignal, listener: () => void): unknown;
}

/** Satu listener proses untuk seluruh koneksi panjang; tidak mengambil alih exit Next.js. */
export function createShutdownRegistry(signals: SignalSource) {
  const callbacks = new Set<() => void>();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    signals.removeListener('SIGTERM', stop);
    signals.removeListener('SIGINT', stop);
    for (const callback of callbacks) {
      try { callback(); } catch { /* Lanjut tutup koneksi lain. */ }
    }
    callbacks.clear();
  };
  signals.once('SIGTERM', stop);
  signals.once('SIGINT', stop);

  return {
    subscribe(callback: () => void): () => void {
      if (stopping) {
        callback();
        return () => {};
      }
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
  };
}

const runtime = globalThis as typeof globalThis & {
  esnifferShutdownRegistry?: ReturnType<typeof createShutdownRegistry>;
};

export function onWebShutdown(callback: () => void): () => void {
  runtime.esnifferShutdownRegistry ??= createShutdownRegistry(process);
  return runtime.esnifferShutdownRegistry.subscribe(callback);
}
