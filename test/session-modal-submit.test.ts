import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { observationTempMean, parseWibInput } from '../lib/batch-wizard.ts';
import { calibrationDone } from '../lib/calibration.ts';

// Jalankan handler UI asli dengan pengganti state/network, agar regresi cabang
// create/edit terdeteksi tanpa menyalin logika handler ke dalam tes.
const source = ts.createSourceFile(
  'page.tsx',
  readFileSync(new URL('../app/batches/[batchId]/page.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handlerSource = '';
function findHandler(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSessionModalSubmit' && node.initializer) {
    handlerSource = `const submit = ${node.initializer.getText(source)}; submit;`;
  }
  ts.forEachChild(node, findHandler);
}
findHandler(source);
assert.ok(handlerSource, 'Handler pengiriman modal harus ditemukan');
const compiled = ts.transpileModule(handlerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function setup(overrides: Record<string, unknown> = {}) {
  const requests: Array<{ url: string; payload: Record<string, unknown>; method: string }> = [];
  const notices: string[] = [];
  const resetGroups: string[] = [];
  let resultSession: string | undefined;
  let refreshes = 0;
  let modal: Record<string, unknown> | null = {
    mode: 'create', captureMode: 'time_range', groupId: 'BT-20261024-01-SR',
    timepointCode: 'H6', chamberId: 'chamber-1',
    startTimeWib: '2020-10-24T20:10', durationMinutes: 1,
    shrimpTemps: ['5', '5.5', '6'], shrimpWeightG: '480', photos: [], photoCaptions: [],
    ...overrides,
  };
  // Kalibrasi grup ini sudah selesai 2 menit lalu (durasi 1 menit).
  const calibRun: Record<string, { mins: number; startedAtMs: number } | null> = {
    'BT-20261024-01-SR': { mins: 1, startedAtMs: Date.now() - 120_000 },
  };
  const context = {
    sessionModal: modal,
    parseWibInput,
    observationTempMean,
    MAX_PHOTO_CAPTION_LENGTH: 140,
    calibRun,
    nowMs: Date.now(),
    calibrationDone,
    resetCalibration: (groupId: string) => resetGroups.push(groupId),
    chSel: {},
    batch: { sampleGroups: [{ groupId: 'BT-20261024-01-SR', coldStorageMode: 'chamber', chamberId: null as string | null }] },
    setSessionModal: (update: unknown) => {
      modal = typeof update === 'function' ? update(modal) : update;
    },
    callJson: async (url: string, payload: Record<string, unknown>) => {
      requests.push({ url, payload, method: 'POST' });
      return { sessionId: 'SES-20261024-H6-SR', _meta: { linkedReadings: 30 } };
    },
    apiFetch: async (url: string, init: RequestInit) => {
      requests.push({ url, payload: JSON.parse(String(init.body)), method: String(init.method) });
      return new Response(JSON.stringify({ data: { sessionId: 'SES-20261024-H6-SR' } }));
    },
    notify: (message: string) => notices.push(message),
    setResultModalSessionId: (id: string) => { resultSession = id; },
    refresh: () => { refreshes++; },
  };
  return {
    context, requests, notices, resetGroups,
    submit: () => (runInNewContext(compiled, context) as () => Promise<void>)(),
    get modal() { return modal; },
    get resultSession() { return resultSession; },
    get refreshes() { return refreshes; },
  };
}

test('buat sesi rentang waktu mengirim POST, menautkan data, dan membuka hasil setelah konfirmasi server', async () => {
  const h = setup();
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].url, '/api/v1/groups/BT-20261024-01-SR/sessions');
  assert.equal(h.requests[0].payload.startedAtUtc, '2020-10-24T13:10:00.000Z');
  assert.equal(h.requests[0].payload.endedAtUtc, '2020-10-24T13:11:00.000Z');
  assert.equal(h.requests[0].payload.autoBackfill, true);
  assert.equal(h.requests[0].payload.chamberId, 'chamber-1');
  assert.equal(h.resultSession, 'SES-20261024-H6-SR');
  assert.match(h.notices[0], /30 data sensor berhasil dikaitkan/);
  assert.equal(h.modal, null);
  assert.equal(h.refreshes, 1);
});

test('edit tahap hanya PATCH sesi yang dipilih, tanpa membuat sesi baru', async () => {
  const h = setup({ mode: 'edit', captureMode: undefined, sessionId: 'SES-20261024-H6-SR', shrimpTemps: ['5.5'] });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'PATCH');
  assert.equal(h.requests[0].url, '/api/v1/sessions/SES-20261024-H6-SR');
  assert.equal(h.requests[0].payload.shrimpTempC, 5.5);
  assert.match(h.notices[0], /berhasil diperbarui/);
});

