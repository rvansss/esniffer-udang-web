import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { backfillSessionReadings } from '../../lib/dataset/backfill.ts';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
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
    sourceType: 'market', shrimpType: 'vaname',
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
  let chamberId = '';
  let deviceId = '';
  let assignmentId = '';

  before(async () => {
    chamberId = (await prisma.chamber.create({ data: { code: `BATCH-${tag}`, name: 'Batch test' } })).id;
    deviceId = (await prisma.device.create({ data: { mqttDeviceId: `batch-${tag}`, name: 'Batch test' } })).id;
    assignmentId = (await prisma.deviceAssignment.create({ data: { chamberId, deviceId, activeFrom: new Date('2000-01-01T00:00:00Z') } })).id;
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
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: { startsWith: 'BT-20990202' } } });
    for (const suffix of ['BT-20990202-01', 'BT-20990202-02']) {
      await rm(path.join(process.cwd(), 'public', 'uploads', suffix), { recursive: true, force: true });
    }
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.delete({ where: { id: deviceId } });
    await prisma.chamber.delete({ where: { id: chamberId } });
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

  it('2. POST /batches menerima jumlah udang kecil dan menolak yang tidak masuk akal (422)', async () => {
    // Dulu shrimpCount < 10 ditolak; kini minimal 1 ekor (tanpa batas atas).
    for (const shrimpCount of [1, 5, 40]) {
      const accepted = await createBatch(
        new Request('http://localhost:3000/api/v1/batches', {
          method: 'POST',
          headers: postHeaders(adminCookie),
          body: JSON.stringify(batchBody({ shrimpCount })),
        })
      );
      assert.strictEqual(accepted.status, 201, `shrimpCount ${shrimpCount} harus diterima`);
      assert.strictEqual((await accepted.json()).data.shrimpCount, shrimpCount);
    }

    for (const shrimpCount of [0, -3, 12.5, 'dua belas', 1e30]) {
      const res = await createBatch(
        new Request('http://localhost:3000/api/v1/batches', {
          method: 'POST',
          headers: postHeaders(adminCookie),
          body: JSON.stringify(batchBody({ shrimpCount })),
        })
      );
      assert.strictEqual(res.status, 422, `shrimpCount ${JSON.stringify(shrimpCount)} harus ditolak`);
    }
  });

  it('2a. POST /batches menerima suhu cool box di luar 0–4 °C (warning hanya di UI)', async () => {
    const extreme = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(
          batchBody({ coolerTempDepartureC: -3.5, coolerTempMarketC: 12.75, coolerTempLabC: 0.25 })
        ),
      })
    );
    assert.strictEqual(extreme.status, 201);
    const body = await extreme.json();
    assert.strictEqual(body.data.coolerTempDepartureC, -3.5);
    assert.strictEqual(body.data.coolerTempMarketC, 12.75);
    assert.strictEqual(body.data.coolerTempLabC, 0.25);
    await prisma.collectionBatch.delete({ where: { batchId: body.data.batchId } });

    // Kapasitas kolom DECIMAL(5,2) tetap dijaga: 422, bukan 500.
    const overflow = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ coolerTempLabC: 1000 })),
      })
    );
    assert.strictEqual(overflow.status, 422);
  });

  it('2b. POST /batches menurunkan sizeGrade kiriman dan menerima panjang udang bebas rentang', async () => {
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

    // Panjang udang bebas rentang (desimal diterima); bukan angka/overflow ditolak.
    for (const shrimpLengthCm of [0.5, 51, 2.75, 120]) {
      const res = await createBatch(
        new Request('http://localhost:3000/api/v1/batches', {
          method: 'POST',
          headers: postHeaders(adminCookie),
          body: JSON.stringify(batchBody({ shrimpLengthCm })),
        })
      );
      assert.strictEqual(res.status, 201, `shrimpLengthCm ${shrimpLengthCm} harus diterima`);
    }
    for (const shrimpLengthCm of [1000, '', 'dua belas']) {
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

  it('2d. POST /batches menyimpan jumlah udang per sesi terpisah SR & SD', async () => {
    const post = (grouping: unknown) => createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify(batchBody({ grouping })),
      })
    );
    const counts = async (batchIdToRead: string) => {
      const detail = await getBatchDetail(
        new Request(`http://localhost:3000/api/v1/batches/${batchIdToRead}`, { headers: postHeaders(adminCookie) }),
        { params: Promise.resolve({ batchId: batchIdToRead }) }
      );
      const body = await detail.json();
      return Object.fromEntries(
        body.data.sampleGroups.map((g: { storageCondition: string; sampleShrimpCount: number }) => [
          g.storageCondition,
          g.sampleShrimpCount,
        ])
      );
    };

    // Wizard mengirim dua hitungan; masing-masing grup mendapat nilainya sendiri.
    const perStorage = await post({
      visualCheck: 'normal',
      sampleShrimpCount: 4,
      sampleShrimpCountRoomTemp: 4,
      sampleShrimpCountCold: 3,
    });
    assert.strictEqual(perStorage.status, 201);
    assert.deepStrictEqual(await counts((await perStorage.json()).data.batchId), { room_temp: 4, cold: 3 });

    // Klien lama (satu nilai) tetap mendapat dua grup bernilai sama.
    const legacy = await post({ visualCheck: 'normal', sampleShrimpCount: 5 });
    assert.strictEqual(legacy.status, 201);
    assert.deepStrictEqual(await counts((await legacy.json()).data.batchId), { room_temp: 5, cold: 5 });

    // Nilai per suhu tanpa batas domain; hanya bilangan bulat ≥ 1 yang wajib.
    const outOfGuide = await post({ visualCheck: 'normal', sampleShrimpCount: 4, sampleShrimpCountCold: 6 });
    assert.strictEqual(outOfGuide.status, 201);
    const invalid = await post({ visualCheck: 'normal', sampleShrimpCount: 4, sampleShrimpCountCold: 0 });
    assert.strictEqual(invalid.status, 422);
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

  it('9. POST groups menerima jumlah sampel bebas dan menolak yang bukan bilangan bulat ≥ 1 (422)', async () => {
    // Dulu 3–5 ekor; kini 9 pun sah (kelompok dingin sudah ada → 409, bukan 422).
    const accepted = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          groups: [{ ...groupsBody().groups[0], storageCondition: 'cold', sampleShrimpCount: 9 }],
        }),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(accepted.status, 409);

    const res = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: postHeaders(adminCookie),
        body: JSON.stringify({
          groups: [{ ...groupsBody().groups[0], storageCondition: 'cold', sampleShrimpCount: 0 }],
        }),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 422);
  });

  const sessionRequest = (code: string, groupId = groupSr, extra: Record<string, unknown> = {}) => createSession(new Request(`http://localhost:3000/api/v1/groups/${groupId}/sessions`, {
    method: 'POST', headers: postHeaders(adminCookie), body: JSON.stringify({
      timepointCode: code, chamberId, warmupDone: true, shrimpTempC: 5, shrimpWeightG: 450,
      startedAtUtc: `${DAY}T${code === 'H6' ? '12' : '06'}:00:00.000Z`, ...extra,
    }),
  }), { params: Promise.resolve({ groupId }) });
  const completeRequest = (sessionId: string, body: unknown) => completeSession(new Request(`http://localhost:3000/api/v1/sessions/${sessionId}/complete`, { method: 'POST', headers: postHeaders(adminCookie), body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId }) });
  const patch = (body: unknown, groupId = groupSr, cookie = adminCookie) => patchGroup(new Request(`http://localhost:3000/api/v1/groups/${groupId}`, { method: 'PATCH', headers: postHeaders(cookie), body: JSON.stringify(body) }), { params: Promise.resolve({ groupId }) });

  it('10. sessions require warmup, chamber, and independent measurements', async () => {
    assert.strictEqual((await sessionRequest('H0', groupSr, { warmupDone: false })).status, 422);
    assert.strictEqual((await sessionRequest('H0', groupSr, { chamberId: null })).status, 422);
    assert.strictEqual((await sessionRequest('H0', groupSr, { shrimpWeightG: undefined })).status, 422);
    const result = await sessionRequest('H0'); assert.strictEqual(result.status, 201);
    const body = (await result.json()).data; sessionH0 = body.sessionId;
    assert.strictEqual(body.elapsedHours, 0); assert.strictEqual(body.shrimpWeightG, 450);
  });
  it('11. timepoints must advance and UUIDs must reference a real chamber', async () => {
    assert.strictEqual((await sessionRequest('H0')).status, 409);
    const next = await sessionRequest('H6'); assert.strictEqual(next.status, 201); sessionH6 = (await next.json()).data.sessionId;
    assert.strictEqual((await sessionRequest('H0')).status, 409);
    assert.strictEqual((await sessionRequest('KEMARIN')).status, 422);
    assert.strictEqual((await sessionRequest('H12', groupSr, { chamberId: 'invalid' })).status, 422);
    assert.strictEqual((await sessionRequest('H12', groupSr, { chamberId: randomUUID() })).status, 404);
  });
  it('12. completion requires cleaning and an empty acquisition remains incomplete', async () => {
    assert.strictEqual((await completeRequest(sessionH0, { cleaningDone: false })).status, 422);
    const result = await completeRequest(sessionH0, { cleaningDone: true, endedAtUtc: `${DAY}T06:15:00.000Z`, baselineMq137: 0.412 });
    assert.strictEqual(result.status, 200);
    const data = (await result.json()).data;
    assert.strictEqual(data.status, 'incomplete'); assert.strictEqual(data.baselineMq137, null);
    assert.strictEqual((await completeRequest(sessionH0, { cleaningDone: true })).status, 409);
  });
  it('12b. group edits reject plain fridge and validate ranges', async () => {
    const result = await patch({ labTempC: 7.7 }); assert.strictEqual(result.status, 200); assert.strictEqual((await result.json()).data.labTempC, 7.7);
    assert.strictEqual((await patch({ coldStorageMode: 'plain_fridge' }, `${batchId}-SD`)).status, 422);
    assert.strictEqual((await patch({ coldStorageMode: 'chamber' }, `${batchId}-SD`)).status, 200);
    assert.strictEqual((await patch({})).status, 422); assert.strictEqual((await patch({ labTempC: 99 })).status, 422);
    assert.strictEqual((await patch({ labTempC: 7 }, 'BT-XXXX-XX')).status, 404);
  });
  it('12c. new cold groups reject plain fridge', async () => {
    const created = await createBatch(new Request('http://localhost:3000/api/v1/batches', { method: 'POST', headers: postHeaders(adminCookie), body: JSON.stringify(batchBody()) }));
    const newBatch = (await created.json()).data.batchId;
    const result = await createGroups(new Request(`http://localhost:3000/api/v1/batches/${newBatch}/groups`, { method: 'POST', headers: postHeaders(adminCookie), body: JSON.stringify({ groups: [{ ...groupsBody().groups[1], coldStorageMode: 'plain_fridge' }] }) }), { params: Promise.resolve({ batchId: newBatch }) });
    assert.strictEqual(result.status, 422);
  });
  it('12d. both groups use chamber assignments; saved chamber does not rewrite old sessions', async () => {
    const group = `${batchId}-SD`;
    const alternative = await prisma.chamber.create({ data: { code: `OTHER-${tag}`, name: 'Other chamber' } });
    let createdId: string | undefined;
    try {
      await prisma.sampleGroup.update({ where: { groupId: group }, data: { coldStorageMode: 'PLAIN_FRIDGE', chamberId: null } });
      assert.strictEqual((await patch({ chamberId }, group)).status, 422);
      assert.strictEqual((await patch({ chamberId, coldStorageMode: 'chamber' }, group)).status, 200);
      const created = await sessionRequest('H0', group, { chamberId: undefined, startedAtUtc: `${DAY}T09:00:00.000Z` });
      assert.strictEqual(created.status, 201); const data = (await created.json()).data; createdId = data.sessionId;
      assert.strictEqual(data.chamberId, chamberId);
      assert.strictEqual((await patch({ chamberId: alternative.id }, group)).status, 200);
      assert.strictEqual((await prisma.measurementSession.findUniqueOrThrow({ where: { sessionId: createdId } })).chamberId, chamberId);
      assert.strictEqual((await patch({ chamberId }, group, viewerCookie)).status, 403);
    } finally {
      if (createdId) await prisma.measurementSession.deleteMany({ where: { sessionId: createdId } });
      await prisma.sampleGroup.update({ where: { groupId: group }, data: { chamberId: null, coldStorageMode: 'CHAMBER' } });
      await prisma.chamber.delete({ where: { id: alternative.id } });
    }
  });
  it('13. locking rejects unfinished sessions and freezes batch, groups, and session changes', async () => {
    const lock = () => lockBatch(new Request(`http://localhost:3000/api/v1/batches/${batchId}/lock`, { method: 'POST', headers: postHeaders(adminCookie) }), { params: Promise.resolve({ batchId }) });
    assert.strictEqual((await lock()).status, 422);
    for (const [sessionId, hour] of [[sessionH0, '06'], [sessionH6, '12']]) {
      await prisma.sensorReading.create({ data: { deviceId, chamberId, assignmentId, historySequence: await allocateHistorySequence(), messageId: randomUUID(), payloadSha256: 'a'.repeat(64), bootId: randomUUID(), sequence: 1n, measuredAt: new Date(`${DAY}T${hour}:03:00.000Z`), measurementTimeQuality: 'SYNCED', temperatureC: 25, temperatureQuality: 'OK', humidityPercent: 60, humidityQuality: 'OK', mq137Raw: 10, mq137Quality: 'OK', mq136Raw: 20, mq136Quality: 'OK', mq4Raw: 30, mq4Quality: 'OK', rawPayload: {} } });
      if (sessionId === sessionH0) await backfillSessionReadings((await prisma.measurementSession.findUniqueOrThrow({ where: { sessionId } })).id);
      else assert.strictEqual((await completeRequest(sessionId, { cleaningDone: true, endedAtUtc: `${DAY}T12:15:00.000Z` })).status, 200);
    }
    await prisma.batchPhoto.create({ data: { batchId, url: `uploads/${batchId}/lock.jpg`, caption: 'Lock fixture', sortOrder: 0 } });
    const result = await lock(); assert.strictEqual(result.status, 200); assert.ok((await result.json()).data.lockedAt);
    assert.strictEqual((await lock()).status, 409);
    assert.strictEqual((await sessionRequest('H12')).status, 409);
    assert.strictEqual((await patch({ labTempC: 7 })).status, 409);
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
