import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pickUploadCandidates } from '../lib/photo-queue.ts';

const photo = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

describe('Antrean foto: unggah bertahap tanpa menggantikan foto sebelumnya', () => {
  it('semua foto bercaption terkirim dengan urutan antrean', () => {
    const files = [photo('a.jpg'), photo('b.jpg')];
    const picked = pickUploadCandidates(files, ['suhu-udang1-tahap1-sr', 'berat-udang1']);
    assert.deepEqual(
      picked.map((item) => item.index),
      [0, 1]
    );
    assert.deepEqual(
      picked.map((item) => item.file.name),
      ['a.jpg', 'b.jpg']
    );
  });

  it('foto tanpa caption tetap menunggu di antrean, tidak ikut dikirim', () => {
    const files = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];
    const picked = pickUploadCandidates(files, ['', '   ', 'berat-udang1']);
    assert.deepEqual(
      picked.map((item) => item.index),
      [2]
    );
  });

  it('caption dirapikan spasinya sebelum dikirim', () => {
    const files = [photo('a.jpg')];
    assert.strictEqual(pickUploadCandidates(files, ['  berat-udang1  '])[0].caption, 'berat-udang1');
  });

  it('unggah satu foto hanya mengirim foto itu', () => {
    const files = [photo('a.jpg'), photo('b.jpg')];
    assert.deepEqual(
      pickUploadCandidates(files, ['', 'berat-udang1'], 1).map((item) => item.index),
      [1]
    );
    // Foto yang dipilih belum bercaption: tidak ada yang dikirim.
    assert.deepEqual(pickUploadCandidates(files, ['', 'berat-udang1'], 0), []);
  });

  it('caption yang belum diisi sama sekali dianggap kosong', () => {
    const files = [photo('a.jpg'), photo('b.jpg')];
    assert.deepEqual(pickUploadCandidates(files, [], undefined), []);
  });
});
