import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseFormNumber,
  parseWibInput,
  stepOfField,
  validateGroupFields,
  validateGroupForm,
  groupWeightWarning,
  validateStepA,
  validateStepB,
  validateStepC,
  wibInputToUtcIso,
} from '../lib/batch-wizard.ts';
import { wibDateTimeLocal } from '../shared/dataset.ts';

/** Nilai langkah 1 yang sah, dipakai sebagai basis tiap kasus. */
const stepAOk = {
  departedAt: '2026-10-21T05:30',
  coolerDeparture: '1.0',
  marketSource: 'Pasar Induk Kramat Jati',
  sourceType: 'market',
};

/** Nilai langkah 2 yang sah (berangkat 05:30 → beli 07:00 → tiba 07:50). */
const stepBOk = {
  departedAt: '2026-10-21T05:30',
  procuredAt: '2026-10-21T07:00',
  arrivedAt: '2026-10-21T07:50',
  shrimpType: 'vaname',
  shrimpCount: '12',
  shrimpLengthCm: '12.5',
  totalWeightG: '480',
  initialTempC: '2.5',
  coolerMarket: '2.5',
  coolerLab: '3',
  deviationAck: false,
};

const groupOk = {
  labTempC: '7.7',
  visualCheck: 'normal',
  labWeightBeforeG: '482',
  labWeightAfterG: '478.5',
  sampleShrimpCount: '4',
};

