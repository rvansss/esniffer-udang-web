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
import { PATCH as patchGroup } from '../../app/api/v1/groups/[groupId]/route.ts';
import { GET as getBatchDetail } from '../../app/api/v1/batches/[batchId]/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const DAY = '2099-02-02';
const DEPARTED = `${DAY}T00:00:00.000Z`; // 07:00 WIB — dalam jendela 05:00–08:00
const PROCURED = `${DAY}T00:30:00.000Z`; // 07:30 WIB — dalam jendela 05:00–08:00

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
    departedAtUtc: DEPARTED,
    procuredAtUtc: PROCURED,
    marketSource: 'Pasar Bebas Ketik Manual',
    sourceType: 'market',
    shrimpCount: 12,
    shrimpLengthCm: 12.5,
    totalWeightG: 485.5,
    initialCondition: 'dead',
    initialTempC: 2.5,
    arrivedAtUtc: `${DAY}T01:00:00.000Z`, // 08:00 WIB
    coolerTempDepartureC: 1.0,
    coolerTempMarketC: 1.2,
    coolerTempLabC: 3.8,
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
        labWeightBeforeG: 482.0,
        labWeightAfterG: 478.5,
        sampleShrimpCount: 4,
      },
      {
        storageCondition: 'cold',
        labTempC: 5.0,
        visualCheck: 'normal',
        labWeightBeforeG: 480.0,
        labWeightAfterG: 476.2,
        sampleShrimpCount: 4,
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
    assert.strictEqual(body.data.sizeGrade, 25); // Math.round(12 / 485.5 * 1000), dihitung server
    assert.strictEqual(body.data.departedAtUtc, DEPARTED);
    assert.strictEqual(body.data.coolerTempDepartureC, 1.0);
    assert.strictEqual(body.data.lockedAt, null);
    batchId = body.data.batchId;
  });

  it('1b. sourceType supermarket diterima dan diserialisasi lowercase (butir 6)', async () => {
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ sourceType: 'supermarket' })),
      })
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.sourceType, 'supermarket');
    await prisma.collectionBatch.delete({ where: { batchId: body.data.batchId } });

    const bad = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ sourceType: 'toko' })),
      })
    );
    assert.strictEqual(bad.status, 422);
  });

  it('1c. cooler market/lab kanonik + alias lama min/max tetap diterima (butir 7)', async () => {
    // Kiriman nama lama tetap sah: kontrak JSON versi sebelumnya tidak putus.
    const legacy = batchBody({
      coolerTempMarketC: undefined,
      coolerTempLabC: undefined,
      coolerTempMinC: 1.5,
      coolerTempMaxC: 3.2,
    });
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(legacy),
      })
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.coolerTempMarketC, 1.5);
    assert.strictEqual(body.data.coolerTempLabC, 3.2);
    assert.strictEqual(body.data.coolerTempMinC, 1.5);
    assert.strictEqual(body.data.coolerTempMaxC, 3.2);
    await prisma.collectionBatch.delete({ where: { batchId: body.data.batchId } });
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

  it('2b. POST /batches menurunkan sizeGrade kiriman dan mewajibkan shrimpLengthCm', async () => {
    // Nilai sizeGrade kiriman diabaikan: server selalu menghitung
    // jumlah ekor ÷ berat (gram) × 1000 lalu membulatkan.
    const ignored = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ sizeGrade: 9999 })),
      })
    );
    assert.strictEqual(ignored.status, 201);
    assert.strictEqual((await ignored.json()).data.sizeGrade, 25); // Math.round(12 / 485.5 * 1000)

    // Panjang wajib 1–50 cm.
    for (const shrimpLengthCm of [0, 60, '', 'dua belas']) {
      const res = await createBatch(
        new Request('http://localhost:3000/api/v1/batches', {
          method: 'POST',
          headers: postHeaders(adminCookie),
          body: JSON.stringify(batchBody({ shrimpLengthCm })),
        })
      );
      assert.strictEqual(res.status, 422, `shrimpLengthCm ${JSON.stringify(shrimpLengthCm)} harus ditolak`);
    }
  });

  it('2c. POST /batches menolak initialCondition lama fresh_dead (422)', async () => {
    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ initialCondition: 'fresh_dead' })),
      })
    );
    assert.strictEqual(res.status, 422);
    assert.strictEqual(
      (await res.json()).error.message,
      'Field "initialCondition" harus dead atau alive'
    );
  });

  it('3. POST /batches menolak tiba sebelum/saat beli dan beli sebelum/saat berangkat (422)', async () => {
    // Tiba sebelum beli → tolak 422, bukan 500.
    const early = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ arrivedAtUtc: `${DAY}T00:00:00.000Z` })), // tiba 07:00 WIB, beli 07:30
      })
    );
    assert.strictEqual(early.status, 422);
    assert.strictEqual(
      (await early.json()).error.message,
      'Tanggal dan jam tiba harus setelah tanggal dan jam beli'
    );

    // Tiba tepat saat beli → juga tolak (urutan ketat).
    const equal = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ arrivedAtUtc: PROCURED })),
      })
    );
    assert.strictEqual(equal.status, 422);

    // Beli sebelum/saat berangkat → tolak.
    const beforeDeparture = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ procuredAtUtc: DEPARTED })),
      })
    );
    assert.strictEqual(beforeDeparture.status, 422);
    assert.strictEqual(
      (await beforeDeparture.json()).error.message,
      'Tanggal dan jam berangkat harus sebelum tanggal dan jam beli'
    );
  });

  it('4. POST /batches menolak cold-chain >3 jam tanpa deviasi (422) dan menerima dengan deviasi', async () => {
    // Lintas hari: satu-satunya cara >3 jam tanpa keluar jendela 05:00–08:00.
    const late = batchBody({ arrivedAtUtc: '2099-02-03T01:00:00.000Z' }); // tiba 08:00 WIB besok
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

  it('5. POST /batches menolak di luar jendela 05:00–08:00 WIB dan field hilang (422)', async () => {
    const outside = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ procuredAtUtc: `${DAY}T02:00:00.000Z` })), // 09:00 WIB
      })
    );
    assert.strictEqual(outside.status, 422);

    const earlyDeparture = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ departedAtUtc: `${DAY}T21:30:00.000Z` })), // 04:30 WIB
      })
    );
    assert.strictEqual(earlyDeparture.status, 422);

    const lateArrival = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ arrivedAtUtc: `${DAY}T02:30:00.000Z` })), // 09:30 WIB
      })
    );
    assert.strictEqual(lateArrival.status, 422);

    // Field wajib baru: batch tanpa keberangkatan ditolak, bukan diam-diam kosong.
    const missingDeparture = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ departedAtUtc: undefined })),
      })
    );
    assert.strictEqual(missingDeparture.status, 422);

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

  it('12b. PATCH groups mengubah data grup; input invalid/kosong/room ditolak (butir 3)', async () => {
    const patch = (body: unknown, groupId = groupSr) =>
      patchGroup(
        new Request(`http://localhost:3000/api/v1/groups/${groupId}`, {
          method: 'PATCH',
          headers: postHeaders(adminCookie),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ groupId }) }
      );

    const res = await patch({ labTempC: 7.7 });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()).data;
    assert.strictEqual(data.labTempC, 7.7);
    assert.strictEqual(data.coldStorageMode, 'chamber');

    // Grup dingin: ganti mode dua arah, plain_fridge ↔ chamber (tanpa chamber).
    const toFridge = await patch({ coldStorageMode: 'plain_fridge' }, `${batchId}-SD`);
    assert.strictEqual(toFridge.status, 200);
    assert.strictEqual((await toFridge.json()).data.coldStorageMode, 'plain_fridge');
    const back = await patch({ coldStorageMode: 'chamber' }, `${batchId}-SD`);
    assert.strictEqual(back.status, 200);

    assert.strictEqual((await patch({})).status, 422); // tanpa field yang dikenal
    assert.strictEqual((await patch({ labTempC: 99 })).status, 422);
    assert.strictEqual((await patch({ coldStorageMode: 'plain_fridge' }, `${batchId}-SR`)).status, 422);
    assert.strictEqual((await patch({ labTempC: 7.7 }, 'BT-XXXX-XX')).status, 404);
  });

  it('12c. POST groups menerima coldStorageMode plain_fridge untuk grup cold (butir 1)', async () => {
    const batchRes = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody()),
      })
    );
    assert.strictEqual(batchRes.status, 201);
    const newBatch = (await batchRes.json()).data.batchId;

    const res = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${newBatch}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          groups: [{ ...groupsBody().groups[1], coldStorageMode: 'plain_fridge' }],
        }),
      }),
      { params: Promise.resolve({ batchId: newBatch }) }
    );
    assert.strictEqual(res.status, 201);
    const data = (await res.json()).data;
    assert.strictEqual(data[0].storageCondition, 'cold');
    assert.strictEqual(data[0].coldStorageMode, 'plain_fridge');

    // Mode plain_fridge pada grup ruang tidak bermakna → ditolak.
    const bad = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${newBatch}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          groups: [{ ...groupsBody().groups[0], coldStorageMode: 'plain_fridge' }],
        }),
      }),
      { params: Promise.resolve({ batchId: newBatch }) }
    );
    assert.strictEqual(bad.status, 422);
  });

  it('12d. sesi grup cold+chamber tanpa chamber ditolak, dengan chamber sah (butir 1)', async () => {
    const base = { timepointCode: 'H0', warmupDone: true };

    const without = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${batchId}-SD/sessions`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(base),
      }),
      { params: Promise.resolve({ groupId: `${batchId}-SD` }) }
    );
    assert.strictEqual(without.status, 422); // uji penerimaan butir 1

    const chamber = await prisma.chamber.create({
      data: { code: `SB-12D-${Date.now()}`, name: 'Kamar uji sesi chamber' },
    });
    try {
      const res = await createSession(
        new Request(`http://localhost:3000/api/v1/groups/${batchId}-SD/sessions`, {
          method: 'POST',
          headers: postHeaders(adminCookie),
          body: JSON.stringify({ ...base, chamberId: chamber.id }),
        }),
        { params: Promise.resolve({ groupId: `${batchId}-SD` }) }
      );
      assert.strictEqual(res.status, 201);
      const sessionId = (await res.json()).data.sessionId;
      await prisma.measurementSession.delete({ where: { sessionId } });
    } finally {
      await prisma.chamber.delete({ where: { id: chamber.id } });
    }
  });

  it('12e. Chamber dingin tersimpan, dipakai sesi baru, dan tidak mengubah chamber sesi lama', async () => {
    const coldGroup = `${batchId}-SD`;
    const patch = (body: unknown, cookie = adminCookie) => patchGroup(new Request(
      `http://localhost:3000/api/v1/groups/${coldGroup}`,
      { method: 'PATCH', headers: postHeaders(cookie), body: JSON.stringify(body) }
    ), { params: Promise.resolve({ groupId: coldGroup }) });
    const first = await prisma.chamber.create({ data: { code: `COLD-A-${Date.now()}`, name: 'Cold A' } });
    const second = await prisma.chamber.create({ data: { code: `COLD-B-${Date.now()}`, name: 'Cold B' } });
    const inactive = await prisma.chamber.create({ data: { code: `COLD-OFF-${Date.now()}`, name: 'Cold off', isActive: false } });
    let sessionId: string | undefined;
    try {
      assert.strictEqual((await patch({ coldStorageMode: 'plain_fridge', chamberId: null })).status, 200);
      assert.strictEqual((await patch({ chamberId: first.id })).status, 422);
      const assigned = await patch({ coldStorageMode: 'chamber', chamberId: first.id });
      assert.strictEqual(assigned.status, 200);
      assert.strictEqual((await assigned.json()).data.chamberId, first.id);
      const detail = await getBatchDetail(new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        headers: { Cookie: adminCookie },
      }), { params: Promise.resolve({ batchId }) });
      const saved = (await detail.json()).data.sampleGroups.find((g: { groupId: string }) => g.groupId === coldGroup);
      assert.strictEqual(saved.chamberId, first.id);
      assert.strictEqual(saved.coldStorageMode, 'chamber');

      const created = await createSession(new Request(`http://localhost:3000/api/v1/groups/${coldGroup}/sessions`, {
        method: 'POST', headers: postHeaders(adminCookie), body: JSON.stringify({ timepointCode: 'H0', warmupDone: true }),
      }), { params: Promise.resolve({ groupId: coldGroup }) });
      assert.strictEqual(created.status, 201);
      const session = (await created.json()).data;
      sessionId = session.sessionId;
      assert.strictEqual(session.chamberId, first.id, 'Sesi mengikuti chamber tersimpan tanpa dipilih ulang');
      assert.strictEqual((await patch({ chamberId: second.id })).status, 200);
      const unchanged = await prisma.measurementSession.findUniqueOrThrow({ where: { sessionId } });
      assert.strictEqual(unchanged.chamberId, first.id);

      assert.strictEqual((await patch({ coldStorageMode: 'plain_fridge' })).status, 422);
      const detached = await patch({ coldStorageMode: 'plain_fridge', chamberId: null });
      assert.strictEqual(detached.status, 200);
      assert.strictEqual((await detached.json()).data.chamberId, null);
      assert.strictEqual((await patch({ coldStorageMode: 'chamber', chamberId: 'invalid' })).status, 422);
      assert.strictEqual((await patch({ coldStorageMode: 'chamber', chamberId: '00000000-0000-4000-8000-000000000000' })).status, 404);
      assert.strictEqual((await patch({ coldStorageMode: 'chamber', chamberId: inactive.id })).status, 422);
      assert.strictEqual((await patch({ coldStorageMode: 'chamber', chamberId: first.id }, viewerCookie)).status, 403);
    } finally {
      if (sessionId) await prisma.measurementSession.deleteMany({ where: { sessionId } });
      await prisma.sampleGroup.update({ where: { groupId: coldGroup }, data: { chamberId: null, coldStorageMode: 'CHAMBER' } });
      await prisma.chamber.deleteMany({ where: { id: { in: [first.id, second.id, inactive.id] } } });
    }
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
    photoForm.append('captions', JSON.stringify(['Di pasar']));
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

    // Uji penerimaan butir 3: perubahan grup ikut dibekukan — PATCH grup
    // pada batch terkunci ditolak 409, bukan hanya mutasi POST.
    const patchLocked = await patchGroup(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}`, {
        method: 'PATCH',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({ labTempC: 7.7 }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(patchLocked.status, 409);
  });

  it('14. VIEWER ditolak untuk semua mutasi dataset (403)', async () => {
    for (const [method, handler, url, params, payload] of [
      ['POST', createGroups, `http://localhost:3000/api/v1/batches/${batchId}/groups`, { batchId }, groupsBody()],
      ['PATCH', patchGroup, `http://localhost:3000/api/v1/groups/${groupSr}`, { groupId: groupSr }, { labTempC: 7.7 }],
      ['POST', createSession, `http://localhost:3000/api/v1/groups/${groupSr}/sessions`, { groupId: groupSr }, { timepointCode: 'H12', warmupDone: true }],
      ['POST', completeSession, `http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, { sessionId: sessionH0 }, { cleaningDone: true }],
      ['POST', lockBatch, `http://localhost:3000/api/v1/batches/${batchId}/lock`, { batchId }, {}],
    ] as const) {
      const res = await (handler as (req: Request, ctx: { params: Promise<object> }) => Promise<Response>)(
        new Request(url, {
          method,
          headers: postHeaders(viewerCookie),
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve(params) }
      );
      assert.strictEqual(res.status, 403);
    }
  });
});
