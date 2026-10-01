/**
 * Konteks korelasi asynchronous untuk tracing request & pesan MQTT
 * Memakai Node.js AsyncLocalStorage bawaan
 * Sesuai docs/esniffer/03-technical-design.md Section 12.1
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  service?: 'worker' | 'web' | 'test';
  deviceId?: string;
  messageId?: string;
  readingId?: string;
  chamberId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function getLogContext(): LogContext {
  return asyncLocalStorage.getStore() ?? {};
}

export function updateLogContext(partial: Partial<LogContext>): void {
  const current = asyncLocalStorage.getStore();
  if (current) {
    Object.assign(current, partial);
  }
}