describe('lib/batch-wizard: validator per langkah wizard batch (butir 12)', () => {
  describe('langkah 1 — keberangkatan & sumber', () => {
    it('nilai sah tidak menghasilkan galat', () => {
      assert.deepStrictEqual(validateStepA(stepAOk), {});
    });

    it('jam berangkat kosong dan di luar jendela 05:00–08:00 WIB ditolak', () => {
      assert.strictEqual(validateStepA({ ...stepAOk, departedAt: '' }).departedAt, 'Wajib diisi.');
      assert.match(
        validateStepA({ ...stepAOk, departedAt: '2026-10-21T04:30' }).departedAt ?? '',
        /05:00–08:00 WIB/
      );
      assert.match(
        validateStepA({ ...stepAOk, departedAt: '2026-10-21T08:30' }).departedAt ?? '',
        /05:00–08:00 WIB/
      );
      assert.strictEqual(validateStepA({ ...stepAOk, departedAt: '2026-10-21T05:00' }).departedAt, undefined);
      assert.strictEqual(validateStepA({ ...stepAOk, departedAt: '2026-10-21T08:00' }).departedAt, undefined);
    });

    it('suhu cool box saat berangkat wajib dan dibatasi -10..10 °C', () => {
      const msg = 'Harus -10 sampai 10 °C.';
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '' }).coolerDeparture, 'Wajib diisi.');
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '-10.1' }).coolerDeparture, msg);
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '10.1' }).coolerDeparture, msg);
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '-10' }).coolerDeparture, undefined);
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '10' }).coolerDeparture, undefined);
    });

    it('sumber wajib diisi dan maksimal 100 karakter', () => {
      assert.strictEqual(validateStepA({ ...stepAOk, marketSource: '  ' }).marketSource, 'Wajib diisi.');
      assert.strictEqual(
        validateStepA({ ...stepAOk, marketSource: 'x'.repeat(101) }).marketSource,
        'Maksimal 100 karakter.'
      );
    });

    it('jenis sumber wajib salah satu nilai kontrak', () => {
      assert.strictEqual(validateStepA({ ...stepAOk, sourceType: '' }).sourceType, 'Wajib dipilih.');
      assert.strictEqual(validateStepA({ ...stepAOk, sourceType: 'toko' }).sourceType, 'Wajib dipilih.');
      assert.strictEqual(validateStepA({ ...stepAOk, sourceType: 'farm' }).sourceType, undefined);
    });
  });

  describe('langkah 2 — pembelian, kedatangan & kondisi', () => {
    it('nilai sah tidak menghasilkan galat', () => {
      assert.deepStrictEqual(validateStepB(stepBOk), {});
    });

    it('jam beli kosong dan di luar jendela 05:00–08:00 WIB ditolak', () => {
      assert.strictEqual(validateStepB({ ...stepBOk, procuredAt: '' }).procuredAt, 'Wajib diisi.');
      assert.match(
        validateStepB({ ...stepBOk, procuredAt: '2026-10-21T04:59' }).procuredAt ?? '',
        /05:00–08:00 WIB/
      );
      assert.match(
        validateStepB({ ...stepBOk, procuredAt: '2026-10-21T08:01' }).procuredAt ?? '',
        /05:00–08:00 WIB/
      );
    });

    it('jam tiba juga wajib di jendela 05:00–08:00 WIB', () => {
      assert.match(
        validateStepC({ ...stepBOk, ...groupOk, arrivedAt: '2026-10-21T08:30' }).arrivedAt ?? '',
        /05:00–08:00 WIB/
      );
    });

    it('jam beli harus setelah jam berangkat', () => {
      const errs = validateStepB({ ...stepBOk, procuredAt: '2026-10-21T05:30' });
      assert.match(errs.procuredAt ?? '', /harus setelah tanggal dan jam berangkat/);
    });

    it('jenis udang wajib dipilih (vaname atau windu)', () => {
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpType: '' }).shrimpType, 'Wajib memilih Vaname atau Windu.');
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpType: 'lobster' }).shrimpType, 'Wajib memilih Vaname atau Windu.');
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpType: 'windu' }).shrimpType, undefined);
    });

    it('jam tiba harus setelah jam beli', () => {
      const errs = validateStepC({ ...stepBOk, ...groupOk, arrivedAt: '2026-10-21T06:30' });
      assert.match(errs.arrivedAt ?? '', /harus setelah tanggal dan jam beli/);
    });

    it('durasi lebih dari 3 jam butuh catatan deviasi', () => {
      // Lintas hari: satu-satunya cara melewati 3 jam tanpa keluar jendela.
      const slow = { ...stepBOk, arrivedAt: '2026-10-22T07:30' };
      assert.match(validateStepC({ ...slow, ...groupOk }).arrivedAt ?? '', /Melebihi 3 jam/);
      assert.strictEqual(validateStepC({ ...slow, ...groupOk, deviationAck: true }).arrivedAt, undefined);
    });

    it('jumlah udang minimal 10 ekor dan harus bilangan bulat', () => {
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpCount: '' }).shrimpCount, 'Wajib diisi.');
      assert.strictEqual(
        validateStepB({ ...stepBOk, shrimpCount: '9' }).shrimpCount,
        'Minimal 10 ekor (bilangan bulat).'
      );
      assert.strictEqual(
        validateStepB({ ...stepBOk, shrimpCount: '12.5' }).shrimpCount,
        'Minimal 10 ekor (bilangan bulat).'
      );
    });

    it('panjang 1–50 cm dan berat > 0 sampai 2000 gram', () => {
      assert.strictEqual(
        validateStepB({ ...stepBOk, shrimpLengthCm: '0.5' }).shrimpLengthCm,
        'Harus 1 sampai 50 cm.'
      );
      assert.strictEqual(
        validateStepB({ ...stepBOk, totalWeightG: '0' }).totalWeightG,
        'Harus lebih dari 0 sampai 2000 gram.'
      );
      assert.strictEqual(
        validateStepB({ ...stepBOk, totalWeightG: '2001' }).totalWeightG,
        'Harus lebih dari 0 sampai 2000 gram.'
      );
    });

    it('suhu awal udang dan tiga suhu cool box dibatasi -10..10 °C', () => {
      const msg = 'Harus -10 sampai 10 °C.';
      assert.strictEqual(validateStepB({ ...stepBOk, initialTempC: '10.1' }).initialTempC, msg);
      assert.strictEqual(validateStepB({ ...stepBOk, initialTempC: '-10.1' }).initialTempC, msg);
      assert.strictEqual(validateStepB({ ...stepBOk, initialTempC: '-10' }).initialTempC, undefined);
      assert.strictEqual(validateStepB({ ...stepBOk, coolerMarket: '10.5' }).coolerMarket, msg);
      assert.strictEqual(validateStepC({ ...stepBOk, ...groupOk, coolerLab: '-10.5' }).coolerLab, msg);
      assert.strictEqual(validateStepB({ ...stepBOk, coolerMarket: '0' }).coolerMarket, undefined);
      assert.strictEqual(validateStepC({ ...stepBOk, ...groupOk, coolerLab: '4' }).coolerLab, undefined);
      assert.strictEqual(validateStepC({ ...stepBOk, ...groupOk, coolerLab: '' }).coolerLab, 'Wajib diisi.');
    });
  });

  describe('langkah C — Pengelompokan', () => {
    it('nilai sah tidak menghasilkan galat', () => {
      assert.deepStrictEqual(validateGroupForm('sr', groupOk), {});
    });

    it('galat memakai prefiks grup agar tidak saling tertimpa', () => {
      const errs = validateGroupForm('sd', { ...groupOk, labTempC: '', visualCheck: '' });
      assert.strictEqual(errs['sd-labTempC'], undefined);
      assert.strictEqual(errs['sd-visualCheck'], 'Wajib dipilih.');
      assert.strictEqual(errs['sr-labTempC'], undefined);
    });

    it('bobot sampel harus lebih dari 0 dan jumlah sampel 3–5 ekor', () => {
      const errs = validateGroupForm('sr', {
        ...groupOk,
        labWeightBeforeG: '0',
        labWeightAfterG: '-2',
        sampleShrimpCount: '2',
      });
      assert.strictEqual(errs['sr-labWeightBeforeG'], undefined);
      assert.strictEqual(errs['sr-labWeightAfterG'], undefined);
      assert.strictEqual(errs['sr-sampleShrimpCount'], 'Harus 3–5 ekor.');
    });
  });

  describe('pemetaan field ke langkah', () => {    it('field langkah 1/2/3 dipetakan dengan benar', () => {
      assert.strictEqual(stepOfField('departedAt'), 0);
      assert.strictEqual(stepOfField('coolerDeparture'), 0);
      assert.strictEqual(stepOfField('marketSource'), 0);
      assert.strictEqual(stepOfField('sourceType'), 0);
      assert.strictEqual(stepOfField('procuredAt'), 1);
      assert.strictEqual(stepOfField('shrimpType'), 1);
      assert.strictEqual(stepOfField('arrivedAt'), 2);
      assert.strictEqual(stepOfField('initialCondition'), 1);
      assert.strictEqual(stepOfField('shrimpCount'), 1);
      assert.strictEqual(stepOfField('coolerLab'), 2);
      assert.strictEqual(stepOfField('photos'), 1);
      assert.strictEqual(stepOfField('sr-labTempC'), 2);
      assert.strictEqual(stepOfField('sd-sampleShrimpCount'), 2);
    });
  });

  describe('waktu WIB (butir 5)', () => {
    it('input datetime-local dibaca sebagai WIB lalu disimpan sebagai UTC', () => {
      assert.strictEqual(wibInputToUtcIso('2026-10-21T07:00'), '2026-10-21T00:00:00.000Z');
      assert.strictEqual(parseWibInput('2026-10-21T07:00').date?.toISOString(), '2026-10-21T00:00:00.000Z');
    });

    it('nilai kosong dan format salah ditolak dengan pesan yang jelas', () => {
      assert.strictEqual(parseWibInput('').error, 'Wajib diisi.');
      assert.strictEqual(parseWibInput('bukan tanggal').error, 'Format tanggal tidak valid.');
    });

    it('jam device diformat dalam zona WIB, bukan zona lokal device', () => {
      // 2026-10-21T00:00:00Z = 07:00 WIB
      assert.strictEqual(wibDateTimeLocal(new Date('2026-10-21T00:00:00.000Z')), '2026-10-21T07:00');
      assert.strictEqual(wibDateTimeLocal(new Date('2026-10-20T20:00:00.000Z')), '2026-10-21T03:00');
    });

    it('angka form: kosong jadi null, isian bukan angka jadi NaN', () => {
      assert.strictEqual(parseFormNumber(''), null);
      assert.strictEqual(parseFormNumber('  '), null);
      assert.ok(Number.isNaN(parseFormNumber('abc') as number));
      assert.strictEqual(parseFormNumber('12.5'), 12.5);
    });
  });

  describe('aturan kolom grup — sumber tunggal wizard & form edit detail', () => {
    const groupOk = {
      labTempC: '7.7',
      visualCheck: 'normal',
      labWeightBeforeG: '482',
      labWeightAfterG: '486',
      sampleShrimpCount: '4',
    };

    it('nilai sah tidak menghasilkan galat', () => {
      assert.deepStrictEqual(validateGroupFields(groupOk), {});
    });

    it('pengelompokan hanya memvalidasi visual dan jumlah sampel, bukan pengukuran tahap', () => {
      assert.deepStrictEqual(validateGroupFields({ visualCheck: 'normal', sampleShrimpCount: '4' }), {});
      assert.strictEqual(validateGroupFields({ ...groupOk, sampleShrimpCount: '2' }).sampleShrimpCount, 'Harus 3–5 ekor.');
      assert.strictEqual(validateGroupFields({ ...groupOk, visualCheck: 'unknown' }).visualCheck, 'Wajib dipilih.');
    });

    it('peringatan berat sesudah lebih kecil dari sebelum — bukan error', () => {
      const warn = groupWeightWarning({ ...groupOk, labWeightAfterG: '470' });
      assert.ok(warn && warn.includes('lebih kecil'));
      assert.strictEqual(groupWeightWarning(groupOk), null);
      assert.strictEqual(groupWeightWarning({ ...groupOk, labWeightAfterG: '490' }), null);
      assert.strictEqual(groupWeightWarning({ ...groupOk, labWeightAfterG: '' }), null);
    });
  });
});
