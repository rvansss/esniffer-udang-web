import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { GET as getChambersHandler, POST as createChamberHandler } from '../../app/api/v1/chambers/route.ts';
import { GET as getChamberHandler, PATCH as patchChamberHandler } from '../../app/api/v1/chambers/[chamberId]/route.ts';
import { GET as getDevicesHandler, POST as createDeviceHandler } from '../../app/api/v1/devices/route.ts';
import { GET as getDeviceHandler, PATCH as patchDeviceHandler } from '../../app/api/v1/devices/[deviceId]/route.ts';
import { GET as getAssignmentsHandler, POST as createAssignmentHandler } from '../../app/api/v1/assignments/route.ts';
import { POST as endAssignmentHandler } from '../../app/api/v1/assignments/[id]/end/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession, buildSessionCookie } from '../../lib/auth/session.ts';

describe('HTTP API v1: Chambers, Devices, and Assignments CRUD & Integrity Tests', () => {
  let adminCookie = '';
  let adminUserId = '';
  const testPrefix = `test-${Date.now().toString().slice(-4)}`;
  const chamberCode = `CH-${testPrefix}`;
  const deviceMqttId = `esp32-${testPrefix}`;
  let createdChamberId = '';
  let createdDeviceId = '';
  let createdAssignmentId = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${testPrefix}@esniffer.local`,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = adminUser.id;

    const { rawToken, expiresAt } = await createSession(adminUser.id);
    adminCookie = buildSessionCookie(rawToken, expiresAt).split(';')[0];
  });

  after(async () => {
    // Bersihkan assignment, device, chamber, dan user
    if (createdDeviceId) {
      await prisma.deviceAssignment.deleteMany({ where: { deviceId: createdDeviceId } });
      await prisma.device.deleteMany({ where: { id: createdDeviceId } });
    }
    if (createdChamberId) {
      await prisma.chamber.deleteMany({ where: { id: createdChamberId } });
    }
    await prisma.authSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await closeDb();
  });

  it('1. POST /api/v1/chambers membuat chamber baru (201)', async () => {
    const req = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: chamberCode,
        name: `Test Chamber ${testPrefix}`,
        description: 'Chamber untuk pengujian otomatis',
      }),
    });

    const res = await createChamberHandler(req);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.code, chamberCode);
    assert.strictEqual(body.data.isActive, true);
    createdChamberId = body.data.id;
  });

  it('2. POST /api/v1/chambers menolak kode duplikat dengan status 409 Conflict', async () => {
    const req = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: chamberCode,
        name: 'Duplicate Code Chamber',
      }),
    });

    const res = await createChamberHandler(req);
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'CONFLICT');
    assert.ok(body.error.message.includes('already exists'));
  });

  it('3. GET /api/v1/chambers mengembalikan daftar chamber dan pagination cursor', async () => {
    // Gunakan limit=100 (maksimum) agar chamber yang baru dibuat selalu masuk
    // tanpa terpotong paginasi ketika DB memiliki banyak chamber residue dari test lain.
    const req = new Request('http://localhost:3000/api/v1/chambers?limit=100', {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });

    const res = await getChambersHandler(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.some((c: { code: string }) => c.code === chamberCode),
      `Chamber ${chamberCode} harus ada dalam daftar (total: ${body.data.length})`);
    assert.ok(body.meta.limit);
  });

  it('4. GET & PATCH /api/v1/chambers/[chamberId] membaca dan memperbarui chamber', async () => {
    // Read by code
    const getReq = new Request(`http://localhost:3000/api/v1/chambers/${chamberCode}`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const getRes = await getChamberHandler(getReq, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.data.id, createdChamberId);

    // Update by UUID
    const patchReq = new Request(`http://localhost:3000/api/v1/chambers/${createdChamberId}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated Chamber Name' }),
    });
    const patchRes = await patchChamberHandler(patchReq, { params: Promise.resolve({ chamberId: createdChamberId }) });
    assert.strictEqual(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.strictEqual(patchBody.data.name, 'Updated Chamber Name');
  });

  it('5. POST /api/v1/devices membuat device baru (201) dan menolak duplikat (409)', async () => {
    const req = new Request('http://localhost:3000/api/v1/devices', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mqttDeviceId: deviceMqttId,
        name: `Test Device ${testPrefix}`,
      }),
    });

    const res = await createDeviceHandler(req);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.mqttDeviceId, deviceMqttId);
    createdDeviceId = body.data.id;

    // Retry duplikat dengan instance Request baru (body stream tidak reuse)
    const dupReq = new Request('http://localhost:3000/api/v1/devices', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mqttDeviceId: deviceMqttId,
        name: `Test Device ${testPrefix}`,
      }),
    });
    const dupRes = await createDeviceHandler(dupReq);
    assert.strictEqual(dupRes.status, 409);
  });

  it('6. GET /api/v1/devices dan GET /api/v1/devices/[deviceId] membaca status perangkat', async () => {
    // Gunakan limit=100 agar device yang baru dibuat selalu muncul
    const listReq = new Request('http://localhost:3000/api/v1/devices?limit=100', {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const listRes = await getDevicesHandler(listReq);
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(listBody.data.some((d: { mqttDeviceId: string }) => d.mqttDeviceId === deviceMqttId),
      `Device ${deviceMqttId} harus ada dalam daftar (total: ${listBody.data.length})`);

    // Get single device
    const singleReq = new Request(`http://localhost:3000/api/v1/devices/${deviceMqttId}`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const singleRes = await getDeviceHandler(singleReq, { params: Promise.resolve({ deviceId: deviceMqttId }) });
    assert.strictEqual(singleRes.status, 200);
    const singleBody = await singleRes.json();
    assert.strictEqual(singleBody.data.id, createdDeviceId);

    // Patch device
    const patchReq = new Request(`http://localhost:3000/api/v1/devices/${createdDeviceId}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated Device Name' }),
    });
    const patchRes = await patchDeviceHandler(patchReq, { params: Promise.resolve({ deviceId: createdDeviceId }) });
    assert.strictEqual(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.strictEqual(patchBody.data.name, 'Updated Device Name');
  });

  it('7. Mutasi transaksional penugasan (POST /api/v1/assignments) menghubungkan device ke chamber', async () => {
    const req = new Request('http://localhost:3000/api/v1/assignments', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: createdDeviceId,
        chamberId: createdChamberId,
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z').toISOString(),
      }),
    });

    const res = await createAssignmentHandler(req);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.deviceId, createdDeviceId);
    assert.strictEqual(body.data.chamberId, createdChamberId);
    assert.strictEqual(body.data.activeUntil, null);
    createdAssignmentId = body.data.id;

    // Verifikasi GET /api/v1/assignments
    const getAssignReq = new Request(`http://localhost:3000/api/v1/assignments?chamberId=${createdChamberId}`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const getAssignRes = await getAssignmentsHandler(getAssignReq);
    assert.strictEqual(getAssignRes.status, 200);
    const assignBody = await getAssignRes.json();
    assert.ok(assignBody.data.some((a: { id: string }) => a.id === createdAssignmentId));
  });

  it('8. Reassignment otomatis menutup assignment lama dan membuat assignment baru', async () => {
    const switchDate = new Date('2026-09-15T00:00:00.000Z');
    const req = new Request('http://localhost:3000/api/v1/assignments', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: createdDeviceId,
        chamberId: createdChamberId, // reassign
        effectiveFrom: switchDate.toISOString(),
      }),
    });

    const res = await createAssignmentHandler(req);
    assert.strictEqual(res.status, 201);

    // Periksa assignment pertama kini telah ditutup (activeUntil = switchDate)
    const oldAssignment = await prisma.deviceAssignment.findUnique({
      where: { id: createdAssignmentId },
    });
    assert.ok(oldAssignment?.activeUntil);
    assert.strictEqual(oldAssignment!.activeUntil!.toISOString(), switchDate.toISOString());

    // Update createdAssignmentId ke assignment baru
    const body = await res.json();
    createdAssignmentId = body.data.id;
  });

  it('9. POST /api/v1/assignments/[id]/end mengakhiri penugasan secara aman', async () => {
    const endReq = new Request(`http://localhost:3000/api/v1/assignments/${createdAssignmentId}/end`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effectiveUntil: new Date('2026-09-20T00:00:00.000Z').toISOString() }),
    });

    const endRes = await endAssignmentHandler(endReq, { params: Promise.resolve({ id: createdAssignmentId }) });
    assert.strictEqual(endRes.status, 200);
    const endBody = await endRes.json();
    assert.strictEqual(endBody.data.activeUntil, '2026-09-20T00:00:00.000Z');
  });
});
