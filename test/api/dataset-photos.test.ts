import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { POST as uploadPhotos, PATCH as patchPhotos, DELETE as deletePhotos } from '../../app/api/v1/batches/[batchId]/photos/route.ts';
import { GET as getUpload, HEAD as headUpload } from '../../app/uploads/[...path]/route.ts';
import { POST as createGroups } from '../../app/api/v1/batches/[batchId]/groups/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { POST as lockBatch } from '../../app/api/v1/batches/[batchId]/lock/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const DAY = '2099-03-03';
const PREFIX = 'BT-20990303';

function authHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' };
}

function photoForm(
  files: Array<{ name: string; type: string; bytes: Uint8Array }>,
  captions?: Array<string | null> | null
): FormData {
  const form = new FormData();
  for (const f of files) {
    form.append('photos', new File([f.bytes as unknown as BlobPart], f.name, { type: f.type }));
  }
  if (captions !== null) {
    form.append('captions', JSON.stringify(captions ?? files.map((_, i) => `Foto ${i + 1}`)));
  }
  return form;
}

const JPG = { name: 'awal.jpg', type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
const PNG = { name: 'lab.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };

async function photoReq(
  batchId: string,
  cookie: string,
  files: Array<{ name: string; type: string; bytes: Uint8Array }>,
  captions?: Array<string | null> | null
) {
  const body = photoForm(files, captions);
  return uploadPhotos(
    new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
      method: 'POST',
      headers: authHeaders(cookie),
      body,
    }),
    { params: Promise.resolve({ batchId }) }
  );
}

