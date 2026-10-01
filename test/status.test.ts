/**
 * Pengujian kontrak status, heartbeat, Last Will (LWT), dan retained snapshot
 * Sesuai KF-STS-001, T-STS-02, dan docs/esniffer/03-technical-design.md Section 6.4
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateStatusPayload,
  evaluateConnectionStatus,
  StatusValidationError,
} from '../shared/status.ts';
import { type StatusPayloadInput } from '../shared/types.ts';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture<T>(filename: string): T {
  const content = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(content) as T;
}

test('Status: Menerima payload connect valid', () => {
  const connect = loadFixture<StatusPayloadInput>('status-connect.json');
  const validated = validateStatusPayload(connect, 'esp32-001');
  assert.strictEqual(validated.event_type, 'connect');
  assert.strictEqual(validated.state, 'online');
  assert.strictEqual(validated.connection_sequence, 1);
});

test('Status: Menerima payload heartbeat valid', () => {
  const heartbeat = loadFixture<StatusPayloadInput>('status-heartbeat.json');
  const validated = validateStatusPayload(heartbeat, 'esp32-001');
  assert.strictEqual(validated.event_type, 'heartbeat');
  assert.strictEqual(validated.status_sequence, 15);
  assert.ok(validated.time_reference);
});

test('Status: Menerima payload Last Will (LWT) valid', () => {
  const lwt = loadFixture<StatusPayloadInput>('status-lwt.json');
  const validated = validateStatusPayload(lwt, 'esp32-001');
  assert.strictEqual(validated.event_type, 'will');
  assert.strictEqual(validated.state, 'offline');
  assert.strictEqual(validated.event_at, null);
});

test('Status: Menolak event_type will jika state bukan offline', () => {
  const lwt = loadFixture<StatusPayloadInput>('status-lwt.json');
  const invalidWill = JSON.parse(JSON.stringify(lwt));
  invalidWill.state = 'online';

  assert.throws(
    () => validateStatusPayload(invalidWill, 'esp32-001'),
    (err: Error) =>
      err instanceof StatusValidationError &&
      err.message.includes('must have state "offline"')
  );
});

test('T-STS-02: Retained online saat restart worker menghasilkan connectionState UNKNOWN dan TIDAK memajukan last_seen_at', () => {
  const heartbeat = loadFixture<StatusPayloadInput>('status-heartbeat.json');

  // Broker mereplay paket retained saat subscriber baru menyambung
  const transition = evaluateConnectionStatus(heartbeat, true /* isRetained */);

  assert.strictEqual(transition.newState, 'UNKNOWN');
  assert.strictEqual(transition.newEvidence, 'RETAINED_SNAPSHOT');
  assert.strictEqual(transition.shouldUpdateLastSeen, false);
});

test('Status: Live traffic menghasilkan ONLINE dan memajukan last_seen_at', () => {
  const heartbeat = loadFixture<StatusPayloadInput>('status-heartbeat.json');

  // Live traffic (isRetained = false)
  const transition = evaluateConnectionStatus(heartbeat, false);

  assert.strictEqual(transition.newState, 'ONLINE');
  assert.strictEqual(transition.newEvidence, 'LIVE_STATUS');
  assert.strictEqual(transition.shouldUpdateLastSeen, true);
});

test('Status: Live Last Will (LWT) menghasilkan OFFLINE dengan evidence LWT', () => {
  const lwt = loadFixture<StatusPayloadInput>('status-lwt.json');

  const transition = evaluateConnectionStatus(lwt, false);

  assert.strictEqual(transition.newState, 'OFFLINE');
  assert.strictEqual(transition.newEvidence, 'LWT');
  assert.strictEqual(transition.shouldUpdateLastSeen, false);
});
