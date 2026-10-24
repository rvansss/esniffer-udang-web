import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as datetime from '../shared/datetime.ts';
import * as wizard from '../lib/batch-wizard.ts';
import * as history from '../lib/api/history.ts';

// Jalankan komponen dan event handler asli dengan state/effect serta network
// terkontrol: respons yang terlambat dan timer tidak memerlukan browser/DB.
type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const compiled = ts.transpileModule(
  readFileSync(new URL('../components/layout/ExportPanel.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } },
).outputText;

function payload(at = '2026-10-23T13:15:00.000Z', snapshot = '42') {
  return { data: [{ id: at, measuredAt: at, values: {} }], meta: { snapshotWatermark: snapshot, nextCursor: null } };
}
function response(body = payload()): Response { return Response.json(body); }

function setup() {
  const slots: Slot[] = [];
  let slot = 0;
  let effects: Array<() => void> = [];
  let tree: unknown;
  const intervals = new Set<() => void>();
  const timeouts = new Set<() => void>();
  const requests: URL[] = [];
  const downloads: string[] = [];
  let respond: (url: URL) => Response | Promise<Response> = (url) => url.pathname.endsWith('/export')
    ? new Response('measured_at\r\n2026-10-23T20:15:00.000+07:00\r\n') : response();
  const props = { chamberId: 'CH-01', activeDeviceId: 'device-original' };
  const changed = (a: unknown[] | undefined, b: unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((x, i) => x !== b[i]);
  const react = {
    createElement: (type: unknown, attributes: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: attributes ?? {}, children }),
    Fragment: 'fragment',
    useState: (initial: unknown) => {
      const i = slot++;
      slots[i] ??= { value: initial };
      return [slots[i].value, (next: unknown) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useRef: (initial: unknown) => {
      const i = slot++;
      slots[i] ??= { value: { current: initial } };
      return slots[i].value;
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const i = slot++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: callback, deps };
      return slots[i].value;
    },
    useEffect: (run: () => (() => void) | undefined, deps: unknown[]) => {
      const i = slot++;
      if (!slots[i] || changed(slots[i].deps, deps)) {
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: run() };
        });
      }
    },
  };
  const fetch = async (input: string) => {
    const url = new URL(input, 'http://localhost');
    requests.push(url);
    return respond(url);
  };
  const modules: Record<string, unknown> = {
    react,
    'next/navigation': { useSearchParams: () => new URLSearchParams('range=1h') },
    '../auth/AuthProvider': { useAuth: () => ({ apiFetch: fetch }) },
    '../../shared/datetime.ts': datetime,
    '../../lib/batch-wizard.ts': wizard,
    '../../lib/api/history.ts': history,
  };
  const exports: { default?: (props: unknown) => unknown } = {};
  runInNewContext(compiled, {
    exports, require: (name: string) => {
      assert.ok(name in modules, `Unexpected import ${name}`);
      return modules[name];
    },
    URLSearchParams, AbortController, Blob,
    setInterval: (cb: () => void) => { intervals.add(cb); return cb; },
    clearInterval: (cb: () => void) => intervals.delete(cb),
    setTimeout: (cb: () => void) => { timeouts.add(cb); return cb; },
    clearTimeout: (cb: () => void) => timeouts.delete(cb),
    document: {
      hidden: false, addEventListener() {}, removeEventListener() {},
      body: { appendChild() {}, removeChild() {} },
      createElement: () => {
        const link = { href: '', download: '', click: () => downloads.push(link.download) };
        return link;
      },
    },
    window: { URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } },
  });
  const render = () => {
    slot = 0;
    effects = [];
    tree = exports.default!(props);
    for (const effect of effects) effect();
  };
  function nodes(value: unknown = tree): Node[] {
    if (Array.isArray(value)) return value.flatMap((v) => nodes(v));
    if (!value || typeof value !== 'object' || !('children' in value)) return [];
    const node = value as Node;
    return [node, ...node.children.flatMap((v) => nodes(v))];
  }
  function text(value: unknown = tree): string {
    if (Array.isArray(value)) return value.map(text).join('');
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object' && 'children' in value) return text((value as Node).children);
    return '';
  }
  const flush = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    render();
  };
  const click = (label: string) => {
    const button = nodes().find((n) => n.type === 'button' && (text(n).trim() === label || n.props['aria-label'] === label));
    assert.ok(button, `Tombol ${label}`);
    assert.ok(!button.props.disabled, `Tombol ${label} harus aktif`);
    (button.props.onClick as () => void)();
    render();
  };
  const input = (label: string, value: string) => {
    const field = nodes().find((n) => n.type === 'input' && n.props['aria-label'] === label);
    assert.ok(field, `Input ${label}`);
    (field.props.onChange as (e: unknown) => void)({ target: { value } });
    render();
  };
  const range = (from: string, to: string) => {
    input('Dari tanggal dan jam (WIB)', from);
    input('Sampai tanggal dan jam (WIB)', to);
  };
  render();
  return {
    requests, downloads, props, render, flush, click, input, range, text,
    setRespond: (fn: typeof respond) => { respond = fn; },
    tick: async () => {
      for (const cb of timeouts) cb();
      timeouts.clear();
      for (const cb of intervals) cb();
      await flush();
    },
  };
}

