import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DRAFT_MAX_PAYLOAD_BYTES,
  draftLabelFrom,
  isDraftPayloadEmpty,
  sanitizeDraftPayload,
} from '../shared/batch-draft.ts';
import {
  DraftConflictError,
  consumeDraft,
  createDraft,
  discardDraft,
  draftAgeText,
  listDrafts,
  updateDraft,
  type DraftRecord,
} from '../lib/batch-draft.ts';

/** apiFetch palsu: mencatat permintaan dan mengembalikan respons yang dijadwalkan. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { apiFetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const draftOf = (overrides: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'draft-1',
  label: 'Pasar Ciroyom',
  step: 1,
  payload: { marketSource: 'Pasar Ciroyom' },
  status: 'OPEN',
  version: 3,
  ownerOperator: 'Budi',
  ownerDevice: 'Chrome · Android',
  consumedBatchId: null,
  createdAt: '2026-11-16T07:00:00.000Z',
  updatedAt: '2026-11-16T07:10:00.000Z',
  ...overrides,
});

describe('Kontrak payload draf wizard (sanitasi di server & klien)', () => {
  it('hanya kunci yang dikenal form yang lolos; kunci asing dibuang', () => {
    const payload = sanitizeDraftPayload({
      marketSource: 'Pasar Ciroyom',
      shrimpCount: '10',
      kunciAsing: 'harus hilang',
      nested: { a: 1 },
    });
    assert.deepEqual(payload, { marketSource: 'Pasar Ciroyom', shrimpCount: '10' });
  });

  it('tipe salah tidak masuk: angka, objek, dan nilai null diabaikan', () => {
    const payload = sanitizeDraftPayload({
      marketSource: 42,
      deviationAck: 'true',
      shrimpTemperatures: ['2.5', 3, null, '3.5'],
      shrimpLengths: 'bukan array',
    });
    assert.deepEqual(payload, { shrimpTemperatures: ['2.5', '3.5'] });
  });

  it('panjang string dan jumlah item array dibatasi', () => {
    const long = 'x'.repeat(5_000);
    const many = Array.from({ length: 2_000 }, () => long);
    const payload = sanitizeDraftPayload({ marketSource: long, shrimpTemperatures: many });
    assert.strictEqual(payload.marketSource?.length, 500);
    assert.strictEqual(payload.shrimpTemperatures?.length, 1_000);
    assert.strictEqual(payload.shrimpTemperatures?.[0].length, 200);
  });

  it('payload yang tidak berbentuk objek menjadi objek kosong', () => {
    for (const bad of [null, undefined, 'teks', 42, [], true]) {
      assert.deepEqual(sanitizeDraftPayload(bad), {});
    }
  });

  it('draf dianggap kosong hanya bila tidak ada isian berarti', () => {
    assert.strictEqual(isDraftPayloadEmpty({}), true);
    assert.strictEqual(isDraftPayloadEmpty({ marketSource: '   ', shrimpTemperatures: ['', ''] }), true);
    assert.strictEqual(isDraftPayloadEmpty({ marketSource: 'Pasar' }), false);
    assert.strictEqual(isDraftPayloadEmpty({ shrimpTemperatures: ['', '2.5'] }), false);
  });

  it('label draf memakai lokasi beli, atau penanda bawaan', () => {
    assert.strictEqual(draftLabelFrom({ marketSource: 'Pasar Ciroyom' }, 'Draf baru'), 'Pasar Ciroyom');
    assert.strictEqual(draftLabelFrom({ marketSource: '  ' }, 'Draf baru'), 'Draf baru');
    assert.strictEqual(draftLabelFrom({}, 'Draf baru'), 'Draf baru');
  });

  it('batas ukuran payload tersedia sebagai konstanta bersama', () => {
    assert.strictEqual(DRAFT_MAX_PAYLOAD_BYTES, 64 * 1024);
  });
});

describe('Klien draf: daftar, simpan, konflik versi, dan penanda terpakai', () => {
  it('listDrafts mengembalikan array draf dan aman bila data bukan array', async () => {
    const { apiFetch, calls } = stubFetch(() => json({ data: [draftOf()] }));
    const rows = await listDrafts(apiFetch);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(calls[0].url, '/api/v1/batch-drafts');

    const empty = stubFetch(() => json({ data: null }));
    assert.deepEqual(await listDrafts(empty.apiFetch), []);
  });

  it('createDraft mengirim payload + step dan mengembalikan draf baru', async () => {
    const { apiFetch, calls } = stubFetch(() => json({ data: draftOf({ id: 'baru' }) }, 201));
    const created = await createDraft(apiFetch, { marketSource: 'Pasar' }, 2);
    assert.strictEqual(created.id, 'baru');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.deepEqual(body, { payload: { marketSource: 'Pasar' }, step: 2 });
    assert.strictEqual(calls[0].init?.method, 'POST');
  });

  it('updateDraft mengirim versi yang dibaca dan memakai versi baru dari server', async () => {
    const { apiFetch, calls } = stubFetch(() => json({ data: draftOf({ version: 4 }) }));
    const updated = await updateDraft(apiFetch, 'draft-1', {
      payload: { marketSource: 'Pasar' },
      step: 1,
      version: 3,
    });
    assert.strictEqual(updated.version, 4);
    const body = JSON.parse(String(calls[0].init?.body));
    assert.strictEqual(body.version, 3, 'klien mengirim versi yang terakhir dibaca');
    assert.strictEqual(calls[0].url, '/api/v1/batch-drafts/draft-1');
  });

  it('konflik versi (409) menjadi DraftConflictError berisi pemilik terbaru', async () => {
    const { apiFetch } = stubFetch(() =>
      json(
        {
          error: {
            code: 'DRAFT_VERSION_CONFLICT',
            message: 'Draf sudah diperbarui di perangkat lain.',
            details: [{ version: 9, ownerOperator: 'Sari', ownerDevice: 'Chrome · Windows' }],
          },
        },
        409
      )
    );
    await assert.rejects(
      () => updateDraft(apiFetch, 'draft-1', { payload: {}, step: 0, version: 3 }),
      (err: unknown) => {
        assert.ok(err instanceof DraftConflictError, 'harus melempar DraftConflictError');
        assert.strictEqual(err.serverVersion, 9);
        assert.strictEqual(err.ownerOperator, 'Sari');
        assert.strictEqual(err.ownerDevice, 'Chrome · Windows');
        return true;
      }
    );
  });

  it('error lain memakai pesan server apa adanya', async () => {
    const { apiFetch } = stubFetch(() => json({ error: { message: 'Draf terlalu besar.' } }, 422));
    await assert.rejects(
      () => updateDraft(apiFetch, 'draft-1', { payload: {}, step: 0, version: 1 }),
      /Draf terlalu besar\./
    );
  });

  it('discardDraft dan consumeDraft memakai method yang benar', async () => {
    const discard = stubFetch(() => json({ data: { discarded: true } }));
    await discardDraft(discard.apiFetch, 'draft-1');
    assert.strictEqual(discard.calls[0].init?.method, 'DELETE');

    const consume = stubFetch(() => json({ data: draftOf({ status: 'CONSUMED' }) }));
    await consumeDraft(consume.apiFetch, 'draft-1', 'BT-20261116-01');
    assert.strictEqual(consume.calls[0].init?.method, 'POST');
    assert.strictEqual(consume.calls[0].url, '/api/v1/batch-drafts/draft-1/consume');
    assert.deepEqual(JSON.parse(String(consume.calls[0].init?.body)), { batchId: 'BT-20261116-01' });
  });

  it('umur draf ditampilkan relatif terhadap sekarang', () => {
    const now = Date.parse('2026-11-16T08:00:00.000Z');
    assert.strictEqual(draftAgeText('2026-11-16T07:59:30.000Z', now), 'baru saja');
    assert.strictEqual(draftAgeText('2026-11-16T07:48:00.000Z', now), '12 menit lalu');
    assert.strictEqual(draftAgeText('2026-11-16T05:00:00.000Z', now), '3 jam lalu');
    assert.strictEqual(draftAgeText('2026-11-14T08:00:00.000Z', now), '2 hari lalu');
  });
});
