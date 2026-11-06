import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  coolerTempWarning,
  formatMean,
  meanFormNumber,
  observationTempMean,
  observationRowCount,
  parseFormNumber,
  parseWibInput,
  shrimpCountWarning,
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

    it('suhu cool box saat berangkat wajib, bebas rentang, dan hanya diwajibkan angka', () => {
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: '' }).coolerDeparture, 'Wajib diisi.');
      assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: 'abc' }).coolerDeparture, 'Harus berupa angka.');
      // Rentang -10..10 tidak lagi memblokir: nilai ekstrem tetap sah.
      for (const value of ['-10.1', '10.1', '-45', '87.5', '3.75']) {
        assert.strictEqual(validateStepA({ ...stepAOk, coolerDeparture: value }).coolerDeparture, undefined);
      }
    });

    it('peringatan cool box hanya muncul di luar acuan 0–4 °C dan tidak memblokir', () => {
      for (const value of ['0', '2.5', '4', '3.99']) assert.strictEqual(coolerTempWarning(value), null);
      for (const value of ['-0.1', '4.01', '-10', '12']) {
        assert.match(coolerTempWarning(value) ?? '', /Di luar acuan 0–4 °C/);
        assert.match(coolerTempWarning(value) ?? '', /tetap bisa disimpan/);
      }
      // Kosong/bukan angka bukan urusan peringatan (validasi yang menangani).
      assert.strictEqual(coolerTempWarning(''), null);
      assert.strictEqual(coolerTempWarning('abc'), null);
      assert.strictEqual(coolerTempWarning(null), null);
      // Nilai numerik (tampilan baca halaman detail) juga didukung.
      assert.strictEqual(coolerTempWarning(3.5), null);
      assert.match(coolerTempWarning(9) ?? '', /Di luar acuan/);
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

    it('jumlah udang tanpa batas minimal/maksimal, cukup bilangan bulat ≥ 1', () => {
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpCount: '' }).shrimpCount, 'Wajib diisi.');
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpCount: 'abc' }).shrimpCount, 'Harus berupa angka.');
      for (const value of ['0', '-3', '12.5']) {
        assert.strictEqual(
          validateStepB({ ...stepBOk, shrimpCount: value }).shrimpCount,
          'Harus bilangan bulat minimal 1 ekor.'
        );
      }
      // Dulu ditolak (minimal 10): kini sah, peringatan pun tidak muncul.
      for (const value of ['1', '5', '10']) {
        assert.strictEqual(validateStepB({ ...stepBOk, shrimpCount: value }).shrimpCount, undefined);
      }
      assert.strictEqual(shrimpCountWarning('5'), null);
    });

    it('peringatan jumlah udang hanya muncul di luar acuan 1–10 ekor', () => {
      for (const value of ['1', '4', '10', 10]) assert.strictEqual(shrimpCountWarning(value), null);
      for (const value of ['0', '11', '40', 40]) {
        assert.match(shrimpCountWarning(value) ?? '', /Di luar acuan 1–10 ekor/);
        assert.match(shrimpCountWarning(value) ?? '', /tetap bisa disimpan/);
      }
      assert.strictEqual(shrimpCountWarning(''), null);
      assert.strictEqual(shrimpCountWarning('abc'), null);
      assert.strictEqual(shrimpCountWarning(undefined), null);
    });

    it('panjang udang bebas rentang; berat tetap > 0 sampai 2000 gram', () => {
      for (const value of ['0.5', '51', '2.75', '120']) {
        assert.strictEqual(validateStepB({ ...stepBOk, shrimpLengthCm: value }).shrimpLengthCm, undefined);
      }
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpLengthCm: '' }).shrimpLengthCm, 'Wajib diisi.');
      assert.strictEqual(validateStepB({ ...stepBOk, shrimpLengthCm: 'abc' }).shrimpLengthCm, 'Harus berupa angka.');
      assert.strictEqual(
        validateStepB({ ...stepBOk, totalWeightG: '0' }).totalWeightG,
        'Harus lebih dari 0 sampai 2000 gram.'
      );
      assert.strictEqual(
        validateStepB({ ...stepBOk, totalWeightG: '2001' }).totalWeightG,
        'Harus lebih dari 0 sampai 2000 gram.'
      );
    });

    it('suhu awal udang dan tiga suhu cool box bebas rentang', () => {
      for (const value of ['-10.1', '10.1', '-40', '85']) {
        assert.strictEqual(validateStepB({ ...stepBOk, initialTempC: value }).initialTempC, undefined);
        assert.strictEqual(validateStepB({ ...stepBOk, coolerMarket: value }).coolerMarket, undefined);
        assert.strictEqual(validateStepC({ ...stepBOk, ...groupOk, coolerLab: value }).coolerLab, undefined);
      }
      assert.strictEqual(validateStepC({ ...stepBOk, ...groupOk, coolerLab: '' }).coolerLab, 'Wajib diisi.');
      assert.strictEqual(
        validateStepC({ ...stepBOk, ...groupOk, coolerLab: 'hangat' }).coolerLab,
        'Harus berupa angka.'
      );
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

    it('suhu & panjang per ekor bebas rentang dan menerima desimal', () => {
      for (const value of ['10.1', '-10.1', '99', '-5.75']) {
        assert.strictEqual(
          validateStepB({ ...perShrimpOk, shrimpTemperatures: withTemperature(0, value) })['shrimpTemp-1'],
          undefined
        );
      }
      for (const value of ['0.5', '51', '2.75', '120']) {
        assert.strictEqual(
          validateStepB({ ...perShrimpOk, shrimpLengths: withLength(2, value) })['shrimpLength-3'],
          undefined
        );
      }
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpTemperatures: withTemperature(0, 'hangat') })['shrimpTemp-1'],
        'Harus berupa angka.'
      );
      assert.strictEqual(
        validateStepB({ ...perShrimpOk, shrimpLengths: withLength(2, '') })['shrimpLength-3'],
        'Wajib diisi.'
      );
    });

    it('jumlah ekor di atas batas TEKNIS baris pengukuran ditolak dengan pesan jelas', () => {
      // Batas 1.000 baris hanya pengaman render wizard; API/DB menerima lebih.
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
    it('shrimpRowCount menerima bilangan bulat 1..batas teknis', () => {
      assert.strictEqual(shrimpRowCount(''), 0);
      assert.strictEqual(shrimpRowCount('0'), 0);
      assert.strictEqual(shrimpRowCount('-2'), 0);
      assert.strictEqual(shrimpRowCount('12.5'), 0);
      assert.strictEqual(shrimpRowCount('abc'), 0);
      assert.strictEqual(shrimpRowCount('1'), 1);
      assert.strictEqual(shrimpRowCount('5'), 5);
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

    it('jumlah sampel tanpa batas domain; bobot tidak divalidasi di sini', () => {
      const errs = validateGroupForm('sr', {
        ...groupOk,
        labWeightBeforeG: '0',
        labWeightAfterG: '-2',
        sampleShrimpCount: '0',
      });
      assert.strictEqual(errs['sr-labWeightBeforeG'], undefined);
      assert.strictEqual(errs['sr-labWeightAfterG'], undefined);
      assert.strictEqual(errs['sr-sampleShrimpCount'], 'Harus bilangan bulat minimal 1 ekor.');
      // Dulu ditolak (3–5 ekor): kini sah, tanpa galat.
      assert.deepStrictEqual(validateGroupForm('sr', { ...groupOk, sampleShrimpCount: '9' }), {});
    });

    it('jumlah udang per sesi di wizard dipisah suhu ruang dan suhu dingin', () => {
      assert.deepStrictEqual(
        validateStepC({ ...stepBOk, sampleShrimpCountRoomTemp: '4', sampleShrimpCountCold: '3' }),
        {}
      );
      const outOfGuide = validateStepC({
        ...stepBOk,
        sampleShrimpCountRoomTemp: '2',
        sampleShrimpCountCold: '15',
      });
      // Acuan 1–10 hanya peringatan: tidak ada galat untuk nilai di luar itu.
      assert.deepStrictEqual(outOfGuide, {});
      assert.strictEqual(shrimpCountWarning('2'), null);
      assert.match(shrimpCountWarning('15') ?? '', /Di luar acuan 1–10 ekor/);
      const invalid = validateStepC({
        ...stepBOk,
        sampleShrimpCountRoomTemp: '0',
        sampleShrimpCountCold: '11.5',
      });
      assert.strictEqual(invalid.sampleShrimpCountRoomTemp, 'Harus bilangan bulat minimal 1 ekor.');
      assert.strictEqual(invalid.sampleShrimpCountCold, 'Harus bilangan bulat minimal 1 ekor.');
      assert.strictEqual(invalid.sampleShrimpCount, undefined);
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

    it('pengelompokan hanya memvalidasi visual dan kelayakan jumlah sampel', () => {
      assert.deepStrictEqual(validateGroupFields({ visualCheck: 'normal', sampleShrimpCount: '4' }), {});
      assert.strictEqual(validateGroupFields({ ...groupOk, sampleShrimpCount: '0' }).sampleShrimpCount, 'Harus bilangan bulat minimal 1 ekor.');
      // Nilai di luar acuan 1–10 ekor bukan galat.
      assert.strictEqual(validateGroupFields({ ...groupOk, sampleShrimpCount: '2' }).sampleShrimpCount, undefined);
      assert.strictEqual(validateGroupFields({ ...groupOk, sampleShrimpCount: '40' }).sampleShrimpCount, undefined);
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

  describe('suhu tahap observasi — baris per ekor menjadi rata-rata', () => {
    it('jumlah baris mengikuti jumlah udang per sesi grup', () => {
      assert.strictEqual(observationRowCount(1), 1);
      assert.strictEqual(observationRowCount(3), 3);
      assert.strictEqual(observationRowCount(4), 4);
      assert.strictEqual(observationRowCount(5), 5);
      assert.strictEqual(observationRowCount(SHRIMP_ROW_LIMIT), SHRIMP_ROW_LIMIT);
    });

    it('jumlah udang per sesi yang tidak layak dirender menghasilkan 0 baris', () => {
      for (const bad of [0, -1, 2.5, SHRIMP_ROW_LIMIT + 1, Number.NaN]) {
        assert.strictEqual(observationRowCount(bad), 0, `nilai ${bad} harus ditolak`);
      }
      // Batas 3–5 ekor sudah dihapus; kelayakan render saja yang dijaga.
      assert.strictEqual(observationRowCount(6), 6);
      assert.strictEqual(observationRowCount(40), 40);
    });

    it('rata-rata dari seluruh baris, dibulatkan 2 desimal', () => {
      assert.strictEqual(observationTempMean(['5', '5.5', '6'], 3), 5.5);
      assert.strictEqual(observationTempMean(['5.11', '5.12'], 2), 5.12);
      assert.strictEqual(observationTempMean(['-2'], 1), -2);
      assert.strictEqual(observationTempMean(['30'], 1), 30);
    });

    it('baris belum lengkap atau bukan angka tidak menghasilkan angka setengah jadi', () => {
      assert.strictEqual(observationTempMean(['5'], 3), null);
      assert.strictEqual(observationTempMean(['5', '', '6'], 3), null);
      assert.strictEqual(observationTempMean(['5', '  ', '6'], 3), null);
      assert.strictEqual(observationTempMean(['5', 'abc', '6'], 3), null);
      assert.strictEqual(observationTempMean([], 0), null);
      assert.strictEqual(observationTempMean([], 3), null);
      assert.strictEqual(observationTempMean(['5', '5'], Number.NaN), null);
    });

    it('suhu tahap bebas rentang: nilai ekstrem tetap dirata-ratakan', () => {
      assert.strictEqual(observationTempMean(['-2.1'], 1), -2.1);
      assert.strictEqual(observationTempMean(['30.1'], 1), 30.1);
      assert.strictEqual(observationTempMean(['5', '99'], 2), 52);
      assert.strictEqual(observationTempMean(['-40', '85'], 2), 22.5);
      assert.strictEqual(observationTempMean(['2.755'], 1), 2.76);
    });

    it('baris di luar jumlah ekor diabaikan, bukan menggeser rata-rata', () => {
      assert.strictEqual(observationTempMean(['5', '6', '7'], 2), 5.5);
    });
  });
});