describe('HTTP API v1: Dataset Batch Photos Upload (Fase 4)', () => {
  const tag = Date.now().toString().slice(-6);
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let batchId = '';
  let batchNoPhoto = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `photo-admin-${tag}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `photo-viewer-${tag}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const a = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(a.rawToken, a.expiresAt).split(';')[0];
    const v = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(v.rawToken, v.expiresAt).split(';')[0];

    const mkBatch = (suffix: string) =>
      prisma.collectionBatch.create({
        data: {
          batchId: `${PREFIX}-${suffix}`,
          procuredAtUtc: new Date(`${DAY}T00:30:00.000Z`),
          marketSource: 'Pasar Foto Test',
          sourceType: 'MARKET',
          shrimpCount: 12,
          // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
          sizeGrade: 25, // Math.round(12 / 485.5 * 1000)
          shrimpLengthCm: 12.5,
          totalWeightG: 485.5,
          initialCondition: 'DEAD',
          initialTempC: 8.2,
          arrivedAtUtc: new Date(`${DAY}T02:00:00.000Z`),
          coolerTempMinC: 1.2,
          coolerTempMaxC: 3.8,
          tempStartC: 3.0,
          tempEndC: 3.5,
          operatorId: admin.id,
        },
      });
    batchId = (await mkBatch('01')).batchId;
    batchNoPhoto = (await mkBatch('02')).batchId;
  });

  after(async () => {
    await prisma.measurementSession.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    for (const suffix of ['01', '02']) {
      await rm(path.join(process.cwd(), 'public', 'uploads', `${PREFIX}-${suffix}`), {
        recursive: true,
        force: true,
      });
    }
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. Upload 2 foto valid + caption → 201 dan file ada di disk', async () => {
    const res = await photoReq(batchId, adminCookie, [JPG, PNG], ['Di pasar', 'Sebelum chamber']);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.photos.length, 2);
    assert.deepStrictEqual(
      body.data.photos.map((p: { caption: string }) => p.caption),
      ['Di pasar', 'Sebelum chamber']
    );
    for (const photo of body.data.photos as Array<{ url: string }>) {
      const url = photo.url;
      assert.match(url, new RegExp(`^uploads/${batchId}/${batchId}_\\d+_\\d+\\.(jpg|png)$`));
      const st = await stat(path.join(process.cwd(), 'public', url));
      assert.ok(st.isFile());

      const segments = url.replace(/^uploads\//, '').split('/');
      const serveRes = await getUpload(new Request(`http://localhost:3000/${url}`), {
        params: Promise.resolve({ path: segments }),
      });
      assert.strictEqual(serveRes.status, 200);
      assert.match(serveRes.headers.get('Content-Type') ?? '', /^image\/(jpeg|png)$/);
      assert.strictEqual(serveRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
      const headRes = await headUpload(new Request(`http://localhost:3000/${url}`, { method: 'HEAD' }), {
        params: Promise.resolve({ path: segments }),
      });
      assert.strictEqual(headRes.status, 200);
    }

    const traversal = await getUpload(new Request('http://localhost:3000/uploads/..'), {
      params: Promise.resolve({ path: ['..', 'etc', 'passwd'] }),
    });
    assert.strictEqual(traversal.status, 400);

    const notFound = await getUpload(new Request('http://localhost:3000/uploads/missing.jpg'), {
      params: Promise.resolve({ path: ['missing.jpg'] }),
    });
    assert.strictEqual(notFound.status, 404);
  });

  it('2. Tipe file selain jpg/png ditolak (422)', async () => {
    const res = await photoReq(batchId, adminCookie, [
      { name: 'catatan.txt', type: 'text/plain', bytes: new Uint8Array([104, 105]) },
    ]);
    assert.strictEqual(res.status, 422);
  });

  it('3. File >5MB dan total >10 foto ditolak (413)', async () => {
    const big = await photoReq(batchId, adminCookie, [
      { name: 'besar.jpg', type: 'image/jpeg', bytes: new Uint8Array(6 * 1024 * 1024) },
    ]);
    assert.strictEqual(big.status, 413);

    const many = Array.from({ length: 9 }, (_, i) => ({ ...JPG, name: `f${i}.jpg` }));
    const over = await photoReq(batchId, adminCookie, many); // 2 + 9 = 11 > 10
    assert.strictEqual(over.status, 413);
  });

  it('4. Tanpa file, tanpa auth, dan VIEWER ditolak (422/401/403)', async () => {
    assert.strictEqual((await photoReq(batchId, adminCookie, [])).status, 422);

    const anon = await uploadPhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
        method: 'POST',
        body: photoForm([JPG]),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(anon.status, 401);

    assert.strictEqual((await photoReq(batchId, viewerCookie, [JPG])).status, 403);
  });

  it('4b. Caption wajib: hilang, selisih jumlah, kosong, dan >140 ditolak (422)', async () => {
    assert.strictEqual((await photoReq(batchId, adminCookie, [JPG], null)).status, 422);
    assert.strictEqual((await photoReq(batchId, adminCookie, [JPG, PNG], ['Hanya satu'])).status, 422);
    assert.strictEqual((await photoReq(batchId, adminCookie, [JPG], ['   '])).status, 422);
    assert.strictEqual((await photoReq(batchId, adminCookie, [JPG], ['x'.repeat(141)])).status, 422);
    const badJson = new FormData();
    badJson.append('photos', new File([JPG.bytes as unknown as BlobPart], JPG.name, { type: JPG.type }));
    badJson.append('captions', 'bukan-json');
    const res = await uploadPhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
        method: 'POST',
        headers: authHeaders(adminCookie),
        body: badJson,
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 422);
  });

  it('5. Batch tidak ada 404, batch terkunci 409', async () => {
    assert.strictEqual((await photoReq('BT-20990303-99', adminCookie, [JPG])).status, 404);

    await prisma.collectionBatch.update({
      where: { batchId: batchNoPhoto },
      data: { lockedAt: new Date() },
    });
    assert.strictEqual((await photoReq(batchNoPhoto, adminCookie, [JPG])).status, 409);
    await prisma.collectionBatch.update({ where: { batchId: batchNoPhoto }, data: { lockedAt: null } });
  });

  it('6. Lock menolak batch tanpa foto, menerima setelah upload', async () => {
    const call = async <P extends object>(
      handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>,
      url: string,
      params: P,
      payload: unknown
    ) =>
      handler(
        new Request(url, {
          method: 'POST',
          headers: { ...authHeaders(adminCookie), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve(params) }
      );

    await call(
      createGroups,
      `http://localhost:3000/api/v1/batches/${batchNoPhoto}/groups`,
      { batchId: batchNoPhoto },
      {
        groups: [
          {
            storageCondition: 'room_temp',
            labTempC: 6.5,
            visualCheck: 'normal',
            labWeightG: 482,
            shrimpLengthCm: 12.4,
            sampleShrimpCount: 4,
            sampleWeightG: 162,
          },
        ],
      }
    );
    const groupId = `${batchNoPhoto}-SR`;
    const sess = await (
      await call(
        createSession,
        `http://localhost:3000/api/v1/groups/${groupId}/sessions`,
        { groupId },
        { timepointCode: 'H0', warmupDone: true }
      )
    ).json();
    await call(
      completeSession,
      `http://localhost:3000/api/v1/sessions/${sess.data.sessionId}/complete`,
      { sessionId: sess.data.sessionId },
      { cleaningDone: true }
    );

    const noPhoto = await call(
      lockBatch,
      `http://localhost:3000/api/v1/batches/${batchNoPhoto}/lock`,
      { batchId: batchNoPhoto },
      {}
    );
    assert.strictEqual(noPhoto.status, 422);

    assert.strictEqual((await photoReq(batchNoPhoto, adminCookie, [JPG])).status, 201);
    const locked = await call(
      lockBatch,
      `http://localhost:3000/api/v1/batches/${batchNoPhoto}/lock`,
      { batchId: batchNoPhoto },
      {}
    );
    assert.strictEqual(locked.status, 200);
  });

  it('7. DELETE foto menghapus file + baris caption', async () => {
    const rows = await prisma.batchPhoto.findMany({ where: { batchId }, orderBy: { sortOrder: 'asc' } });
    assert.ok(rows.length >= 2);
    const target = rows[0].url;

    const delReq = (cookie: string | null, payload: unknown) =>
      deletePhotos(
        new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
          method: 'DELETE',
          headers: {
            ...(cookie ? authHeaders(cookie) : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ batchId }) }
      );

    assert.strictEqual((await delReq(viewerCookie, { photoUrls: [target] })).status, 403);
    assert.strictEqual((await delReq(null, { photoUrls: [target] })).status, 401);
    assert.strictEqual((await delReq(adminCookie, { photoUrls: [] })).status, 422);
    assert.strictEqual(
      (await delReq(adminCookie, { photoUrls: [`uploads/${batchNoPhoto}/${target.split('/').pop()}`] })).status,
      422
    );
    assert.strictEqual((await delReq(adminCookie, { photoUrls: ['uploads/lain/x.jpg'] })).status, 422);

    const res = await delReq(adminCookie, { photoUrls: [target] });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(!(body.data.photos as Array<{ url: string }>).some((p) => p.url === target));
    await assert.rejects(stat(path.join(process.cwd(), 'public', target)));

    const deletedServeRes = await getUpload(new Request(`http://localhost:3000/${target}`), {
      params: Promise.resolve({ path: target.replace(/^uploads\//, '').split('/') }),
    });
    assert.strictEqual(deletedServeRes.status, 404);

    const gone = await delReq(adminCookie, { photoUrls: [target] });
    assert.strictEqual(gone.status, 404);
  });

  it('7b. PATCH caption tersimpan, yang invalid ditolak', async () => {
    const rows = await prisma.batchPhoto.findMany({ where: { batchId }, orderBy: { sortOrder: 'asc' } });
    assert.ok(rows.length >= 1);
    const target = rows[0].url;
    const call = (cookie: string | null, payload: unknown) =>
      patchPhotos(
        new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
          method: 'PATCH',
          headers: {
            ...(cookie ? authHeaders(cookie) : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ batchId }) }
      );

    assert.strictEqual((await call(viewerCookie, { photos: [{ url: target, caption: 'x' }] })).status, 403);
    assert.strictEqual((await call(null, { photos: [{ url: target, caption: 'x' }] })).status, 401);
    assert.strictEqual((await call(adminCookie, { photos: [] })).status, 422);
    assert.strictEqual((await call(adminCookie, { photos: [{ url: target, caption: '' }] })).status, 422);
    assert.strictEqual((await call(adminCookie, { photos: [{ url: target, caption: 'y'.repeat(141) }] })).status, 422);
    assert.strictEqual(
      (await call(adminCookie, { photos: [{ url: `uploads/${batchNoPhoto}/asing.jpg`, caption: 'x' }] })).status,
      422
    );
    assert.strictEqual(
      (await call(adminCookie, { photos: [{ url: `uploads/${batchId}/tak-ada.jpg`, caption: 'x' }] })).status,
      404
    );

    const ok = await call(adminCookie, { photos: [{ url: target, caption: 'Sesudah chamber' }] });
    assert.strictEqual(ok.status, 200);
    const saved = (await ok.json()).data.photos as Array<{ url: string; caption: string }>;
    assert.strictEqual(saved.find((p) => p.url === target)?.caption, 'Sesudah chamber');
    assert.strictEqual(
      (await prisma.batchPhoto.findFirstOrThrow({ where: { batchId, url: target } })).caption,
      'Sesudah chamber'
    );

    const lockedPatch = await patchPhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchNoPhoto}/photos`, {
        method: 'PATCH',
        headers: { ...authHeaders(adminCookie), 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: [{ url: target, caption: 'x' }] }),
      }),
      { params: Promise.resolve({ batchId: batchNoPhoto }) }
    );
    assert.strictEqual(lockedPatch.status, 409);
  });

  it('8. DELETE foto pada batch terkunci ditolak 409', async () => {
    const res = await deletePhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchNoPhoto}/photos`, {
        method: 'DELETE',
        headers: { ...authHeaders(adminCookie), 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrls: ['uploads/x.jpg'] }),
      }),
      { params: Promise.resolve({ batchId: batchNoPhoto }) }
    );
    assert.strictEqual(res.status, 409);
  });
});
