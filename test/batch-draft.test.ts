import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  saveBatchDraft,
  loadBatchDraft,
  removeBatchDraft,
  draftMeaningful,
  DRAFT_MAX_AGE_MS,
  BATCH_DRAFT_KEY,
  type BatchDraft,
} from '../lib/batch-draft.ts';

/** Stub localStorage minimal (node tidak punya localStorage bawaan). */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const DRAFT_KEY = BATCH_DRAFT_KEY;

describe('Batch draft (revisi putaran 2, butir 13)', () => {
  const before = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage;
  });
  after(() => {
    globalThis.localStorage = before;
  });

  const filled: BatchDraft = {
    step: 1,
    procuredAt: '2099-02-02T07:10',
    marketSource: 'Pasar Harapan Jaya',
    sourceType: 'market',
    shrimpCount: '12',
    totalWeightG: '485.5',
    coolerMarket: '1.2',
    coolerLab: '3.8',
  };

  it('simpan lalu muat kembali mengembalikan nilai yang sama', () => {
    saveBatchDraft(filled);
    const loaded = loadBatchDraft();
    assert.ok(loaded);
    assert.strictEqual(loaded.marketSource, filled.marketSource);
    assert.strictEqual(loaded.shrimpCount, filled.shrimpCount);
    assert.strictEqual(loaded.coolerLab, filled.coolerLab);
    assert.strictEqual(loaded.step, filled.step);
  });

  it('penyimpan menandai cap waktu sehingga umur draf bisa dinilai', () => {
    saveBatchDraft(filled);
    const loaded = loadBatchDraft();
    assert.strictEqual(typeof loaded?.savedAt, 'number');
    assert.ok(Math.abs(Date.now() - (loaded?.savedAt ?? 0)) < 5_000);
  });

  it('draf bermakna bila ada ketikan nyata; nilai bawaan dan waktu otomatis tidak dihitung', () => {
    assert.ok(draftMeaningful(filled));
    // Waktu dari jam device selalu terisi otomatis — bukan tanda user mengetik.
    assert.strictEqual(draftMeaningful({ procuredAt: '2099-02-02T07:00', arrivedAt: '2099-02-02T07:10' }), false);
    assert.strictEqual(draftMeaningful({ step: 2, shrimpTemperatures: [] }), false);
    assert.strictEqual(draftMeaningful({}), false);
    // Nilai bawaan form juga bukan isian pengguna.
    assert.strictEqual(
      draftMeaningful({ sourceType: 'market', shrimpCount: '10', initialCondition: 'dead' }),
      false
    );
    // Jumlah di luar nilai bawaan dianggap isian pengguna.
    assert.ok(draftMeaningful({ shrimpCount: '12' }));
    assert.ok(draftMeaningful({ sourceType: 'supermarket' }));
  });

  it('simpan draf kosong menghapus penyimpanan lama', () => {
    saveBatchDraft(filled);
    saveBatchDraft({ step: 0 });
    assert.strictEqual(loadBatchDraft(), null);
  });

  it('hapus draf membuat muat kembali null', () => {
    saveBatchDraft(filled);
    removeBatchDraft();
    assert.strictEqual(loadBatchDraft(), null);
    removeBatchDraft(); // tanpa error walau sudah tak ada
  });

  it('JSON rusak di penyimpanan mengembalikan null tanpa melempar', () => {
    globalThis.localStorage.setItem(DRAFT_KEY, '{teu lengkap');
    assert.strictEqual(loadBatchDraft(), null);
  });

  it('draf versi kunci lama diabaikan, bukan dibaca bentrok', () => {
    globalThis.localStorage.setItem(
      'esniffer:batch-draft-v1',
      JSON.stringify({ marketSource: 'Pasar Versi Lama', savedAt: Date.now() })
    );
    assert.strictEqual(loadBatchDraft(), null);
  });

  it('draf tanpa cap waktu (skema lama) dibuang saat dimuat', () => {
    globalThis.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ marketSource: 'Pasar Tanpa Cap Waktu' })
    );
    assert.strictEqual(loadBatchDraft(), null);
    // Sekalian hilang dari penyimpanan.
    assert.strictEqual(globalThis.localStorage.getItem(DRAFT_KEY), null);
  });

  it('draf kedaluwarsa dibuang; draf yang masih muda dikembalikan', () => {
    globalThis.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ marketSource: 'Pasar Lama', savedAt: Date.now() - DRAFT_MAX_AGE_MS - 1000 })
    );
    assert.strictEqual(loadBatchDraft(), null);
    assert.strictEqual(globalThis.localStorage.getItem(DRAFT_KEY), null);

    globalThis.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ marketSource: 'Pasar Baru', savedAt: Date.now() - 1000 })
    );
    assert.strictEqual(loadBatchDraft()?.marketSource, 'Pasar Baru');
  });

  it('draf milik pengguna lain diabaikan dan tidak dihapus', () => {
    saveBatchDraft({ ...filled, userId: 'user-a' });
    assert.strictEqual(loadBatchDraft('user-a')?.marketSource, filled.marketSource);
    assert.strictEqual(loadBatchDraft('user-b'), null);
    // Draf pemilik asli masih utuh.
    assert.strictEqual(loadBatchDraft('user-a')?.marketSource, filled.marketSource);
  });

  it('caption foto ikut tersimpan tanpa berkas foto', () => {
    saveBatchDraft({
      ...filled,
      batchCaptions: ['Di pasar'],
      groupingCaptions: ['Di chamber'],
    });
    const loaded = loadBatchDraft();
    assert.deepStrictEqual(loaded?.batchCaptions, ['Di pasar']);
    assert.deepStrictEqual(loaded?.groupingCaptions, ['Di chamber']);
    // Tidak ada berkas foto di draf.
    assert.strictEqual((loaded as Record<string, unknown> | null)?.files, undefined);
  });

  it('pengukuran per ekor dan jumlah sampel per suhu ikut tersimpan', () => {
    saveBatchDraft({
      ...filled,
      visualCheck: 'melanosis',
      sampleShrimpCountRoomTemp: '4',
      sampleShrimpCountCold: '3',
      shrimpTemperatures: ['2.5', '', '2.6'],
      shrimpLengths: ['12.5', '13', ''],
    });
    const loaded = loadBatchDraft();
    assert.deepStrictEqual(loaded?.shrimpTemperatures, ['2.5', '', '2.6']);
    assert.deepStrictEqual(loaded?.shrimpLengths, ['12.5', '13', '']);
    assert.strictEqual(loaded?.sampleShrimpCountRoomTemp, '4');
    assert.strictEqual(loaded?.sampleShrimpCountCold, '3');
    assert.strictEqual(loaded?.visualCheck, 'melanosis');
  });

  it('baris pengukuran terisi dianggap isi draf; jumlah sampel bawaan tidak', () => {
    assert.strictEqual(draftMeaningful({ shrimpTemperatures: ['', ''] }), false);
    assert.ok(draftMeaningful({ shrimpTemperatures: ['2.5'] }));
    assert.ok(draftMeaningful({ shrimpLengths: ['12.5'] }));
    assert.strictEqual(
      draftMeaningful({ sampleShrimpCountRoomTemp: '4', sampleShrimpCountCold: '4', visualCheck: 'normal' }),
      false
    );
    assert.ok(draftMeaningful({ sampleShrimpCountCold: '3' }));
    assert.ok(draftMeaningful({ visualCheck: 'damaged' }));
  });

  it('localStorage tidak tersedia: semua operasi aman', () => {
    globalThis.localStorage = undefined as unknown as Storage;
    saveBatchDraft(filled);
    assert.strictEqual(loadBatchDraft(), null);
    removeBatchDraft();
    globalThis.localStorage = new MemoryStorage() as unknown as Storage;
  });
});
