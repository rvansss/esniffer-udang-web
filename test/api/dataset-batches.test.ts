import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { GET as listBatches, POST as createBatch } from '../../app/api/v1/batches/route.ts';
import { POST as createGroups } from '../../app/api/v1/batches/[batchId]/groups/route.ts';
import { POST as lockBatch } from '../../app/api/v1/batches/[batchId]/lock/route.ts';
import { POST as uploadPhotos } from '../../app/api/v1/batches/[batchId]/photos/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const DAY = '2099-02-02';
const PROCURED = `${DAY}T00:00:00.000Z`; // 07:00 WIB — dalam jendela 06:00–08:00

function postHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    Origin: 'http://localhost:3000',
    Host: 'localhost:3000',
    'Content-Type': 'application/json',
  };
}

function batchBody(overrides: Record<string, unknown> = {}) {
  return {
    procuredAtUtc: PROCURED,
    marketSource: 'Pasar Bebas Ketik Manual',
    sourceType: 'market',
    shrimpCount: 12,
    sizeGrade: 'uniform_medium',
    totalWeightG: 485.5,
    initialCondition: 'fresh_dead',
    initialTempC: 8.2,
    departedAtUtc: `${DAY}T00:15:00.000Z`,
    arrivedAtUtc: `${DAY}T02:00:00.000Z`,
    coolerTempMinC: 1.2,
    coolerTempMaxC: 3.8,
    tempStartC: 3.0,
    tempEndC: 3.5,
    ...overrides,
  };
}

function groupsBody() {
  return {
    groups: [
      {
        storageCondition: 'room_temp',
        labTempC: 6.5,
        visualCheck: 'normal',
        labWeightG: 482.0,
        sampleShrimpCount: 4,
        sampleWeightG: 162.3,
      },
      {
        storageCondition: 'cold',
        labTempC: 5.0,
        visualCheck: 'normal',
        labWeightG: 480.0,
        sampleShrimpCount: 4,
        sampleWeightG: 160.0,
      },
    ],
  };
}

