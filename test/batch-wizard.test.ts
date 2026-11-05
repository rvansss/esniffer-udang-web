import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatMean,
  meanFormNumber,
  parseFormNumber,
  parseWibInput,
  shrimpRowCount,
  stepOfField,
  validateGroupFields,
  validateGroupForm,
  groupWeightWarning,
  validateStepA,
  validateStepB,
  validateStepC,
  wibInputToUtcIso,
  SHRIMP_ROW_LIMIT,
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

/** Langkah 2 dengan pengukuran per ekor lengkap (12 ekor, sama seperti default). */
const perShrimpOk = {
  ...stepBOk,
  visualCheck: 'normal',
  shrimpTemperatures: Array.from({ length: 12 }, () => '2.5'),
  shrimpLengths: Array.from({ length: 12 }, () => '12.5'),
};

/** Ganti satu nilai pada daftar pengukuran per ekor. */
const withTemperature = (index: number, value: string) =>
  perShrimpOk.shrimpTemperatures.map((current, i) => (i === index ? value : current));
const withLength = (index: number, value: string) =>
  perShrimpOk.shrimpLengths.map((current, i) => (i === index ? value : current));

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

  describe('langkah Kondisi Udang — pengukuran per ekor', () => {
    it('nilai pengukuran per ekor yang lengkap tidak menghasilkan galat', () => {
      assert.deepStrictEqual(validateStepB(perShrimpOk), {});
    });

    it('suhu & panjang skalar tidak divalidasi saat pengukuran per ekor dikirim', () => {
      const errs = validateStepB(perShrimpOk);
      assert.strictEqual(errs.initialTempC, undefined);
      assert.strictEqual(errs.shrimpLengthCm, undefined);
    });

    it('baris yang belum terisi dilaporkan per nomor udang', () => {
      const errs = validateStepB({
        ...perShrimpOk,
        shrimpTemperatures: perShrimpOk.shrimpTemperatures.slice(0, 1),
        shrimpLengths: perShrimpOk.shrimpLengths.slice(0, 1),
      });
      assert.strictEqual(errs['shrimpTemp-2'], 'Wajib diisi.');
      assert.strictEqual(errs['shrimpLength-2'], 'Wajib diisi.');
      assert.strictEqual(errs['shrimpTemp-12'], 'Wajib diisi.');
      assert.strictEqual(errs['shrimpTemp-1'], undefined);
    });

    it('suhu per ekor dibatasi -10..10 °C dan panjang 1–50 cm', () => {
      const tempMsg = 'Harus -10 sampai 10 °C.';
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpTemperatures: withTemperature(3, '10.1') })['shrimpTemp-4'],
        tempMsg
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpTemperatures: withTemperature(0, '-10.1') })['shrimpTemp-1'],
        tempMsg
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpTemperatures: withTemperature(0, '-10') })['shrimpTemp-1'],
        undefined
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpLengths: withLength(2, '0.5') })['shrimpLength-3'],
        'Harus 1 sampai 50 cm.'
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpLengths: withLength(2, '51') })['shrimpLength-3'],
        'Harus 1 sampai 50 cm.'
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpLengths: withLength(2, '12.5') })['shrimpLength-3'],
        undefined
      );
    });

    it('jumlah ekor di atas batas baris pengukuran ditolak dengan pesan jelas', () => {
      const errs = validateStepB({ ...perShrimpOk, shrimpCount: String(SHRIMP_ROW_LIMIT + 1) });
      assert.strictEqual(
        errs.shrimpCount,
        `Maksimal ${SHRIMP_ROW_LIMIT} ekor untuk pencatatan suhu & panjang per ekor.`
      );
      // Jumlah tidak sah tidak boleh membanjiri layar dengan error per baris.
      assert.strictEqual(Object.keys(errs).filter((key) => key.startsWith('shrimpTemp-')).length, 0);
    });

    it('temuan visual divalidasi di langkah Kondisi Udang', () => {
      assert.strictEqual(validateStepB({ ...perShrimpOk, visualCheck: '' }).visualCheck, 'Wajib dipilih.');
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, visualCheck: 'busuk' }).visualCheck,
        'Wajib dipilih.'
      );
      assert.strictEqual(validateStepB({ ...perShrimpOk, visualCheck: 'melanosis' }).visualCheck, undefined);
    });
  });

  describe('helper turunan pengukuran per ekor', () => {
    it('shrimpRowCount hanya menerima bilangan bulat 10..batas', () => {
      assert.strictEqual(shrimpRowCount(''), 0);
      assert.strictEqual(shrimpRowCount('9'), 0);
      assert.strictEqual(shrimpRowCount('12.5'), 0);
      assert.strictEqual(shrimpRowCount('abc'), 0);
      assert.strictEqual(shrimpRowCount('10'), 10);
      assert.strictEqual(shrimpRowCount('12'), 12);
      assert.strictEqual(shrimpRowCount(String(SHRIMP_ROW_LIMIT)), SHRIMP_ROW_LIMIT);
      assert.strictEqual(shrimpRowCount(String(SHRIMP_ROW_LIMIT + 1)), 0);
    });

    it('meanFormNumber merata-ratakan lalu membulatkan 2 desimal', () => {
      assert.strictEqual(meanFormNumber(['2.5', '2.5', '2.6']), 2.53);
      assert.strictEqual(meanFormNumber(['12', '12.5']), 12.25);
      assert.strictEqual(meanFormNumber(['-2', '-2']), -2);
      // Presisi 2 desimal diterima kolom DECIMAL(5,2) dan assertMeasurementPrecision.
      assert.ok(Math.abs((meanFormNumber(['2.1', '2.2', '2.4']) as number) * 100 - Math.round(2.23 * 100)) < 1e-9);
    });

    it('meanFormNumber menolak daftar kosong atau isian belum lengkap', () => {
      assert.strictEqual(meanFormNumber([]), null);
      assert.strictEqual(meanFormNumber(['2.5', '']), null);
      assert.strictEqual(meanFormNumber(['2.5', 'abc']), null);
    });

    it('formatMean mengosongkan nilai yang belum bisa dihitung', () => {
      assert.strictEqual(formatMean(null), '');
      assert.strictEqual(formatMean(2.53), '2.53');
      assert.strictEqual(formatMean(12), '12');
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

    it('jumlah udang per sesi di wizard dipisah suhu ruang dan suhu dingin', () => {
      assert.deepStrictEqual(
        validateStepC({ ...stepBOk, sampleShrimpCountRoomTemp: '4', sampleShrimpCountCold: '3' }),
        {}
      );
      const tooFar = validateStepC({
        ...stepBOk,
        sampleShrimpCountRoomTemp: '2',
        sampleShrimpCountCold: '6',
      });
      assert.strictEqual(tooFar.sampleShrimpCountRoomTemp, 'Harus 3–5 ekor.');
      assert.strictEqual(tooFar.sampleShrimpCountCold, 'Harus 3–5 ekor.');
      assert.strictEqual(tooFar.sampleShrimpCount, undefined);
      assert.strictEqual(
        validateStepC({ ...stepBOk, sampleShrimpCountCold: '' }).sampleShrimpCountCold,
        'Wajib diisi.'
      );
      // Jalur form edit halaman detail (satu nilai untuk kedua grup) tetap berlaku.
      assert.deepStrictEqual(validateStepC({ ...stepBOk, ...groupOk }), {});
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
      assert.strictEqual(stepOfField('visualCheck'), 1);
      assert.strictEqual(stepOfField('shrimpTemp-1'), 1);
      assert.strictEqual(stepOfField('shrimpLength-12'), 1);
      assert.strictEqual(stepOfField('sampleShrimpCountRoomTemp'), 2);
      assert.strictEqual(stepOfField('sampleShrimpCountCold'), 2);
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
