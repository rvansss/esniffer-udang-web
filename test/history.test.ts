/**
 * Pengujian mapper tabel Riwayat telemetri.
 * Mencegah regresi crash `undefined.toFixed(1)`: API history memakai
 * bentuk bersarang (`values.temperatureC.value`), bukan angka datar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { toHistoryRow, toHistoryRows, nextCursorOf } from '../lib/api/history.ts';

function apiRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reading-1',
    measuredAt: '2026-10-09T06:00:00.000Z',
    measurementTimeQuality: 'SYNCED',
    values: {
      temperatureC: { value: 27.125, unit: '°C', quality: 'ok' },
      humidityPercent: { value: 78.25, unit: '%RH', quality: 'ok' },
      mq137Raw: { value: 1834, unit: 'raw', quality: 'ok' },
      mq136Raw: { value: 2100, unit: 'raw', quality: 'ok' },
      mq4Raw: { value: 912, unit: 'raw', quality: 'ok' },
    },
    ...overrides,
  };
}

test('History: baris API bersarang diratakan untuk tabel', () => {
  const row = toHistoryRow(apiRow());
  assert.ok(row);
  assert.strictEqual(row.id, 'reading-1');
  assert.strictEqual(row.measuredAt, '2026-10-09T06:00:00.000Z');
  assert.strictEqual(row.temperatureC, 27.125);
  assert.strictEqual(row.humidityPercent, 78.25);
  assert.strictEqual(row.mq137Raw, 1834);
  assert.strictEqual(row.mq136Raw, 2100);
  assert.strictEqual(row.mq4Raw, 912);
  assert.strictEqual(row.measurementTimeQuality, 'SYNCED');
});

test('History: nilai hilang atau bukan angka menjadi null, bukan crash', () => {
  const row = toHistoryRow(
    apiRow({
      measuredAt: null,
      measurementTimeQuality: null,
      values: {
        temperatureC: { value: null, quality: 'sensor_error' },
        humidityPercent: null,
        mq137Raw: { value: '1834', quality: 'ok' },
        mq136Raw: { value: NaN, quality: 'ok' },
        mq4Raw: { value: Infinity, quality: 'ok' },
      },
    })
  );
  assert.ok(row);
  assert.strictEqual(row.measuredAt, null);
  assert.strictEqual(row.temperatureC, null);
  assert.strictEqual(row.humidityPercent, null);
  assert.strictEqual(row.mq137Raw, null);
  assert.strictEqual(row.mq136Raw, null);
  assert.strictEqual(row.mq4Raw, null);
  assert.strictEqual(row.measurementTimeQuality, 'UNKNOWN');
});

test('History: kursor hilang atau bukan string dibaca null', () => {
  assert.strictEqual(nextCursorOf({}), null);
  assert.strictEqual(nextCursorOf(null), null);
  assert.strictEqual(nextCursorOf({ meta: null }), null);
  assert.strictEqual(nextCursorOf({ meta: {} }), null);
  assert.strictEqual(nextCursorOf({ meta: { nextCursor: '' } }), null);
  assert.strictEqual(nextCursorOf({ meta: { nextCursor: 42 } }), null);
  assert.strictEqual(nextCursorOf({ meta: { nextCursor: 'abc123' } }), 'abc123');
});
test('History: entri rusak dilewati, payload bukan array jadi kosong', () => {
  assert.strictEqual(toHistoryRow(null), null);
  assert.strictEqual(toHistoryRow('reading-1'), null);
  assert.strictEqual(toHistoryRow({ measuredAt: 'x' }), null);
  assert.deepStrictEqual(toHistoryRows({}), []);
  assert.deepStrictEqual(toHistoryRows(null), []);
  assert.deepStrictEqual(toHistoryRows({ data: [apiRow(), null, { id: 'r2' }] }), [
    {
      id: 'reading-1',
      measuredAt: '2026-10-09T06:00:00.000Z',
      temperatureC: 27.125,
      humidityPercent: 78.25,
      mq137Raw: 1834,
      mq136Raw: 2100,
      mq4Raw: 912,
      measurementTimeQuality: 'SYNCED',
    },
    {
      id: 'r2',
      measuredAt: null,
      temperatureC: null,
      humidityPercent: null,
      mq137Raw: null,
      mq136Raw: null,
      mq4Raw: null,
      measurementTimeQuality: 'UNKNOWN',
    },
  ]);
});
