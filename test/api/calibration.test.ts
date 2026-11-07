import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { setClockForTests } from '../../lib/runtime/clock.ts';
import { GET as getCalibration, PUT as putCalibration, DELETE as deleteCalibration } from '../../app/api/v1/groups/[groupId]/calibration/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';

/**
 * Kalibrasi dua tahap di server (Fase 0).
 *
 * Yang dijaga di sini bukan hanya CRUD, tapi dua janji yang membuat kerja
 * lintas perangkat mungkin:
 * - waktu mulai berasal dari jam server, bukan klaim klien;
 * - semua perangkat membaca baris yang sama, sehingga kalibrasi yang dimulai
 *   di HP lanjut di laptop tanpa mengulang dari nol.
 */

const tag = `calib-${Date.now()}`;

function request(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Origin', 'http://localhost:3000');
  headers.set('Host', 'localhost:3000');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(url, { ...rest, headers });
}

const ctx = (groupId: string) => ({ params: Promise.resolve({ groupId }) });

describe('Kalibrasi dua tahap: state di server, jam server, terlihat lintas perangkat', () => {
  const adminEmail = `${tag}-admin@esniffer.local`;
  const viewerEmail = `${tag}-viewer@esniffer.local`;
  const password = 'PasswordSecret123!';
  const userIds: string[] = [];
  let adminId = '';
  let adminCookie = '';
  let viewerCookie = '';
  let batchId = '';
  let groupId = '';
  let chamberId = '';
  let deviceId = '';

  // Waktu uji: T0 adalah "sekarang" versi server.
  const T0 = Date.parse('2026-11-16T01:00:00.000Z');
  const MIN = 60_000;
  let clock = T0;

  before(async () => {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: viewerEmail, passwordHash, role: 'VIEWER', isActive: true },
    });
    adminId = admin.id;
    userIds.push(admin.id, viewer.id);

    const adminSession = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(adminSession.rawToken, adminSession.expiresAt).split(';')[0];
    const viewerSession = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(viewerSession.rawToken, viewerSession.expiresAt).split(';')[0];

    // batch_id wajib berformat BT-YYYYMMDD-NN (CHECK di DB). Nomor urut dibuat
    // unik per run; bentrok dengan sisa run sebelumnya dicoba ulang.
    const stamp = '20261116';
    const seed = Date.now() % 90;
    for (let attempt = 0; attempt < 20 && batchId === ''; attempt += 1) {
      const candidate = `BT-${stamp}-${String(10 + ((seed + attempt) % 90)).padStart(2, '0')}`;
      try {
        const created = await prisma.collectionBatch.create({
          data: {
            batchId: candidate,
            procuredAtUtc: new Date('2026-11-16T00:30:00.000Z'),
            departedAtUtc: new Date('2026-11-16T00:00:00.000Z'),
            marketSource: 'Pasar Kalibrasi',
            shrimpCount: 10,
            sizeGrade: 25,
            totalWeightG: 400,
            initialCondition: 'DEAD',
            initialTempC: 8,
            arrivedAtUtc: new Date('2026-11-16T01:00:00.000Z'),
            coolerTempMarketC: 1,
            coolerTempLabC: 3,
            operatorId: admin.id,
          },
        });
        batchId = created.batchId;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    assert.ok(batchId, 'batch uji harus berhasil dibuat');

    const group = await prisma.sampleGroup.create({
      data: {
        groupId: `${batchId}-SR`,
        batchId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25,
        visualCheck: 'NORMAL',
        sampleShrimpCount: 4,
      },
    });
    groupId = group.groupId;

    const chamber = await prisma.chamber.create({ data: { code: `${tag}`, name: 'Chamber Kalibrasi' } });
    chamberId = chamber.id;
    const device = await prisma.device.create({
      data: { mqttDeviceId: `${tag}-dev`, name: 'Device Kalibrasi' },
    });
    deviceId = device.id;
    await prisma.deviceAssignment.create({
      data: {
        deviceId: device.id,
        chamberId: chamber.id,
        // Sejak jauh sebelum "sekarang" (baik jam asli maupun jam uji yang
        // dipatok), supaya penugasan alat tidak menjadi alasan penolakan.
        activeFrom: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    // Jam server dipatok supaya langkah 30 menit bisa diuji tanpa menunggu.
    setClockForTests(() => clock);
  });

  after(async () => {
    setClockForTests(null);
    await prisma.measurementSession.deleteMany({ where: { batchId } });
    await prisma.groupCalibration.deleteMany({ where: { batchId } });
    await prisma.sampleGroup.deleteMany({ where: { batchId } });
    await prisma.collectionBatch.deleteMany({ where: { batchId } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. grup tanpa kalibrasi: GET null dan sesi live ditolak 422', async () => {
    const res = await getCalibration(request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, { cookie: adminCookie }), ctx(groupId));
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data, null);

    const session = await createSession(
      request(`http://localhost:3000/api/v1/groups/${groupId}/sessions`, {
        method: 'POST',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timepointCode: 'H0', chamberId, shrimpTempC: 5, shrimpWeightG: 450 }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(session.status, 422, 'gerbang kalibrasi harus menolak sesi live');
    const body = await session.json();
    assert.match(body.error.message, /[Kk]alibrasi/);
  });

  it('2. aksi tidak dikenal dan durasi tidak sah ditolak 422', async () => {
    const bad = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lompat' }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(bad.status, 422);

    const badDuration = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', durations: [0, 5] }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(badDuration.status, 422);
  });

  it('3. mulai kalibrasi: jam server yang menetapkan waktu mulai, operator tercatat', async () => {
    clock = T0;
    const res = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': 'Budi' },
        body: JSON.stringify({ action: 'start', durations: [30, 5] }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(res.status, 200);
    // Header jam server: klien memakainya untuk menyelaraskan hitungan mundur,
    // supaya laptop dan HP tidak menghitung dari jam perangkat masing-masing.
    assert.strictEqual(res.headers.get('x-server-time'), String(T0), 'respons membawa jam server');
    const wire = (await res.json()).data;
    assert.strictEqual(wire.steps.length, 2);
    assert.strictEqual(wire.steps[0].startedAtUtc, new Date(T0).toISOString(), 'waktu mulai = jam server');
    assert.strictEqual(wire.steps[1].startedAtUtc, null);
    assert.strictEqual(wire.completedAtUtc, null);
    assert.strictEqual(wire.version, 1);
    assert.strictEqual(wire.updatedByOperator, 'Budi');
    assert.ok(wire.updatedByDevice, 'label perangkat ikut tercatat');
  });

  it('4. perangkat lain (sesi login berbeda) membaca state yang sama', async () => {
    // Sesi auth kedua = "laptop" milik operator lain di akun yang sama.
    const laptop = await createAuthSession(adminId);
    const laptopCookie = buildSessionCookie(laptop.rawToken, laptop.expiresAt).split(';')[0];
    const res = await getCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, { cookie: laptopCookie }),
      ctx(groupId)
    );
    assert.strictEqual(res.status, 200);
    const wire = (await res.json()).data;
    assert.strictEqual(wire.steps[0].startedAtUtc, new Date(T0).toISOString());
    assert.strictEqual(wire.updatedByOperator, 'Budi');
  });

  it('5. mulai ulang saat masih berjalan ditolak 409 (hitungan tidak mundur diam-diam)', async () => {
    const res = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', durations: [10, 5] }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(res.status, 409);
  });

  it('6. langkah 2 ditolak sebelum langkah 1 habis, diterima setelah 30 menit', async () => {
    clock = T0 + 29 * MIN;
    const early = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': 'Sari' },
        body: JSON.stringify({ action: 'advance', stepIndex: 1, durationMins: 5 }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(early.status, 409);
    assert.match((await early.json()).error.message, /belum selesai/);

    clock = T0 + 30 * MIN;
    const ok = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': 'Sari' },
        body: JSON.stringify({ action: 'advance', stepIndex: 1, durationMins: 5 }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(ok.status, 200);
    const wire = (await ok.json()).data;
    assert.strictEqual(wire.steps[1].startedAtUtc, new Date(T0 + 30 * MIN).toISOString());
    assert.strictEqual(wire.completedAtUtc, null, 'langkah 2 masih berjalan');
    assert.strictEqual(wire.version, 2, 'versi naik setiap perubahan');
    assert.strictEqual(wire.updatedByOperator, 'Sari', 'operator terakhir yang mengubah tercatat');
  });

  it('7. sesi live masih ditolak selama langkah 2 berjalan, diterima setelah 5 menit', async () => {
    clock = T0 + 33 * MIN;
    const tooEarly = await createSession(
      request(`http://localhost:3000/api/v1/groups/${groupId}/sessions`, {
        method: 'POST',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timepointCode: 'H0', chamberId, shrimpTempC: 5, shrimpWeightG: 450 }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(tooEarly.status, 422);

    clock = T0 + 36 * MIN;
    const created = await createSession(
      request(`http://localhost:3000/api/v1/groups/${groupId}/sessions`, {
        method: 'POST',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': 'Budi' },
        body: JSON.stringify({ timepointCode: 'H0', chamberId, shrimpTempC: 5, shrimpWeightG: 450 }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(created.status, 201);
    const data = (await created.json()).data;
    assert.strictEqual(data.warmupDone, true, 'warmupDone diturunkan dari kalibrasi server');
    assert.ok(data.calibrationCompletedAtUtc, 'bukti prasyarat tersimpan per sesi');
    assert.strictEqual(data.calibrationVersion, 2);
    assert.strictEqual(data.createdByOperator, 'Budi');

    const row = await prisma.measurementSession.findUniqueOrThrow({ where: { sessionId: data.sessionId } });
    assert.strictEqual(row.calibrationCompletedAtUtc?.toISOString(), data.calibrationCompletedAtUtc);
    assert.strictEqual(row.createdByOperator, 'Budi');
  });

  it('8. reset menghapus state di server sehingga semua perangkat terkunci lagi', async () => {
    const res = await deleteCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'DELETE',
        cookie: adminCookie,
      }),
      ctx(groupId)
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data, null);

    const after = await getCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, { cookie: adminCookie }),
      ctx(groupId)
    );
    assert.strictEqual((await after.json()).data, null);
    assert.strictEqual(await prisma.groupCalibration.count({ where: { groupId } }), 0);
  });

  it('9. VIEWER hanya boleh membaca, tidak mengubah kalibrasi (403)', async () => {
    const read = await getCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, { cookie: viewerCookie }),
      ctx(groupId)
    );
    assert.strictEqual(read.status, 200);

    const write = await putCalibration(
      request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        cookie: viewerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', durations: [30, 5] }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(write.status, 403);
  });

  it('10. grup tidak dikenal: 404, dan CSRF tetap diwajibkan pada mutasi', async () => {
    const missing = await putCalibration(
      request('http://localhost:3000/api/v1/groups/BT-XXXX-99-SR/calibration', {
        method: 'PUT',
        cookie: adminCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      }),
      ctx('BT-XXXX-99-SR')
    );
    assert.strictEqual(missing.status, 404);

    // Tanpa Origin dan tanpa CSRF: cookie-based request harus ditolak.
    const noOrigin = await putCalibration(
      new Request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
        method: 'PUT',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', durations: [30, 5] }),
      }),
      ctx(groupId)
    );
    assert.strictEqual(noOrigin.status, 403);
  });
});
