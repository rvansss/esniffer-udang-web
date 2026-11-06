/**
 * Aturan antrean foto batch, dipakai tombol unggah di detail batch.
 *
 * Foto dari kamera ponsel datang satu per satu, dan caption sering diisi
 * belakangan. Karena itu antrean tidak boleh menuntut semua caption lengkap
 * sekaligus: yang sudah bercaption diunggah, yang belum tetap menunggu di
 * daftar. Modul ini yang menentukan foto mana ikut terkirim.
 */

export interface UploadCandidate {
  /** Posisi foto di antrean — dipakai memisahkan yang sudah terunggah. */
  index: number;
  file: File;
  /** Caption yang sudah dirapikan (trim), dijamin tidak kosong. */
  caption: string;
}

/**
 * Foto yang siap diunggah: captionnya terisi. Tanpa `onlyIndex` semua foto
 * bercaption ikut; dengan `onlyIndex` hanya foto itu (dipakai tombol unggah
 * per foto). Urutan antrean dipertahankan.
 */
export function pickUploadCandidates(
  files: readonly File[],
  captions: readonly string[],
  onlyIndex?: number
): UploadCandidate[] {
  const picked: UploadCandidate[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (onlyIndex !== undefined && index !== onlyIndex) continue;
    const caption = (captions[index] ?? '').trim();
    if (caption === '') continue;
    picked.push({ index, file: files[index], caption });
  }
  return picked;
}
