import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createWorkerHealthServer } from '../worker/health.ts';
import { resolveWorkerConfig } from '../worker/config.ts';

test('Worker liveness tidak bergantung dependency dan readiness mengikuti MQTT+DB probe', async () => {
  let ready = false;
  const server = createWorkerHealthServer({
    isLive: () => true,
    isReady: async () => ready,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const port = (server.address() as AddressInfo).port;
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    const unavailable = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.strictEqual(live.status, 200);
    assert.strictEqual(unavailable.status, 503);
    assert.match(live.headers.get('cache-control') || '', /no-store/);

    ready = true;
    const recovered = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.strictEqual(recovered.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Worker menolak rentang reconnect tidak valid dan memakai batas production', () => {
  assert.throws(
    () => resolveWorkerConfig({ reconnectMinMs: 5000, reconnectMaxMs: 1000 }),
    /greater than or equal/
  );
  const config = resolveWorkerConfig({}, {
    NODE_ENV: 'production',
    MQTT_URL: 'mqtts://mosquitto:8883',
    MQTT_CLIENT_ID: 'worker-production',
    MQTT_USERNAME: 'worker',
    MQTT_PASSWORD: 'runtime-secret',
    MQTT_CA_FILE: '/run/secrets/ca.crt',
  });
  assert.strictEqual(config.reconnectMinMs, 1000);
  assert.strictEqual(config.reconnectMaxMs, 30000);
  assert.strictEqual(config.healthHost, '0.0.0.0');
  assert.strictEqual(config.healthPort, 8081);
});
