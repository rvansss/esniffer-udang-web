/**
 * Kontrak pengelompokan wizard → API create batch, murni tanpa DB.
 *
 * Klien baru (wizard) mengirim jumlah udang per sesi terpisah untuk suhu ruang
 * (SR) dan suhu dingin (SD); klien lama hanya mengirim satu nilai. Keduanya
 * harus menghasilkan dua grup dengan jumlah yang benar, jadi jalur ini diuji
 * lewat transaksi tiruan (tidak ada I/O PostgreSQL).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Prisma } from '@prisma/client';
import { createBatchGroups, parseBatchGrouping, parseGrouping } from '../lib/dataset/groups.ts';

interface GroupRow {
  groupId: string;
  batchId: string;
  storageCondition: string;
  targetTempC: number;
  coldStorageMode: string;
  visualCheck: string;
  sampleShrimpCount: number;
}

/** Transaksi tiruan: menangkap baris yang akan ditulis `createMany`. */
function fakeTx() {
  const calls: GroupRow[][] = [];
  const tx = {
    sampleGroup: {
      createMany: async (args: { data: GroupRow[] }) => {
        calls.push(args.data);
        return { count: args.data.length };
      },
    },
  };
  return { calls, tx: tx as unknown as Prisma.TransactionClient };
}

const BATCH_ID = 'BT-20261021-01';

describe('pengelompokan batch dari wizard (jumlah per kondisi simpan)', () => {
  it('jumlah per suhu ruang & dingin dipetakan ke grup yang tepat', async () => {
    const grouping = parseBatchGrouping({
      visualCheck: 'melanosis',
      sampleShrimpCount: 4,
      sampleShrimpCountRoomTemp: 5,
      sampleShrimpCountCold: 3,
    });
    assert.deepStrictEqual(grouping, { visualCheck: 'MELANOSIS', roomTempCount: 5, coldCount: 3 });

    const { calls, tx } = fakeTx();
    await createBatchGroups(tx, BATCH_ID, grouping);
    assert.strictEqual(calls.length, 1);
    const rows = calls[0];
    assert.strictEqual(rows.length, 2);
    const sr = rows.find((row) => row.storageCondition === 'ROOM_TEMP');
    const sd = rows.find((row) => row.storageCondition === 'COLD');
    assert.ok(sr && sd);
    assert.strictEqual(sr.groupId, `${BATCH_ID}-SR`);
    assert.strictEqual(sd.groupId, `${BATCH_ID}-SD`);
    assert.strictEqual(sr.sampleShrimpCount, 5);
    assert.strictEqual(sd.sampleShrimpCount, 3);
    // Temuan visual berlaku untuk kedua grup.
    assert.strictEqual(sr.visualCheck, 'MELANOSIS');
    assert.strictEqual(sd.visualCheck, 'MELANOSIS');
    assert.strictEqual(sr.targetTempC, 25);
    assert.strictEqual(sd.targetTempC, 4);
  });

  it('kiriman lama tanpa nilai per suhu tetap menghasilkan dua grup bernilai sama', async () => {
    const { calls, tx } = fakeTx();
    await createBatchGroups(
      tx,
      BATCH_ID,
      parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCount: 4 })
    );
    assert.deepStrictEqual(
      calls[0].map((row) => row.sampleShrimpCount).sort(),
      [4, 4]
    );
  });

  it('salah satu nilai per suhu boleh ditimpa sendiri', () => {
    assert.deepStrictEqual(
      parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCount: 3, sampleShrimpCountCold: 5 }),
      { visualCheck: 'NORMAL', roomTempCount: 3, coldCount: 5 }
    );
    assert.deepStrictEqual(
      parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCount: 3, sampleShrimpCountRoomTemp: 5 }),
      { visualCheck: 'NORMAL', roomTempCount: 5, coldCount: 3 }
    );
  });

  it('wizard boleh mengirim dua nilai per suhu tanpa nilai dasar', () => {
    // Payload wizard nyata: hanya visual + jumlah SR dan SD.
    assert.deepStrictEqual(
      parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCountRoomTemp: 4, sampleShrimpCountCold: 5 }),
      { visualCheck: 'NORMAL', roomTempCount: 4, coldCount: 5 }
    );
    // Hanya salah satu grup diisi: nilai itu dipakai juga oleh grup lainnya.
    assert.deepStrictEqual(
      parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCountCold: 5 }),
      { visualCheck: 'NORMAL', roomTempCount: 5, coldCount: 5 }
    );
  });

  it('jumlah per suhu bebas batas domain: cukup bilangan bulat ≥ 1 dan visual sah', () => {
    // Nilai di luar acuan 1–10 ekor tetap diterima API (peringatan hanya di UI).
    assert.deepStrictEqual(parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCount: 2 }), {
      visualCheck: 'NORMAL',
      roomTempCount: 2,
      coldCount: 2,
    });
    assert.deepStrictEqual(parseBatchGrouping({ visualCheck: 'normal', sampleShrimpCount: 9 }), {
      visualCheck: 'NORMAL',
      roomTempCount: 9,
      coldCount: 9,
    });
    for (const invalid of [
      { visualCheck: 'normal', sampleShrimpCount: 0 },
      { visualCheck: 'normal', sampleShrimpCount: -3 },
      { visualCheck: 'normal', sampleShrimpCount: 1.5 },
      { visualCheck: 'normal', sampleShrimpCount: 4, sampleShrimpCountRoomTemp: 0 },
      { visualCheck: 'normal', sampleShrimpCount: 4, sampleShrimpCountCold: '4' },
      // Tanpa satu pun jumlah udang per sesi, grouping dianggap tidak lengkap.
      { visualCheck: 'normal' },
      { visualCheck: 'busuk', sampleShrimpCount: 4 },
      { sampleShrimpCount: 4 },
    ]) {
      assert.throws(() => parseBatchGrouping(invalid), Error, JSON.stringify(invalid));
    }
  });

  it('parseGrouping lama (PATCH) tidak berubah: satu nilai saja', () => {
    assert.deepStrictEqual(parseGrouping({ visualCheck: 'normal', sampleShrimpCount: 4 }), {
      visualCheck: 'NORMAL',
      sampleShrimpCount: 4,
    });
    assert.throws(() => parseGrouping({ visualCheck: 'normal' }), /sampleShrimpCount/);
  });
});