test('edit tahap yang dikosongkan mengirim null, bukan angka tebakan', async () => {
  const h = setup({ mode: 'edit', captureMode: undefined, sessionId: 'SES-20261024-H6-SR', shrimpTemps: [''] });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.strictEqual(h.requests[0].payload.shrimpTempC, null);
});

test('suhu tahap baru dikirim sebagai rata-rata baris per ekor', async () => {
  const h = setup({ captureMode: 'live' });
  await h.submit();
  assert.equal(h.requests[0].payload.shrimpTempC, 5.5);
});

test('baris suhu belum lengkap memblokir pembuatan sesi', async () => {
  for (const shrimpTemps of [['5', '', '6'], ['5', 'abc', '6'], ['5', '5,5', '6']]) {
    const h = setup({ captureMode: 'live', shrimpTemps });
    await h.submit();
    assert.equal(h.requests.length, 0, `baris ${JSON.stringify(shrimpTemps)} tidak boleh terkirim`);
    assert.equal(h.notices.length, 0);
    assert.ok(h.modal?.err, 'pesan galat harus tampil di modal');
  }
});

test('suhu di luar acuan protokol tetap dikirim sebagai rata-rata (tanpa rentang)', async () => {
  // Nilai ekstrem tidak lagi memblokir: yang tersimpan adalah rata-rata baris.
  const h = setup({ captureMode: 'live', shrimpTemps: ['5', '99', '6'] });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].payload.shrimpTempC, 36.67);
});

test('jumlah udang per sesi yang belum terbaca memblokir sesi dengan pesan pengelompokan', async () => {
  const h = setup({ captureMode: 'live', shrimpTemps: [] });
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(String(h.modal?.err), /pengelompokan/i);
});

test('rekam langsung membuat sesi tanpa rentang historis', async () => {
  const h = setup({ captureMode: 'live' });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].payload.autoBackfill, undefined);
  assert.equal(h.requests[0].payload.startedAtUtc, undefined);
  assert.match(h.notices[0], /berhasil dimulai/);
  // Kalibrasi terpakai: tahap berikutnya harus kalibrasi ulang.
  assert.deepEqual(h.resetGroups, ['BT-20261024-01-SR']);
});

test('rekam langsung ditolak bila hitungan kalibrasi belum habis', async () => {
  const h = setup({ captureMode: 'live' });
  // Baru mulai 30 detik dari durasi 5 menit: belum selesai.
  h.context.calibRun = { 'BT-20261024-01-SR': { mins: 5, startedAtMs: Date.now() - 30_000 } };
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(String(h.modal?.err), /kalibrasi/i);
  assert.deepEqual(h.resetGroups, []);
});

test('rekam langsung ditolak bila kalibrasi belum pernah dimulai', async () => {
  const h = setup({ captureMode: 'live' });
  h.context.calibRun = {};
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(String(h.modal?.err), /kalibrasi/i);
});

test('chamber grup yang tersimpan dipakai ketika pilihan sesi belum diubah', async () => {
  const h = setup({ chamberId: undefined });
  h.context.batch.sampleGroups[0].chamberId = 'saved-cold-chamber';
  await h.submit();
  assert.strictEqual(h.requests[0].payload.chamberId, 'saved-cold-chamber');
});

test('kegagalan server atau respons tanpa sesi tidak menampilkan sukses', async () => {
  for (const response of ['reject', 'missing-session']) {
    const h = setup();
    h.context.callJson = async () => {
      if (response === 'reject') throw new Error('Server gagal menyimpan sesi');
      return {} as Awaited<ReturnType<typeof h.context.callJson>>;
    };
    await h.submit();
    assert.equal(h.notices.length, 0);
    assert.equal(h.resultSession, undefined);
    assert.equal(h.refreshes, 0);
    assert.ok(h.modal?.err);
  }
});
