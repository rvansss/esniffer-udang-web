import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  applyServerTime,
  applyServerTimeFromHeader,
  hasServerClock,
  resetClientClockForTests,
  serverClockOffsetMs,
  serverNowMs,
  subscribeClientClock,
} from '../lib/client-clock.ts';

/**
 * Jam klien yang diselaraskan ke server.
 *
 * Yang dijaga di sini adalah janji yang membuat hitungan mundur kalibrasi sama
 * di laptop dan HP: hitungan memakai "sekarang" versi server, bukan jam
 * perangkat. Sampel jam datang dari header `x-server-time` pada setiap respons
 * (lihat `lib/api/response.ts` dan `apiFetch` di AuthProvider).
 */

const L = 1_700_000_000_000; // jam perangkat contoh (epoch ms)
const DAY = 24 * 60 * 60 * 1000;

describe('Jam server di sisi klien', () => {
  beforeEach(() => {
    resetClientClockForTests();
  });

  it('sebelum ada sampel: jam perangkat dipakai apa adanya', () => {
    assert.strictEqual(hasServerClock(), false);
    assert.strictEqual(serverClockOffsetMs(), 0);
    assert.strictEqual(serverNowMs(L), L);
  });

  it('offset dihitung dari titik tengah permintaan, bukan waktu terima', () => {
    // Server 20 detik di depan perangkat; RTT 200 ms.
    applyServerTime(L + 20_100, L, L + 200);
    assert.strictEqual(serverClockOffsetMs(), 20_000);
    // Saat respons diterima, jam server sudah lewat 100 ms dari titik tengah.
    assert.strictEqual(serverNowMs(L + 200), L + 20_200);
  });

  it('sampel dengan RTT lebih kecil dipertahankan, sampel yang lebih lambat diabaikan', () => {
    applyServerTime(L + 20_000, L, L + 500); // RTT 500 → offset 19_750
    assert.strictEqual(serverClockOffsetMs(), 19_750);

    applyServerTime(L + 30_050, L + 10_000, L + 10_100); // RTT 100 → offset 20_000
    assert.strictEqual(serverClockOffsetMs(), 20_000, 'sampel lebih cepat menggantikan');

    applyServerTime(L + 60_500, L + 20_000, L + 21_000); // RTT 1000 → offset 40_000
    assert.strictEqual(serverClockOffsetMs(), 20_000, 'sampel lebih lambat tidak dipakai');
  });

  it('sampel basi diganti walau RTT-nya lebih buruk', () => {
    applyServerTime(L + 30_050, L + 10_000, L + 10_100); // offset 20_000
    const laterReceived = L + 10_100 + 120_001;
    const sent = laterReceived - 1_000;
    const midpoint = (sent + laterReceived) / 2;
    applyServerTime(midpoint + 25_000, sent, laterReceived);
    assert.strictEqual(serverClockOffsetMs(), 25_000, 'pergeseran jam perangkat tetap terikuti');
  });

  it('nilai tidak masuk akal diabaikan, sampel lama tetap dipakai', () => {
    applyServerTime(L + 20_100, L, L + 200);
    const before = serverClockOffsetMs();

    applyServerTime(L + 8 * DAY, L, L + 10); // 8 hari: di luar batas wajar
    assert.strictEqual(serverClockOffsetMs(), before);

    applyServerTime(Number.NaN, L, L + 10);
    applyServerTime(-1, L, L + 10);
    applyServerTime(L + 20_000, Number.NaN, L + 10);
    assert.strictEqual(serverClockOffsetMs(), before);
  });

  it('header tidak sah dilewati tanpa error; header sah dipakai', () => {
    for (const bad of [null, undefined, '', '   ', 'bukan-angka', 'NaN']) {
      applyServerTimeFromHeader(bad, L, L + 200);
    }
    assert.strictEqual(hasServerClock(), false);

    applyServerTimeFromHeader(String(L + 20_100), L, L + 200);
    assert.strictEqual(serverClockOffsetMs(), 20_000);
    assert.strictEqual(hasServerClock(), true);
  });

  it('pendengar dipanggil hanya saat angka yang dipakai hitungan berubah', () => {
    let calls = 0;
    subscribeClientClock(() => {
      calls += 1;
    });

    applyServerTime(L + 20_100, L, L + 200);
    assert.strictEqual(calls, 1, 'offset pertama memicu render ulang');

    // Offset sama, RTT lebih baik: sampel diganti tanpa mengubah hitungan.
    applyServerTime(L + 30_050, L + 10_000, L + 10_100);
    assert.strictEqual(calls, 1);

    applyServerTime(L + 60_050, L + 20_000, L + 20_100);
    assert.strictEqual(calls, 2);
  });

  it('reset mengosongkan sampel (dipakai antar-test)', () => {
    applyServerTime(L + 20_100, L, L + 200);
    resetClientClockForTests();
    assert.strictEqual(hasServerClock(), false);
    assert.strictEqual(serverClockOffsetMs(), 0);
  });
});
