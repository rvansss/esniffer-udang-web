import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { GET as listDrafts, POST as createDraft } from '../../app/api/v1/batch-drafts/route.ts';
import {
  GET as getDraft,
  PUT as updateDraft,
  DELETE as discardDraft,
} from '../../app/api/v1/batch-drafts/[draftId]/route.ts';
import { POST as consumeDraft } from '../../app/api/v1/batch-drafts/[draftId]/consume/route.ts';

/**
 * Draf wizard batch baru di server (Fase 0).
 *
 * Inti yang diuji: draf bisa dilanjutkan dari perangkat lain (bukan localStorage),
 * dan dua operator di akun yang sama tidak saling menimpa — perubahan dengan
 * versi lama ditolak 409, bukan diterapkan diam-diam.
 */

const tag = `draft-${Date.now()}`;

function request(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Origin', 'http://localhost:3000');
  headers.set('Host', 'localhost:3000');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(url, { ...rest, headers });
}

const ctx = (draftId: string) => ({ params: Promise.resolve({ draftId }) });

describe('Draf batch baru di server: lintas perangkat & optimistic concurrency', () => {
  const ownerEmail = `${tag}-owner@esniffer.local`;
  const otherEmail = `${tag}-other@esniffer.local`;
  const viewerEmail = `${tag}-viewer@esniffer.local`;
  const password = 'PasswordSecret123!';
  const userIds: string[] = [];
  let ownerCookie = '';
  let otherCookie = '';
  let viewerCookie = '';
  let draftId = '';
  let batchId = '';

  before(async () => {
    const passwordHash = await hashPassword(password);
    const [owner, other, viewer] = await Promise.all([
      prisma.user.create({ data: { email: ownerEmail, passwordHash, role: 'ADMIN', isActive: true } }),
      prisma.user.create({ data: { email: otherEmail, passwordHash, role: 'ADMIN', isActive: true } }),
      prisma.user.create({ data: { email: viewerEmail, passwordHash, role: 'VIEWER', isActive: true } }),
    ]);
    userIds.push(owner.id, other.id, viewer.id);

    ownerCookie = await cookieFor(owner.id);
    otherCookie = await cookieFor(other.id);
    viewerCookie = await cookieFor(viewer.id);

    // Batch kecil untuk menguji "draf menjadi batch".
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
            marketSource: 'Pasar Draf',
            shrimpCount: 10,
            sizeGrade: 25,
            totalWeightG: 400,
            initialCondition: 'DEAD',
            initialTempC: 8,
            arrivedAtUtc: new Date('2026-11-16T01:00:00.000Z'),
            coolerTempMarketC: 1,
            coolerTempLabC: 3,
            operatorId: owner.id,
          },
        });
        batchId = created.batchId;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    assert.ok(batchId, 'batch uji harus berhasil dibuat');
  });

  async function cookieFor(userId: string): Promise<string> {
    const session = await createAuthSession(userId);
    return buildSessionCookie(session.rawToken, session.expiresAt).split(';')[0];
  }

  after(async () => {
    await prisma.batchDraft.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  const post = (body: unknown, cookie = ownerCookie, operator = 'Budi') =>
    createDraft(
      request('http://localhost:3000/api/v1/batch-drafts', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': operator },
        body: JSON.stringify(body),
      })
    );

  it('1. draf kosong ditolak 409 (tidak ada draf hantu di daftar)', async () => {
    const res = await post({ payload: { marketSource: '   ' }, step: 0 });
    assert.strictEqual(res.status, 409);
  });

  it('2. membuat draf menyimpan payload, langkah, operator, dan perangkat', async () => {
    const res = await post({
      payload: { marketSource: 'Pasar Ciroyom', shrimpCount: '10', shrimpTemperatures: ['2.5'] },
      step: 1,
    });
    assert.strictEqual(res.status, 201);
    const draft = (await res.json()).data;
    draftId = draft.id;
    assert.strictEqual(draft.step, 1);
    assert.strictEqual(draft.version, 1);
    assert.strictEqual(draft.status, 'OPEN');
    assert.strictEqual(draft.ownerOperator, 'Budi');
    assert.ok(draft.ownerDevice, 'label perangkat tercatat');
    assert.strictEqual(draft.label, 'Pasar Ciroyom');
    assert.deepEqual(draft.payload.shrimpTemperatures, ['2.5']);
  });

  it('3. langkah di luar 0..2 ditolak 422', async () => {
    const res = await post({ payload: { marketSource: 'Pasar' }, step: 3 });
    assert.strictEqual(res.status, 422);
  });

  it('4. daftar draf menampilkan draf akun ini (bahan "lanjutkan di perangkat lain")', async () => {
    const res = await listDrafts(request('http://localhost:3000/api/v1/batch-drafts', { cookie: ownerCookie }));
    assert.strictEqual(res.status, 200);
    const rows = (await res.json()).data as Array<{ id: string; label: string; version: number }>;
    const found = rows.find((row) => row.id === draftId);
    assert.ok(found, 'draf baru harus muncul di daftar');
    assert.strictEqual(found.label, 'Pasar Ciroyom');
  });

  it('5. operator lain di akun yang sama (Sari) melanjutkan draf dan versinya naik', async () => {
    // Satu akun dipakai bergantian: cookie tetap akun yang sama, operator
    // dikirim lewat X-Operator. Inilah kasus nyata "lanjut di perangkat lain".
    const res = await updateDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}`, {
        method: 'PUT',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json', 'X-Operator': 'Sari' },
        body: JSON.stringify({
          payload: { marketSource: 'Pasar Ciroyom', shrimpCount: '12' },
          step: 2,
          version: 1,
        }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(res.status, 200);
    const draft = (await res.json()).data;
    assert.strictEqual(draft.version, 2);
    assert.strictEqual(draft.step, 2);
    assert.strictEqual(draft.ownerOperator, 'Sari', 'operator terakhir yang menyunting tercatat');
    assert.strictEqual(draft.payload.shrimpCount, '12');
  });

  it('6. menyimpan dengan versi lama ditolak 409 beserta versi terbaru (tidak menimpa diam-diam)', async () => {
    const res = await updateDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}`, {
        method: 'PUT',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { marketSource: 'Pasar Lama' }, step: 0, version: 1 }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'DRAFT_VERSION_CONFLICT');
    assert.strictEqual(body.error.details[0].version, 2);
    assert.strictEqual(body.error.details[0].ownerOperator, 'Sari');

    // Data di server tidak berubah oleh percobaan yang kalah.
    const current = await prisma.batchDraft.findUniqueOrThrow({ where: { id: draftId } });
    assert.strictEqual((current.payload as { marketSource?: string }).marketSource, 'Pasar Ciroyom');
    assert.strictEqual(current.version, 2);
  });

  it('7. payload disaring: kunci asing dibuang, payload raksasa ditolak 422', async () => {
    const res = await updateDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}`, {
        method: 'PUT',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: { marketSource: 'Pasar Bersih', kunciAsing: 'x', nested: { a: 1 } },
          step: 2,
          version: 2,
        }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(res.status, 200);
    const draft = (await res.json()).data;
    assert.deepEqual(draft.payload, { marketSource: 'Pasar Bersih' });

    const huge = await updateDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}`, {
        method: 'PUT',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: { shrimpTemperatures: Array.from({ length: 1000 }, () => 'x'.repeat(200)) },
          step: 2,
          version: draft.version,
        }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(huge.status, 422);
  });

  it('8. draf akun lain tidak terlihat dan tidak bisa diubah (404)', async () => {
    const otherDraft = await post({ payload: { marketSource: 'Pasar Orang Lain' }, step: 0 }, otherCookie, 'Sari');
    assert.strictEqual(otherDraft.status, 201);
    const foreignId = (await otherDraft.json()).data.id as string;

    const read = await getDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${foreignId}`, { cookie: ownerCookie }),
      ctx(foreignId)
    );
    assert.strictEqual(read.status, 404);

    const list = await listDrafts(request('http://localhost:3000/api/v1/batch-drafts', { cookie: ownerCookie }));
    const ids = ((await list.json()).data as Array<{ id: string }>).map((row) => row.id);
    assert.ok(!ids.includes(foreignId), 'daftar hanya memuat draf milik akun sendiri');

    await prisma.batchDraft.deleteMany({ where: { id: foreignId } });
  });

  it('9. draf menjadi batch: ditandai CONSUMED, hilang dari daftar, dan idempoten', async () => {
    const res = await consumeDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}/consume`, {
        method: 'POST',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(res.status, 200);
    const draft = (await res.json()).data;
    assert.strictEqual(draft.status, 'CONSUMED');
    assert.strictEqual(draft.consumedBatchId, batchId);

    const list = await listDrafts(request('http://localhost:3000/api/v1/batch-drafts', { cookie: ownerCookie }));
    const ids = ((await list.json()).data as Array<{ id: string }>).map((row) => row.id);
    assert.ok(!ids.includes(draftId), 'draf yang sudah menjadi batch tidak ditawarkan lagi');

    // Retry (mis. jaringan putus setelah batch tersimpan) tidak menghasilkan error.
    const again = await consumeDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${draftId}/consume`, {
        method: 'POST',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      }),
      ctx(draftId)
    );
    assert.strictEqual(again.status, 200);
  });

  it('10. batch tujuan yang tidak ada ditolak 404', async () => {
    const draft = await post({ payload: { marketSource: 'Pasar Consume' }, step: 0 });
    const id = (await draft.json()).data.id as string;
    const res = await consumeDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${id}/consume`, {
        method: 'POST',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: 'BT-19990101-99' }),
      }),
      ctx(id)
    );
    assert.strictEqual(res.status, 404);
    await prisma.batchDraft.deleteMany({ where: { id } });
  });

  it('11. membuang draf menutupnya permanen; penyimpanan setelahnya ditolak 409', async () => {
    const created = await post({ payload: { marketSource: 'Pasar Buang' }, step: 0 });
    const id = (await created.json()).data.id as string;

    const res = await discardDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${id}`, { method: 'DELETE', cookie: ownerCookie }),
      ctx(id)
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data.discarded, true);

    const put = await updateDraft(
      request(`http://localhost:3000/api/v1/batch-drafts/${id}`, {
        method: 'PUT',
        cookie: ownerCookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { marketSource: 'Pasar Buang' }, step: 0, version: 1 }),
      }),
      ctx(id)
    );
    assert.strictEqual(put.status, 409);
    await prisma.batchDraft.deleteMany({ where: { id } });
  });

  it('12. VIEWER tidak boleh membuat/mengubah draf (403)', async () => {
    const res = await post({ payload: { marketSource: 'Pasar Viewer' }, step: 0 }, viewerCookie);
    assert.strictEqual(res.status, 403);
  });
});
