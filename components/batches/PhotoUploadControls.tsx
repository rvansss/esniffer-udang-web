"use client";
import { CameraIcon, GalleryIcon } from '../ui/icons';

/**
 * Dua kontrol bersama untuk semua input foto batch (wizard, unggah detail
 * batch, foto tahap sesi):
 *
 * - `PhotoSourcePicker`: `capture` memaksa kamera terbuka langsung dan tidak
 *   bisa dibatalkan pengguna, jadi tombol kamera hanya dirender di layar
 *   sempit (ponsel) lewat `md:hidden`. Desktop cukup satu tombol yang membuka
 *   pemilih berkas biasa. Tombol galeri sengaja tanpa `capture` supaya
 *   pengguna ponsel bisa memilih foto yang sudah ada.
 *   Kamera ponsel mengembalikan SATU foto per pengambilan, jadi `onFiles`
 *   bisa terpanggil berkali-kali; pemanggil wajib MENAMBAHKAN berkas ke daftar,
 *   bukan menggantinya, supaya foto sebelumnya tidak hilang.
 * - `CaptionGuide`: panduan format caption, satu tempat agar tidak menyimpang
 *   antarhalaman.
 */

const sourceBtnCls =
  'inline-flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white/85 text-xs font-mono font-semibold cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-emerald-400';

export function PhotoSourcePicker({
  id,
  onFiles,
  multiple = true,
}: {
  id: string;
  onFiles: (list: FileList | null, input: HTMLInputElement) => void;
  multiple?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        id={`${id}-gallery`}
        type="file"
        accept="image/jpeg,image/png"
        multiple={multiple}
        onChange={(e) => {
          onFiles(e.currentTarget.files, e.currentTarget);
          // Kosongkan setelah dipakai: tanpa ini memilih berkas yang sama dua kali
          // tidak memicu onChange, dan pratinjau terasa "tidak jalan".
          e.currentTarget.value = '';
        }}
        className="sr-only"
      />
      <label htmlFor={`${id}-gallery`} className={sourceBtnCls}>
        <GalleryIcon className="w-4 h-4" />
        Pilih dari galeri
      </label>
      <input
        id={`${id}-camera`}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        // Tanpa `multiple`: kamera ponsel memang mengembalikan satu foto per
        // pengambilan, dan `multiple` + `capture` membuat sebagian penjelajah
        // iOS membuka galeri, bukan kamera.
        onChange={(e) => {
          onFiles(e.currentTarget.files, e.currentTarget);
          e.currentTarget.value = '';
        }}
        className="sr-only"
      />
      <label htmlFor={`${id}-camera`} className={`${sourceBtnCls} md:hidden`}>
        <CameraIcon className="w-4 h-4" />
        Ambil dari kamera
      </label>
    </div>
  );
}

const codeCls = 'px-1 py-0.5 rounded bg-black/35 text-cyan-200 font-mono';
const guideTextCls = 'text-[11px] font-mono text-white/70 leading-relaxed';

export function CaptionGuide() {
  return (
    <div className="rounded-xl bg-cyan-950/30 border border-cyan-400/25 px-3 py-2 space-y-1">
      <p className="text-[11px] font-mono text-cyan-100">
        Format caption: <code className={codeCls}>kegiatan-udang&lt;no&gt;-tahap&lt;no&gt;-sr/sd</code>
      </p>
      <p className={guideTextCls}>
        Contoh: <code className={codeCls}>suhu-udang1-tahap1-sr</code> — kegiatan suhu, udang no. 1, tahap 1,
        simpan suhu ruang.
      </p>
      <p className={guideTextCls}>
        <strong className="text-white/85">sr</strong> = suhu ruang, <strong className="text-white/85">sd</strong> =
        suhu dingin. Foto tanpa tahap (kondisi awal, pengelompokan) cukup{' '}
        <code className={codeCls}>kegiatan-udang&lt;no&gt;</code>, mis. <code className={codeCls}>berat-udang1</code>.
      </p>
    </div>
  );
}

/** Placeholder seragam untuk kolom caption. */
export const CAPTION_PLACEHOLDER = 'suhu-udang1-tahap1-sr';