describe('HTTP API v1: Dataset Batches, Groups, Sessions & Lock (Fase 3)', () => {
  const tag = Date.now().toString().slice(-6);
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let batchId = '';
  let groupSr = '';
  let sessionH0 = '';
  let sessionH6 = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `dataset-admin-${tag}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `dataset-viewer-${tag}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const adminSess = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(adminSess.rawToken, adminSess.expiresAt).split(';')[0];
    const viewerSess = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(viewerSess.rawToken, viewerSess.expiresAt).split(';')[0];
  });

  after(async () => {
    await prisma.measurementSession.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    for (const suffix of ['BT-20990202-01', 'BT-20990202-02']) {
      await rm(path.join(process.cwd(), 'public', 'uploads', suffix), { recursive: true, force: true });
    }
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. POST /batches valid → 201 dengan batch_id otomatis', async () => {
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody()),
      })
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.match(body.data.batchId, /^BT-20990202-\d{2}$/);
    assert.strictEqual(body.data.sourceType, 'market');
    assert.deepStrictEqual(body.data.photoUrls, []);
    assert.strictEqual(body.data.lockedAt, null);
    batchId = body.data.batchId;
  });

  it('2. POST /batches menolak shrimpCount < 10 (422)', async () => {
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ shrimpCount: 5 })),
      })
    );
    assert.strictEqual(res.status, 422);
  });

  it('3. POST /batches menolak urutan transport terbalik (422)', async () => {
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(
          batchBody({ departedAtUtc: `${DAY}T05:00:00.000Z`, arrivedAtUtc: `${DAY}T02:00:00.000Z` })
        ),
      })
    );
    assert.strictEqual(res.status, 422);
  });

  it('4. POST /batches menolak cold-chain >3 jam tanpa deviasi (422) dan menerima dengan deviasi', async () => {
    const late = batchBody({ arrivedAtUtc: `${DAY}T04:00:00.000Z` });
    const refused = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(late),
      })
    );
    assert.strictEqual(refused.status, 422);

    const accepted = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ ...late, deviationAcknowledged: true }),
      })
    );
    assert.strictEqual(accepted.status, 201);
  });

  it('5. POST /batches menolak di luar jendela 06:00–08:00 WIB dan field hilang (422)', async () => {
    const outside = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ procuredAtUtc: `${DAY}T02:00:00.000Z` })), // 09:00 WIB
      })
    );
    assert.strictEqual(outside.status, 422);

    const missing = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ marketSource: 'x' }),
      })
    );
    assert.strictEqual(missing.status, 422);
  });

  it('6. POST /batches tanpa auth 401, VIEWER 403', async () => {
    const anon = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchBody()),
      })
    );
    assert.strictEqual(anon.status, 401);

    const viewer = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(viewerCookie),
        body: JSON.stringify(batchBody()),
      })
    );
    assert.strictEqual(viewer.status, 403);
  });

  it('7. GET /batches VIEWER → 200 dan filter locked', async () => {
    const res = await listBatches(
      new Request('http://localhost:3000/api/v1/batches?limit=100', {
        headers: { Cookie: viewerCookie },
      })
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.some((b: { batchId: string }) => b.batchId === batchId));

    const locked = await listBatches(
      new Request('http://localhost:3000/api/v1/batches?locked=true', {
        headers: { Cookie: viewerCookie },
      })
    );
    assert.strictEqual((await locked.json()).data.length, 0);

    const unlocked = await listBatches(
      new Request('http://localhost:3000/api/v1/batches?locked=false&limit=100', {
        headers: { Cookie: viewerCookie },
      })
    );
    assert.ok((await unlocked.json()).data.some((b: { batchId: string }) => b.batchId === batchId));
  });

  it('8. POST /batches/:id/groups membuat 2 grup otomatis (201), duplikat 409', async () => {
    const res = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(groupsBody()),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.length, 2);
    assert.strictEqual(body.data[0].groupId, `${batchId}-SR`);
    assert.strictEqual(body.data[0].storageCondition, 'room_temp');
    assert.strictEqual(body.data[0].targetTempC, 25);
    assert.strictEqual(body.data[1].groupId, `${batchId}-SD`);
    groupSr = body.data[0].groupId;

    const dup = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(groupsBody()),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(dup.status, 409);
  });

  it('9. POST groups menolak sampleShrimpCount di luar 3–5 (422)', async () => {
    const res = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          groups: [{ ...groupsBody().groups[0], storageCondition: 'cold', sampleShrimpCount: 9 }],
        }),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 422);
  });

  it('10. POST sessions menolak tanpa warmup (422), H0 valid (201)', async () => {
    const noWarmup = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H0', warmupDone: false }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(noWarmup.status, 422);

    const res = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H0', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.match(body.data.sessionId, /^SES-\d{8}-\d{2}-H0-SR$/);
    assert.strictEqual(body.data.elapsedHours, 0);
    sessionH0 = body.data.sessionId;
  });

  it('11. POST sessions menolak duplikat/mundur (409) dan input invalid (422/404)', async () => {
    const dup = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H0', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(dup.status, 409);

    const h6 = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H6', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(h6.status, 201);
    sessionH6 = (await h6.json()).data.sessionId;

    const backward = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H0', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(backward.status, 409);

    const badCode = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'KEMARIN', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(badCode.status, 422);

    const badUuid = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H12', warmupDone: true, chamberId: 'bukan-uuid' }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(badUuid.status, 422);

    const unknownChamber = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          timepointCode: 'H12',
          warmupDone: true,
          chamberId: '00000000-0000-4000-8000-000000000000',
        }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(unknownChamber.status, 404);
  });

  it('12. POST sessions/:id/complete tanpa cleaning 422, valid 200, duplikat 409', async () => {
    const noCleaning = await completeSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ cleaningDone: false }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(noCleaning.status, 422);

    const res = await completeSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ cleaningDone: true, baselineMq137: 0.412 }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'complete');
    assert.strictEqual(body.data.baselineMq137, 0.412);

    const again = await completeSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ cleaningDone: true }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(again.status, 409);
  });

  it('13. POST batches/:id/lock menolak saat sesi OPEN, mengunci setelah complete', async () => {
    const early = await lockBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/lock`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(early.status, 422);

    await completeSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH6}/complete`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ cleaningDone: true }),
      }),
      { params: Promise.resolve({ sessionId: sessionH6 }) }
    );

    const photoForm = new FormData();
    photoForm.append('photos', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'awal.jpg', { type: 'image/jpeg' }));
    const photoReq = new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: photoForm,
    });
    assert.strictEqual(
      (await uploadPhotos(photoReq, { params: Promise.resolve({ batchId }) })).status,
      201
    );

    const res = await lockBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/lock`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).data.lockedAt);

    const relock = await lockBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/lock`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(relock.status, 409);

    const afterLock = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H12', warmupDone: true }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(afterLock.status, 409);
  });

  it('14. VIEWER ditolak untuk semua mutasi dataset (403)', async () => {
    for (const [handler, url, params, payload] of [
      [createGroups, `http://localhost:3000/api/v1/batches/${batchId}/groups`, { batchId }, groupsBody()],
      [createSession, `http://localhost:3000/api/v1/groups/${groupSr}/sessions`, { groupId: groupSr }, { timepointCode: 'H12', warmupDone: true }],
      [completeSession, `http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, { sessionId: sessionH0 }, { cleaningDone: true }],
      [lockBatch, `http://localhost:3000/api/v1/batches/${batchId}/lock`, { batchId }, {}],
    ] as const) {
      const res = await (handler as (req: Request, ctx: { params: Promise<object> }) => Promise<Response>)(
        new Request(url, {
          method: 'POST',
          headers: postHeaders(viewerCookie),
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve(params) }
      );
      assert.strictEqual(res.status, 403);
    }
  });
});
