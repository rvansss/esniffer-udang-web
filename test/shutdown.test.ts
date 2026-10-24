import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createShutdownRegistry } from '../lib/runtime/shutdown.ts';

test('satu listener menutup semua stream aktif saat shutdown; stream terlepas tidak dipanggil', () => {
  const signals = new EventEmitter();
  const registry = createShutdownRegistry(signals);
  let closed = 0;
  const detach = registry.subscribe(() => { throw new Error('Stream ini sudah terlepas'); });
  detach();
  for (let i = 0; i < 25; i++) registry.subscribe(() => { closed++; });
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  signals.emit('SIGTERM');
  assert.equal(closed, 25);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  signals.emit('SIGINT');
  assert.equal(closed, 25);
  registry.subscribe(() => { closed++; });
  assert.equal(closed, 26, 'Stream baru langsung ditutup setelah shutdown dimulai');
});

test('satu koneksi yang gagal ditutup tidak menghalangi koneksi lain', () => {
  const signals = new EventEmitter();
  const registry = createShutdownRegistry(signals);
  let closed = false;
  registry.subscribe(() => { throw new Error('already closed'); });
  registry.subscribe(() => { closed = true; });
  signals.emit('SIGINT');
  assert.equal(closed, true);
});
