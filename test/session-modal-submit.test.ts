import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseWibInput } from '../lib/batch-wizard.ts';

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
  let resultSession: string | undefined;
  let refreshes = 0;
  let modal: Record<string, unknown> | null = {
    mode: 'create', captureMode: 'time_range', groupId: 'BT-20261024-01-SR',
    timepointCode: 'H6', chamberId: 'chamber-1',
    startTimeWib: '2020-10-24T20:10', durationMinutes: 1,
    shrimpTempC: '5.5', shrimpWeightG: '480', photos: [], photoCaptions: [],
    ...overrides,
  };
  const context = {
    sessionModal: modal,
    parseWibInput,
    MAX_PHOTO_CAPTION_LENGTH: 140,
    warmup: { 'BT-20261024-01-SR': true },
    chSel: {},
    batch: { sampleGroups: [{ groupId: 'BT-20261024-01-SR', coldStorageMode: 'chamber' }] },
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
    context, requests, notices,
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
  const h = setup({ mode: 'edit', captureMode: undefined, sessionId: 'SES-20261024-H6-SR' });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'PATCH');
  assert.equal(h.requests[0].url, '/api/v1/sessions/SES-20261024-H6-SR');
  assert.equal(h.requests[0].payload.shrimpTempC, 5.5);
  assert.match(h.notices[0], /berhasil diperbarui/);
});

test('rekam langsung membuat sesi tanpa rentang historis', async () => {
  const h = setup({ captureMode: 'live' });
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].payload.autoBackfill, undefined);
  assert.equal(h.requests[0].payload.startedAtUtc, undefined);
  assert.match(h.notices[0], /berhasil dimulai/);
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
