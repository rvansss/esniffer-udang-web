import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { POST as reopenSession } from '../../app/api/v1/sessions/[sessionId]/reopen/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const runId = randomUUID().slice(0, 8);
const DAY = '2099-09-09';
const PREFIX = 'BT-20990909';

function headers(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: 'http://localhost:3000', Host: 'localhost:3000', 'Content-Type': 'application/json' };
}

async function call(
  handler: (req: Request, ctx: { params: Promise<never> }) => Promise<Response>,
  url: string,
  params: never,
  payload: unknown,
  cookie: string
) {
  const res = await handler(
    new Request(url, { method: 'POST', headers: headers(cookie), body: JSON.stringify(payload) }),
    { params: Promise.resolve(params) }
  );
  return { status: res.status, body: await res.json() };
}

describe('HTTP API v1: Dataset Session Reopen (INCOMPLETE → OPEN)', () => {
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let batchId = '';
  let groupId = '';
  let sessionId = '';
  let chamberId = '';
  let deviceId = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `reopen-admin-${runId}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `reopen-viewer-${runId}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const a = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(a.rawToken, a.expiresAt).split(';')[0];
    const v = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(v.rawToken, v.expiresAt).split(';')[0];

    const device = await prisma.device.create({
      data: { mqttDeviceId: `reopen-${runId}`, name: 'Reopen Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `RE-${runId}`, name: 'Reopen Chamber' },
    });
    chamberId = chamber.id;

    const batch = await prisma.collectionBatch.create({
      data: {
        batchId: `${PREFIX}-01`,
        procuredAtUtc: new Date(`${DAY}T00:30:00.000Z`),
        marketSource: 'Pasar Reopen',
        sourceType: 'MARKET',
        shrimpCount: 12,
        // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
        sizeGrade: 30, // Math.round(12 / 400 * 1000)
        shrimpLengthCm: 12.5,
        totalWeightG: 400,
        initialCondition: 'DEAD',
        initialTempC: 8,
        departedAtUtc: new Date(`${DAY}T00:15:00.000Z`),
        arrivedAtUtc: new Date(`${DAY}T02:00:00.000Z`),
        coolerTempMinC: 1,
        coolerTempMaxC: 3,
        tempStartC: 3,
        tempEndC: 3.5,
        photoUrls: [],
        operatorId: admin.id,
      },
    });
    batchId = batch.batchId;
    const group = await prisma.sampleGroup.create({
      data: {
        groupId: `${batchId}-SR`,
        batchId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25,
        labTempC: 6,
        visualCheck: 'NORMAL',
        labWeightG: 400,
        shrimpLengthCm: 12.4,
        sampleShrimpCount: 4,
        sampleWeightG: 150,
      },
    });
    groupId = group.groupId;

    // Sesi terikat chamber+device tapi window kosong → complete jadi INCOMPLETE
    const created = await call(
      createSession,
      `http://localhost:3000/api/v1/groups/${groupId}/sessions`,
      { groupId } as never,
      {
        timepointCode: 'H0',
        warmupDone: true,
        startedAtUtc: '2099-09-09T06:00:00.000Z',
        chamberId,
        deviceId,
      },
      adminCookie
    );
    assert.strictEqual(created.status, 201);
    sessionId = created.body.data.sessionId;

    const done = await call(
      completeSession,
      `http://localhost:3000/api/v1/sessions/${sessionId}/complete`,
      { sessionId } as never,
      { cleaningDone: true, endedAtUtc: '2099-09-09T06:15:00.000Z' },
      adminCookie
    );
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.data.status, 'incomplete');
  });

  after(async () => {
    await prisma.measurementSession.deleteMany({ where: { batchId } });
    await prisma.sampleGroup.deleteMany({ where: { batchId } });
    await prisma.collectionBatch.deleteMany({ where: { batchId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. Reopen INCOMPLETE → OPEN, lalu complete ulang dan tolak reopen ganda', async () => {
    const res = await call(
      reopenSession,
      `http://localhost:3000/api/v1/sessions/${sessionId}/reopen`,
      { sessionId } as never,
      {},
      adminCookie
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'open');

    const again = await call(
      reopenSession,
      `http://localhost:3000/api/v1/sessions/${sessionId}/reopen`,
      { sessionId } as never,
      {},
      adminCookie
    );
    assert.strictEqual(again.status, 409);
  });

  it('2. Complete tanpa data kembali INCOMPLETE; VIEWER dan sesi tak dikenal ditolak', async () => {
    const done = await call(
      completeSession,
      `http://localhost:3000/api/v1/sessions/${sessionId}/complete`,
      { sessionId } as never,
      { cleaningDone: true, endedAtUtc: '2099-09-09T06:20:00.000Z' },
      adminCookie
    );
    // Window tetap kosong → kembali INCOMPLETE (belum ada reading disuntik)
    assert.strictEqual(done.body.data.status, 'incomplete');

    const completeBlocked = await call(
      reopenSession,
      `http://localhost:3000/api/v1/sessions/${sessionId}/reopen`,
      { sessionId } as never,
      {},
      viewerCookie
    );
    assert.strictEqual(completeBlocked.status, 403);

    const missing = await call(
      reopenSession,
      'http://localhost:3000/api/v1/sessions/SES-TIDAK-ADA/reopen',
      { sessionId: 'SES-TIDAK-ADA' } as never,
      {},
      adminCookie
    );
    assert.strictEqual(missing.status, 404);
  });
});
