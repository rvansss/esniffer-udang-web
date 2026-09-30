import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { WorkerDaemon } from '../../worker/index.ts';

const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2';

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'pipe' });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const port = address.port;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(250);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`TLS broker did not listen on port ${port}`);
}

async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test('MQTTS: CA trust benar diterima; CA dan credential tidak valid ditolak', { timeout: 60_000 }, async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'esniffer-mqtt-tls-'));
  const containerName = `esniffer-mqtt-tls-${crypto.randomUUID().slice(0, 8)}`;
  const port = await freePort();
  let validWorker: WorkerDaemon | null = null;
  let invalidWorker: WorkerDaemon | null = null;

  try {
    run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', path.join(fixtureDir, 'ca.key'),
      '-out', path.join(fixtureDir, 'ca.crt'),
      '-subj', '/CN=eSniffer Test CA',
    ]);
    run('openssl', [
      'req', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(fixtureDir, 'server.key'),
      '-out', path.join(fixtureDir, 'server.csr'),
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);
    run('openssl', [
      'x509', '-req', '-days', '1',
      '-in', path.join(fixtureDir, 'server.csr'),
      '-CA', path.join(fixtureDir, 'ca.crt'),
      '-CAkey', path.join(fixtureDir, 'ca.key'),
      '-CAcreateserial',
      '-copy_extensions', 'copy',
      '-out', path.join(fixtureDir, 'server.crt'),
    ]);
    run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', path.join(fixtureDir, 'wrong-ca.key'),
      '-out', path.join(fixtureDir, 'wrong-ca.crt'),
      '-subj', '/CN=Untrusted Test CA',
    ]);

    run('docker', [
      'run', '--rm',
      '-v', `${fixtureDir}:/work`,
      MOSQUITTO_IMAGE,
      'mosquitto_passwd', '-b', '-c', '/work/passwords.txt',
      'worker', 'worker-tls-password',
    ]);
    const dataDir = path.join(fixtureDir, 'data');
    mkdirSync(dataDir);
    chmodSync(path.join(fixtureDir, 'server.key'), 0o644);
    chmodSync(path.join(fixtureDir, 'passwords.txt'), 0o644);
    chmodSync(dataDir, 0o777);

    const broker = spawn('docker', [
      'run', '--name', containerName,
      '-p', `127.0.0.1:${port}:8883`,
      '-v', `${path.join(process.cwd(), 'docker/mosquitto/config/mosquitto-tls.conf')}:/mosquitto/config/mosquitto.conf:ro`,
      '-v', `${path.join(process.cwd(), 'docker/mosquitto/config/acl.txt')}:/mosquitto/config/acl.txt:ro`,
      '-v', `${fixtureDir}:/mosquitto/certs:ro`,
      '-v', `${path.join(fixtureDir, 'passwords.txt')}:/mosquitto/secrets/passwords.txt:ro`,
      '-v', `${dataDir}:/mosquitto/data`,
      MOSQUITTO_IMAGE,
      'mosquitto', '-c', '/mosquitto/config/mosquitto.conf',
    ], { stdio: 'pipe' });
    broker.unref();
    await waitForPort(port);

    validWorker = new WorkerDaemon({
      mqttUrl: `mqtts://localhost:${port}`,
      clientId: `tls-valid-${Date.now()}`,
      username: 'worker',
      password: 'worker-tls-password',
      caFile: path.join(fixtureDir, 'ca.crt'),
    });
    await validWorker.start();
    const validStatus = validWorker.getStatus();
    assert.strictEqual(validStatus.mqttConnected, true);
    assert.strictEqual(validStatus.subscriptionActive, true);
    assert.strictEqual(validStatus.config.tlsEnabled, true);
    assert.ok(!('password' in validStatus.config), 'Status worker tidak boleh mengekspos credential');

    run('docker', ['stop', containerName]);
    await waitForCondition(
      () => !validWorker!.getStatus().mqttConnected,
      'worker to observe broker outage'
    );
    run('docker', ['start', containerName]);
    await waitForPort(port);
    await waitForCondition(
      () => validWorker!.getStatus().mqttConnected && validWorker!.getStatus().subscriptionActive,
      'worker TLS reconnect and subscription recovery'
    );

    await validWorker.stop();
    validWorker = null;

    invalidWorker = new WorkerDaemon({
      mqttUrl: `mqtts://localhost:${port}`,
      clientId: `tls-wrong-ca-${Date.now()}`,
      username: 'worker',
      password: 'worker-tls-password',
      caFile: path.join(fixtureDir, 'wrong-ca.crt'),
    });
    await assert.rejects(() => invalidWorker!.start(), /certificate|verify|self-signed|unable/i);
    await invalidWorker.stop();
    invalidWorker = null;

    invalidWorker = new WorkerDaemon({
      mqttUrl: `mqtts://localhost:${port}`,
      clientId: `tls-bad-auth-${Date.now()}`,
      username: 'worker',
      password: 'wrong-password',
      caFile: path.join(fixtureDir, 'ca.crt'),
    });
    await assert.rejects(() => invalidWorker!.start(), /Not authorized|bad user name or password|Connection refused/i);
    await invalidWorker.stop();
    invalidWorker = null;
  } finally {
    if (validWorker) await validWorker.stop();
    if (invalidWorker) await invalidWorker.stop();
    try {
      run('docker', ['rm', '-f', containerName]);
    } catch {
      // Container may already be gone after a startup failure.
    }
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
