import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkerConfig } from '../worker/config.ts';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  getAuthSecret,
} from '../lib/auth/session.ts';
import { getCursorSigningSecret } from '../shared/pagination.ts';
import { GET as liveHealth } from '../app/api/health/live/route.ts';
import { GET as readyHealth } from '../app/api/health/ready/route.ts';
import { closeDb, resolveDatabaseUrl } from '../lib/db/client.ts';

after(async () => {
  await closeDb();
});

async function withProductionEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>
): Promise<T> {
  const keys = ['NODE_ENV', 'AUTH_SECRET', 'CURSOR_SIGNING_SECRET', 'APP_BASE_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Production worker menolak fallback credential dan MQTT plaintext', () => {
  assert.throws(
    () => resolveDatabaseUrl({ NODE_ENV: 'production' }),
    /DATABASE_URL/
  );
  assert.throws(
    () => resolveWorkerConfig({}, { NODE_ENV: 'production' }),
    /Missing mandatory production environment/
  );

  assert.throws(
    () => resolveWorkerConfig({}, {
      NODE_ENV: 'production',
      MQTT_URL: 'mqtt://broker:1883',
      MQTT_CLIENT_ID: 'esniffer-ingest-v1',
      MQTT_USERNAME: 'worker-runtime',
      MQTT_PASSWORD: 'not-a-default-password',
      MQTT_CA_FILE: '/run/secrets/mqtt-ca.crt',
    }),
    /must use mqtts:\/\//
  );

  assert.throws(
    () => resolveWorkerConfig({
      mqttUrl: 'mqtts://worker:secret@broker:8883',
      clientId: 'esniffer-ingest-v1',
      username: 'worker-runtime',
      password: 'not-a-default-password',
      caFile: '/run/secrets/mqtt-ca.crt',
    }, { NODE_ENV: 'production' }),
    /must not contain credentials/
  );
});

test('Production secret wajib tersedia dan minimum 32 karakter', async () => {
  await withProductionEnv({ AUTH_SECRET: undefined }, () => {
    assert.throws(() => getAuthSecret(), /Missing mandatory environment variable/);
  });
  await withProductionEnv({ AUTH_SECRET: 'too-short' }, () => {
    assert.throws(() => getAuthSecret(), /at least 32 characters/);
  });
  await withProductionEnv({ CURSOR_SIGNING_SECRET: undefined }, () => {
    assert.throws(() => getCursorSigningSecret(), /Missing mandatory environment variable/);
  });
  await withProductionEnv({ CURSOR_SIGNING_SECRET: 'too-short' }, () => {
    assert.throws(() => getCursorSigningSecret(), /at least 32 characters/);
  });
});

test('Cookie production tetap Secure, HttpOnly, SameSite=Lax dan clear-cookie identik', async () => {
  await withProductionEnv({}, () => {
    const cookie = buildSessionCookie('opaque-token', new Date(Date.now() + 60_000));
    const clearCookie = buildClearSessionCookie();
    for (const header of [cookie, clearCookie]) {
      assert.match(header, /; Secure/);
      assert.match(header, /; HttpOnly/);
      assert.match(header, /; SameSite=Lax/);
    }
  });
});

test('Health web: liveness independen dan readiness memeriksa konfigurasi serta database', async () => {
  const live = await liveHealth();
  assert.strictEqual(live.status, 200);
  assert.match(live.headers.get('cache-control') || '', /no-store/);

  const ready = await readyHealth();
  assert.strictEqual(ready.status, 200);
  assert.match(ready.headers.get('cache-control') || '', /no-store/);

  await withProductionEnv({
    AUTH_SECRET: undefined,
    CURSOR_SIGNING_SECRET: 'cursor-secret-that-is-at-least-32-characters',
    APP_BASE_URL: 'https://dashboard.example.test',
  }, async () => {
    const stillLive = await liveHealth();
    const notReady = await readyHealth();
    assert.strictEqual(stillLive.status, 200);
    assert.strictEqual(notReady.status, 503);
  });
});
