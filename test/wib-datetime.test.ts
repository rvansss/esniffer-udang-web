import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWibDateTime,
  formatWibTime,
  toWibIso,
  toWibParts,
  wibDateTimeLocal,
} from '../shared/datetime.ts';
import { parseWibInput } from '../lib/batch-wizard.ts';

test('UI, input riwayat, dan CSV tetap WIB lintas zona perangkat dan batas tanggal', () => {
  const originalZone = process.env.TZ;
  const cases = [
    { utc: '2026-10-24T00:00:00.123Z', local: '2026-10-24T07:00', display: '24/10/2026 07:00:00 WIB' },
    { utc: '2026-12-31T17:30:45.678Z', local: '2027-01-01T00:30', display: '01/01/2027 00:30:45 WIB' },
    { utc: '2026-03-08T18:59:59.999Z', local: '2026-03-09T01:59', display: '09/03/2026 01:59:59 WIB' },
  ];
  try {
    for (const zone of ['Asia/Jakarta', 'UTC', 'Asia/Makassar', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      for (const { utc, local, display } of cases) {
        const instant = new Date(utc);
        assert.equal(wibDateTimeLocal(instant), local, zone);
        assert.equal(formatWibDateTime(instant, true), display, zone);
        const inputDate = parseWibInput(local).date;
        assert.ok(inputDate);
        assert.equal(inputDate.toISOString(), utc.slice(0, 16) + ':00.000Z', zone);
        assert.equal(toWibIso(instant), `${local}:${utc.slice(17, 23)}+07:00`, zone);
        assert.equal(new Date(toWibIso(instant)).toISOString(), utc, zone);
      }
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test('format jam grafik dan notifikasi menyatakan WIB dengan ketelitian yang sesuai', () => {
  const instant = new Date('2026-10-23T20:05:09.000Z');
  assert.equal(formatWibTime(instant), '03:05:09 WIB');
  assert.equal(formatWibTime(instant, { seconds: false, label: false }), '03:05');
  assert.equal(formatWibTime(instant, { label: false }), '03:05:09');
  assert.equal(formatWibDateTime(instant), '24/10/2026 03:05 WIB');
  assert.deepEqual(toWibParts(instant), { date: '2026-10-24', time: '03:05:09' });
});