test('input adalah draf; hasil dan CSV tetap memakai rentang WIB dan snapshot yang diterapkan', async () => {
  const ui = setup();
  ui.click('Tabel Riwayat');
  await ui.flush();
  ui.range('2026-10-23T20:10', '2026-10-23T20:25');
  await ui.tick();
  assert.equal(ui.requests.length, 1, 'Mengetik tidak otomatis mengganti tabel');
  ui.click('Terapkan Rentang');
  await ui.flush();
  const applied = ui.requests.at(-1)!;
  assert.equal(applied.searchParams.get('from'), '2026-10-23T13:10:00.000Z');
  assert.equal(applied.searchParams.get('to'), '2026-10-23T13:25:00.000Z');
  ui.props.activeDeviceId = 'device-new';
  ui.render();
  await ui.tick();
  assert.equal(ui.requests.length, 2, 'Data live/timer tidak mengganti hasil');
  ui.range('2026-10-24T01:00', '2026-10-24T02:00');
  ui.click('Unduh CSV Rentang Ini');
  await ui.flush();
  const csv = ui.requests.at(-1)!;
  assert.equal(csv.searchParams.get('from'), applied.searchParams.get('from'));
  assert.equal(csv.searchParams.get('to'), applied.searchParams.get('to'));
  assert.equal(csv.searchParams.get('timeZone'), 'Asia/Jakarta');
  assert.equal(csv.searchParams.get('snapshotWatermark'), '42');
  assert.equal(csv.searchParams.get('deviceId'), 'device-original');
  assert.match(ui.downloads[0], /2026-10-23_20-10-00_sampai_2026-10-23_20-25-00_WIB/);
  ui.click('Muat ulang data pada rentang ini');
  await ui.flush();
  assert.equal(ui.requests.at(-1)!.searchParams.get('from'), applied.searchParams.get('from'));
  assert.equal(ui.requests.at(-1)!.searchParams.get('snapshotWatermark'), null);
  ui.click('Tutup riwayat');
  ui.click('Unduh CSV Rentang Terpilih');
  await ui.flush();
  assert.equal(ui.requests.at(-1)!.searchParams.get('from'), applied.searchParams.get('from'));
  assert.equal(ui.requests.at(-1)!.searchParams.get('deviceId'), 'device-original');
});

test('respons rentang lama yang datang belakangan tidak menimpa hasil rentang terbaru', async () => {
  const ui = setup();
  ui.click('Tabel Riwayat');
  await ui.flush();
  const pending: Array<(res: Response) => void> = [];
  ui.setRespond(() => new Promise<Response>((resolve) => pending.push(resolve)));
  ui.range('2026-10-23T20:10', '2026-10-23T20:25');
  ui.click('Terapkan Rentang');
  ui.range('2026-10-24T20:10', '2026-10-24T20:25');
  ui.click('Terapkan Rentang');
  pending[1](response(payload('2026-10-24T13:15:00.000Z', '200')));
  await ui.flush();
  pending[0](response(payload('2026-10-23T13:15:00.000Z', '100')));
  await ui.flush();
  assert.ok(ui.text().includes('24/10/2026 20:15:00 WIB'));
  assert.ok(!ui.text().includes('23/10/2026 20:15:00 WIB'));
});

test('halaman berikut/kembali tetap memakai batas waktu, perangkat, dan snapshot yang sama', async () => {
  const ui = setup();
  ui.setRespond((url) => Response.json({
    ...payload(), meta: { snapshotWatermark: '42', nextCursor: url.searchParams.has('cursor') ? null : 'page-2' },
  }));
  ui.click('Tabel Riwayat');
  await ui.flush();
  const first = ui.requests[0];
  ui.props.activeDeviceId = 'device-new';
  ui.render();
  ui.click('Berikutnya →');
  await ui.flush();
  ui.click('← Kembali');
  await ui.flush();
  for (const page of ui.requests.slice(1)) {
    assert.equal(page.searchParams.get('from'), first.searchParams.get('from'));
    assert.equal(page.searchParams.get('to'), first.searchParams.get('to'));
    assert.equal(page.searchParams.get('snapshotWatermark'), '42');
    assert.equal(page.searchParams.get('deviceId'), 'device-original');
  }
  assert.equal(ui.requests.at(-1)!.searchParams.get('cursor'), null);
});
