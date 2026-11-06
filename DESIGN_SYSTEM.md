# Design System E-Sniffer

Dokumentasi antarmuka yang diimplementasikan pada web monitoring dan pencatatan dataset udang.

| Metadata | Keterangan |
| --- | --- |
| Versi dokumen | 1.0 |
| Tanggal analisis | 30 Oktober 2026 |
| Basis kode | Checkout lokal, commit `66ed478` |
| Status | Dokumentasi kondisi saat ini (*as implemented*) |
| Bahasa antarmuka utama | Bahasa Indonesia; beberapa istilah teknis berbahasa Inggris |
| Teknologi antarmuka | Next.js 16.3.8 App Router, React 19.2.8, TypeScript, Tailwind CSS 4, Recharts 3 |
| Lokasi dokumen | Root proyek; direktori `docs/` dan `diki/` saat ini diabaikan oleh `.gitignore` |

## Daftar isi

1. [Tujuan, ruang lingkup, dan metode](#1-tujuan-ruang-lingkup-dan-metode)
2. [Identitas dan prinsip desain](#2-identitas-dan-prinsip-desain)
3. [Struktur folder dan arsitektur antarmuka](#3-struktur-folder-dan-arsitektur-antarmuka)
4. [Fondasi dan arsitektur token](#4-fondasi-dan-arsitektur-token)
5. [Color palette](#5-color-palette)
6. [Font dan typography](#6-font-dan-typography)
7. [Spacing dan ukuran](#7-spacing-dan-ukuran)
8. [Layout, grid, dan responsive behavior](#8-layout-grid-dan-responsive-behavior)
9. [Surface, border, radius, dan elevation](#9-surface-border-radius-dan-elevation)
10. [Ikon, identitas visual, dan gambar](#10-ikon-identitas-visual-dan-gambar)
11. [Katalog komponen](#11-katalog-komponen)
12. [Form dan validasi](#12-form-dan-validasi)
13. [Visualisasi data dan aturan penyajian angka](#13-visualisasi-data-dan-aturan-penyajian-angka)
14. [Status, feedback, dan notifikasi](#14-status-feedback-dan-notifikasi)
15. [Pola halaman dan alur interaksi](#15-pola-halaman-dan-alur-interaksi)
16. [Motion dan microinteraction](#16-motion-dan-microinteraction)
17. [Accessibility](#17-accessibility)
18. [UX writing dan lokalisasi](#18-ux-writing-dan-lokalisasi)
19. [Panduan penggunaan dan pengembangan](#19-panduan-penggunaan-dan-pengembangan)
20. [Temuan dan rekomendasi standardisasi](#20-temuan-dan-rekomendasi-standardisasi)
21. [Pemeliharaan dan referensi sumber](#21-pemeliharaan-dan-referensi-sumber)

## 1. Tujuan, ruang lingkup, dan metode

Dokumen ini menjadi acuan untuk memahami dan melanjutkan tampilan E-Sniffer tanpa kehilangan pola visual yang sudah digunakan. Cakupannya meliputi fondasi visual, komponen, status interaksi, layout, penyajian data sensor, pencatatan batch, dan batasan implementasi.

Analisis dilakukan melalui:

- Penelusuran struktur proyek, layout global, CSS, halaman, komponen, aset, dan formatter data.
- Pembacaan dokumentasi Next.js yang tersedia di `node_modules/next/dist/docs/` sesuai instruksi proyek.
- Pemeriksaan render browser lokal, termasuk computed style untuk memastikan font, ukuran, warna, dan radius yang benar-benar diterapkan.
- Pemeriksaan tampilan desktop pada viewport 1440 × 1000 dan pemeriksaan terbatas pada viewport mobile 390 × 844.

Halaman yang menjadi cakupan adalah `/`, `/login`, `/chamber/[chamberId]`, `/batches`, `/batches/new`, dan `/batches/[batchId]`. Dashboard lokal memiliki data historis dan perangkat offline saat pemeriksaan. Kondisi ini memengaruhi isi status dan grafik, bukan definisi gaya komponen.

| Cakupan pemeriksaan browser | Hasil/batas pemeriksaan |
| --- | --- |
| Desktop: login, dashboard chamber, daftar batch, langkah awal wizard | Konten berhasil dirender dan ditinjau secara visual |
| Computed style login | Font, ukuran, line-height, bobot, warna, radius, dan gradasi diperiksa |
| Mobile 390px | Login dan keadaan loading detail diperiksa; belum menjadi verifikasi penuh seluruh halaman mobile |
| Detail batch berisi data, modal riwayat, dan grafik historis berisi seri | Spesifikasi ditelusuri dari kode; percobaan navigasi otomatis lanjutan tidak selesai, sehingga hasil visual lengkap tidak diklaim terverifikasi |
| State mutasi, notifikasi otomatis, error tertentu | Ditelusuri dari kode tanpa menjalankan seluruh aksi bisnis |

**Cara membaca spesifikasi:**

| Jenis informasi | Makna |
| --- | --- |
| Implementasi | Nilai atau perilaku yang ditemukan dalam source code |
| Hasil render | Perilaku yang juga diperiksa pada browser lokal |
| Pemetaan dokumentasi | Nama/peran yang dipakai dalam dokumen untuk menjelaskan pola; belum tentu merupakan token di kode |
| Rekomendasi | Usulan perapian; belum menjadi bagian implementasi saat ini |

Dokumen ini tidak mengubah komponen, CSS, konfigurasi, ataupun data bisnis. Pemeriksaan visual bukan audit menyeluruh untuk seluruh perangkat, browser, atau kombinasi status aplikasi. Source code checkout lokal menjadi acuan; kesetaraan dengan deployment produksi tidak diasumsikan.

## 2. Identitas dan prinsip desain

### 2.1 Identitas produk

E-Sniffer adalah antarmuka monitoring telemetri sensor gas dan kondisi lingkungan chamber, serta pencatatan batch sampel udang. Header menggunakan nama **E-Sniffer**, monogram **eS**, dan label **IoT Telemetry**. Judul metadata aplikasi adalah **E-Sniffer Dashboard**.

Karakter visual yang terlihat:

- Latar gelap dengan gradasi biru dan indigo.
- Panel transparan dengan blur, border putih tipis, dan bayangan.
- Aksen cyan untuk monitoring, navigasi chamber, dan aksi terkait perangkat.
- Aksen emerald untuk pencatatan, penyelesaian alur, dan keberhasilan.
- Angka sensor berukuran besar, label ringkas, serta badge teknis berhuruf kapital.

### 2.2 Prinsip yang disimpulkan dari antarmuka

Prinsip berikut merupakan interpretasi pola implementasi, bukan pedoman merek formal yang sudah terpisah di repository.

| Prinsip | Penerapan yang terlihat |
| --- | --- |
| Data menjadi pusat perhatian | Nilai suhu dan kelembaban besar; grafik menempati dua kolom dashboard desktop |
| Status dibuat eksplisit | Koneksi perangkat, kesegaran data, dan kondisi pengambilan data memiliki indikator tersendiri |
| Transparansi informasi | Nilai kosong ditulis `--` atau `—`; grafik memutus garis pada data kosong |
| Konsistensi permukaan | Header, kartu, form, dan panel memakai border putih transparan serta sudut membulat |
| Hierarki aksi berdasarkan konteks | Cyan dominan pada monitoring; emerald dominan pada pencatatan |
| Proses panjang dipecah menjadi langkah | Wizard batch memiliki tiga tahap, progress bar, validasi, dan pemulihan draf |

## 3. Struktur folder dan arsitektur antarmuka

### 3.1 Peta direktori

```text
esniffer-udang-web/
├── app/
│   ├── layout.tsx                  # Shell global, header, footer, latar
│   ├── globals.css                 # Import Tailwind, warna dasar, alias font
│   ├── page.tsx                    # Pengarah awal dan state pemuatan/kosong/gagal
│   ├── login/page.tsx              # Autentikasi
│   ├── chamber/[chamberId]/page.tsx # Dashboard telemetri
│   ├── batches/
│   │   ├── page.tsx                # Daftar batch menurut sumber/pasar
│   │   ├── new/page.tsx            # Wizard tiga tahap
│   │   └── [batchId]/page.tsx      # Data batch, foto, grup, dan sesi
│   ├── api/                       # Endpoint; bukan komponen visual
│   └── uploads/[...path]/route.ts  # Penyajian berkas unggahan
├── components/
│   ├── auth/AuthProvider.tsx       # State autentikasi dan akses API
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── NotificationBell.tsx
│   │   └── ExportPanel.tsx
│   ├── charts/ChartPanel.tsx
│   ├── chambers/CreateChamberModal.tsx
│   └── ui/
│       ├── MetricCard.tsx
│       ├── SensorCard.tsx
│       ├── ConfirmDialog.tsx
│       ├── SuccessNotice.tsx
│       └── icons.tsx
├── hooks/                         # Pengambilan latest dan stream chamber
├── lib/                           # Auth, API, validasi wizard, draf, database
├── shared/                        # Unit sensor, tipe, aturan dataset, waktu/status
├── public/                        # Foto perangkat, SVG, audio, unggahan
├── prisma/                        # Model data, migrasi, seed
├── worker/                        # Ingestion MQTT dan pemrosesan telemetri
├── test/                          # Unit, API, database, dan end-to-end
├── deploy/ dan docker/            # Infrastruktur deployment
├── docs/ dan diki/                # Dokumentasi lokal, diabaikan Git saat ini
└── DESIGN_SYSTEM.md               # Dokumen ini
```

Folder firmware seperti `E_Sniffer_ESP32/` dan `esniffer_esp32_nextion/` mendukung perangkat, tetapi tidak mendefinisikan gaya web. Direktori `exports/`, `graphify-out/`, dan `visual references/` bukan sumber styling runtime aplikasi.

### 3.2 Lapisan tanggung jawab

| Lapisan | Sumber | Tanggung jawab desain |
| --- | --- | --- |
| Global | `app/layout.tsx`, `app/globals.css` | Latar, lebar halaman, padding, font dasar, header/footer |
| Halaman | `app/**/page.tsx` | Susunan section, grid, form, alur batch/chamber |
| Komponen bersama | `components/` | Pengulangan kartu, dialog, notifikasi, grafik, ekspor |
| Data presentasi | `shared/`, sebagian `lib/` | Label satuan, format waktu, format angka, validasi |
| Data runtime | `hooks/`, `components/auth/` | Kondisi loading, error, cached, autentikasi, pembaruan data |

Styling terutama berupa kelas Tailwind langsung di TSX. Wizard dan detail batch juga memakai konstanta lokal seperti `inputCls`, `cardCls`, `btnPrimary`, dan `btnGhost`. Komponen Button, Input, Badge, Card, dan Dialog generik dengan varian terpusat belum tersedia. Tidak ada dependency shadcn/Radix pada `package.json` yang dianalisis.

## 4. Fondasi dan arsitektur token

### 4.1 Token yang sudah ada

`app/globals.css` mendefinisikan:

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}
```

Nilai tersebut adalah deklarasi yang sudah ada. Namun, tampilan aplikasi terutama ditentukan wrapper gradasi pada `app/layout.tsx` dan kelas warna komponen. Aplikasi belum memiliki dua tema visual lengkap yang berpindah antara light dan dark. Media query di atas hanya mengganti token dasar; panel dan latar utama tetap bernuansa gelap.

### 4.2 Hubungan primitive, semantic, dan component

| Tingkat | Kondisi saat ini | Contoh |
| --- | --- | --- |
| Primitive | Menggunakan token bawaan Tailwind dan beberapa nilai literal | `cyan-500`, `white`, `#1e3a8a`, spacing `4`, radius `xl` |
| Semantic | Sebagian kecil tersedia; mayoritas masih berupa pola pemakaian | `--color-background`; cyan untuk monitoring; emerald untuk pencatatan |
| Component | Belum menjadi token CSS terpusat | Kelas `cardCls` di masing-masing halaman; warna `ConfirmDialog` |

Nama seperti *surface utama*, *teks sekunder*, dan *aksi pencatatan* di bagian berikut adalah pemetaan dokumentasi. Jangan menganggap ada variabel seperti `--color-primary` atau `--button-bg` di implementasi sekarang.

## 5. Color palette

### 5.1 Catatan representasi warna

Tailwind CSS 4 pada proyek ini menyimpan palette dalam **OKLCH**. Angka HEX palette Tailwind di bawah merupakan pendekatan sRGB 8-bit dari konversi browser lokal. Gunakan nama token Tailwind atau nilai OKLCH sebagai acuan implementasi, karena HEX pendekatan dapat berbeda dari palette Tailwind versi lain dan dari gamut layar yang lebih luas.

Warna yang ditulis literal sebagai HEX di source code diberi penanda **literal** dan nilainya dapat digunakan langsung. Warna dengan suffix `/20`, `/30`, dan seterusnya adalah warna dengan alpha, bukan warna solid baru.

### 5.2 Latar dan surface

| Elemen | Nilai/kelas implementasi | Penggunaan |
| --- | --- | --- |
| Awal gradasi halaman | `from-slate-900`; `oklch(20.8% 0.042 265.755)`; ≈ `#0F172B` | Sudut kiri atas latar |
| Tengah gradasi halaman | `via-[#1e3a8a]`; **literal** `#1E3A8A` | Area biru utama |
| Akhir gradasi halaman | `to-indigo-950`; `oklch(25.7% 0.09 281.288)`; ≈ `#1E1A4D` | Sudut kanan bawah latar |
| Surface panel utama | `bg-white/10` | Header, kartu utama, panel grafik, form |
| Surface panel sekunder | `bg-white/5` | Kartu metrik sekunder, empty state, tombol ghost |
| Hover surface | `bg-white/15` atau `bg-white/10` | Kartu batch, sensor, tombol netral |
| Surface input | `bg-black/25` | Login dan wizard batch |
| Surface input perangkat | `bg-black/40` | Form tambah chamber dan filter riwayat |
| Menu dan dialog tertentu | **Literal** `linear-gradient(180deg, #24407f 0%, #16295c 100%)` | Menu akun, dropdown notifikasi, konfirmasi, dialog foto/sesi |
| Modal perangkat/riwayat | `bg-slate-900` | Tambah chamber dan tabel riwayat |
| Header tabel telemetri | **Literal** `#0F172A` | Header tabel sticky; berbeda sedikit dari `slate-900` Tailwind 4 |
| Tooltip grafik | **Literal** `rgba(15, 23, 42, 0.95)` | Latar tooltip |
| Overlay | `bg-black/60`, `/70`, atau `/75` | Menggelapkan halaman di belakang modal |

Latar halaman menggunakan arah `bg-gradient-to-br`. Orb biru dan cyan di belakang konten menambah cahaya lembut; efek ini menjadi bagian identitas visual saat ini.

### 5.3 Palette interaktif dan semantik

| Token Tailwind | Nilai OKLCH | HEX sRGB ≈ | Peran yang ditemukan |
| --- | --- | --- | --- |
| `cyan-200` | `oklch(91.7% 0.08 205.041)` | `#A2F4FD` | Teks navigasi chamber aktif |
| `cyan-300` | `oklch(86.5% 0.127 207.078)` | `#53EAFD` | Label, satuan, informasi monitoring |
| `cyan-400` | `oklch(78.9% 0.154 211.53)` | `#00D3F2` | Focus ring, border aktif, orb |
| `cyan-500` | `oklch(71.5% 0.143 215.221)` | `#00B8DB` | Tombol, pilihan aktif, indikator Live |
| `blue-500` | `oklch(62.3% 0.214 259.815)` | `#2B7FFF` | Orb dan hover gradasi |
| `blue-600` | `oklch(54.6% 0.245 262.881)` | `#155DFC` | Ujung gradasi tombol login dan monogram |
| `emerald-200` | `oklch(90.5% 0.093 164.15)` | `#A4F4CF` | Teks tombol pencatatan |
| `emerald-300` | `oklch(84.5% 0.143 164.978)` | `#5EE9B5` | Teks sukses, Online, complete |
| `emerald-400` | `oklch(76.5% 0.177 163.223)` | `#00D492` | Progress bar, focus ring form, dot Online |
| `emerald-500` | `oklch(69.6% 0.17 162.48)` | `#00BC7D` | Surface aksi pencatatan dan sukses |
| `amber-300` | `oklch(87.9% 0.169 91.605)` | `#FFD230` | Teks warning, stale, kualitas sensor |
| `amber-400` | `oklch(82.8% 0.189 84.429)` | `#FFB900` | Dot status peringatan dan mode Riwayat |
| `amber-500` | `oklch(76.9% 0.188 70.08)` | `#FE9A00` | Surface dan border warning |
| `rose-200` | `oklch(89.2% 0.058 10.001)` | `#FFCCD3` | Teks alert dan tombol hapus |
| `rose-300` | `oklch(81% 0.117 11.638)` | `#FFA1AD` | Error, Offline, validasi |
| `rose-400` | `oklch(71.2% 0.194 13.428)` | `#FF637E` | Border invalid dan penanda wajib |
| `rose-500` | `oklch(64.5% 0.246 16.439)` | `#FF2056` | Surface destructive dan badge notifikasi |

Warna tambahan meliputi `teal-*` untuk gradasi ekspor, `purple-300` untuk label MQ-136, dan `indigo-300` untuk badge peran VIEWER. Nilai `#6EE7B7` dan `#6B7280` pada aksi “Tandai semua dibaca” adalah literal lokal, bukan alias palette emerald/gray Tailwind yang terpusat.

### 5.4 Teks dan border netral

| Peran | Kelas yang umum | Makna alpha |
| --- | --- | --- |
| Teks utama | `text-white`, `text-white/90` | 100% atau 90% putih |
| Label dan teks penjelas | `text-white/80`, `/85`, `/70`, `/75` | Hierarki menengah |
| Teks sekunder | `text-white/60`, `/55`, `/50` | Metadata, waktu, subtitle |
| Teks sangat redup | `text-white/40`, `/35`, `/30` | Placeholder, nilai kosong, catatan kecil |
| Border panel utama | `border-white/20` | Garis putih alpha 20% |
| Border menu/modal | `border-white/15` | Garis putih alpha 15% |
| Border sekunder/pemisah | `border-white/10`, `/5` | Pemisah ringan |

Warna akhir surface transparan bergantung pada latar, orb, dan blur di belakangnya. `bg-white/10` tidak dapat direpresentasikan sebagai satu HEX opaque yang selalu sama.

### 5.5 Warna seri sensor

| Sensor | Garis grafik dan dot kartu, literal | Label/satuan kartu dan tabel |
| --- | --- | --- |
| MQ-137 / amonia (NH₃) | `#38BDF8` | `text-cyan-300` |
| MQ-136 / hidrogen sulfida (H₂S) | `#D8B4FE` | `text-purple-300` |
| MQ-4 / metana (CH₄) | `#A78BFA` | `text-emerald-300` |
| DHT-22 / suhu dan kelembaban | `bg-white/40` pada dot | `text-amber-300` pada ringkasan |

**Perbedaan yang perlu dipertahankan dalam pembacaan kondisi sekarang:** MQ-4 memakai violet pada grafik/dot, tetapi emerald pada satuan dan tabel. Palette sensor belum sepenuhnya konsisten lintas representasi.

## 6. Font dan typography

### 6.1 Font yang dideklarasikan dan yang tampil

| Aspek | Kondisi saat ini |
| --- | --- |
| Deklarasi `body` | `font-family: Arial, Helvetica, sans-serif` di `globals.css` |
| Kelas pada body | `font-sans antialiased` |
| Kelas yang banyak dipakai komponen | `font-mono` untuk judul, label, angka, tombol, dan metadata |
| Alias Tailwind | `--font-sans → --font-geist-sans`; `--font-mono → --font-geist-mono` |
| Pemuatan Geist | Tidak ditemukan import/penerapan `next/font` atau definisi variabel Geist pada layout yang dianalisis |
| Hasil computed style browser | Body, brand, judul login, input login, dan tombol login menggunakan `Arial, Helvetica, sans-serif` |
| Pengecualian eksplisit | Tooltip dan legend Recharts menggunakan `fontFamily: 'monospace'`; elemen seperti `code` juga dapat memiliki font bawaan tersendiri |

Dengan demikian, **Geist dan Geist Mono belum dapat disebut sebagai font aktif aplikasi**. Banyak kelas `font-mono` menyatakan maksud styling, tetapi aliasnya belum terselesaikan sehingga pada elemen yang diperiksa font mengikuti Arial. Pemeriksaan ulang computed style diperlukan jika font diubah kemudian.

### 6.2 Skala ukuran teks

Konversi berikut menggunakan root font 16px pada lingkungan pemeriksaan.

| Utility | Ukuran | Line-height bawaan | Penggunaan saat ini |
| --- | --- | --- | --- |
| `text-[9px]` | 9px | Mengikuti konteks jika tidak diatur lagi | Badge kualitas, peran pengguna, metadata teknis |
| `text-[10px]` | 10px | Mengikuti konteks jika tidak diatur lagi | Status, heading tabel, IoT Telemetry |
| `text-[11px]` | 11px | Mengikuti konteks jika tidak diatur lagi | Label metrik, error field, metadata |
| `text-xs` | 12px / 0.75rem | 16px | Subtitle, tombol ringkas, helper text |
| `text-[13px]` | 13px | Mengikuti konteks jika tidak diatur lagi | Label wizard dan item menu akun |
| `text-sm` | 14px / 0.875rem | 20px | Input, judul section kecil, nilai detail |
| `text-base` | 16px / 1rem | 24px | Judul dialog, nilai kartu sensor |
| `text-lg` | 18px / 1.125rem | 28px | Heading grafik, satuan metrik mobile |
| `text-xl` | 20px / 1.25rem | 28px | Heading halaman mobile, panel ekspor |
| `text-2xl` | 24px / 1.5rem | 32px | Brand dan heading halaman desktop |
| `text-3xl` | 30px / 1.875rem | 36px | Judul login “Masuk Sesi” |
| `text-4xl` | 36px / 2.25rem | 40px | Angka metrik mobile |
| `text-5xl` | 48px / 3rem | 48px | Angka metrik mulai breakpoint `md` |

Ukuran arbitrary 9–13px tidak memiliki satu line-height komponen yang seragam. Periksa computed style dan kelas `leading-*` pada konteksnya; jangan menganggap line-height sama dengan ukuran font.

### 6.3 Bobot, tracking, dan line-height

| Properti | Nilai yang digunakan | Contoh |
| --- | --- | --- |
| Bobot normal | `font-normal` = 400 / inherited | Body dan sebagian deskripsi |
| Medium / semibold | 500 / 600 | Email akun, label, navigasi |
| Bold | 700 | Tombol, label, metadata penting |
| Extrabold / black | 800 / 900 | Judul login / brand dan angka metrik |
| Tracking tight | `-0.025em` | Nilai metrik besar |
| Tracking wide | `0.025em` | Label metrik, judul wizard |
| Tracking wider | `0.05em` | Tombol, badge, heading grafik |
| Tracking widest | `0.1em` | Brand, heading batch, footer |
| Leading tight | `1.25` | Label metrik |
| Leading snug | `1.375` | Pasangan label–nilai pada detail batch |
| Leading relaxed | `1.625` | Penjelasan dialog dan panel ekspor |

Label status dan heading panel kerap memakai `uppercase`. Paragraf penjelas dan instruksi form memakai sentence case. `tabular-nums` sudah digunakan pada tabel telemetri untuk merapikan kolom angka.

### 6.4 Hierarki teks yang menjadi acuan

1. Brand dan judul halaman: 20–24px, bobot 900.
2. Judul panel: 14–20px sesuai konteks, bobot 700–900.
3. Nilai sensor utama: 36–48px, bobot 900; unit 18–20px.
4. Input dan data detail: 14px; label wizard 13px.
5. Deskripsi, metadata, status: 9–12px dengan alpha yang bervariasi.

Ini adalah pola aktual, bukan skala tipografi yang seluruhnya sudah ditokenisasi. Teks 9–11px dan alpha rendah perlu diuji keterbacaannya sebelum dijadikan standar untuk fitur baru.

## 7. Spacing dan ukuran

### 7.1 Skala spacing

Tailwind menetapkan `--spacing: 0.25rem`, setara 4px pada root 16px. Nilai yang umum digunakan:

| Utility multiplier | Ukuran | Contoh penerapan |
| --- | --- | --- |
| `0.5` | 2px | Padding vertikal badge |
| `1` | 4px | Padding container segmented control |
| `1.5` | 6px | Gap label, ikon, field |
| `2` | 8px | Gap tombol dan padding kecil |
| `2.5` | 10px | Padding vertikal input/tombol tertentu |
| `3` | 12px | Padding alert dan gap form |
| `4` | 16px | Gutter mobile, padding kartu sensor |
| `5` | 20px | Padding kartu batch/detail dan form mobile |
| `6` | 24px | Gap section/dashboard dan padding panel utama |
| `8` | 32px | Gutter desktop dan padding login |
| `12` | 48px | Padding vertikal halaman login |
| `16` | 64px | Ruang loading tertentu |

Tidak semua nilai berbasis kelipatan 4px: kode juga memiliki ukuran arbitrary serta utility pecahan seperti `py-0.2`. Dokumen ini tidak menyatakan seluruh aplikasi sudah mengikuti satu skala spacing secara ketat.

### 7.2 Dimensi komponen penting

| Elemen | Dimensi |
| --- | --- |
| Monogram brand / avatar header | 32 × 32px |
| Frame gambar sensor | 80 × 80px |
| Tombol ikon detail sesi | 42 × 42px |
| Trigger profil dan notifikasi | Minimum tinggi 44px; notifikasi juga minimum lebar 44px |
| Tab wizard dan banyak aksi utama | Minimum tinggi 44px |
| Ikon umum | 14, 16, 18, 20, atau 24px menurut konteks |
| Dot status koneksi | 6px |
| Dot kartu sensor / indikator grafik | 10px |
| Orb latar | 384 × 384px, blur 120px |

Ukuran target interaksi belum seragam. Contohnya, tombol dismiss pada `SuccessNotice` berukuran 20px, sedangkan tombol ikon sesi berukuran 42px.

## 8. Layout, grid, dan responsive behavior

### 8.1 Shell global

`app/layout.tsx` mendefinisikan wrapper `min-h-screen`, konten vertikal, lebar maksimum **1440px**, `mx-auto`, serta padding **16px** pada mobile dan **32px** mulai `md`. Lebar maksimum mencakup area padding container.

Susunan global:

```text
Latar gradasi + orb dekoratif
└── Container global, maksimum 1440px
    ├── Header
    ├── Main #konten-utama
    │   └── Konten sesuai route
    └── Footer
```

Gap antarbagian utama adalah 24px (`gap-6`). Header berada dalam alur halaman normal; belum menggunakan posisi sticky. Footer memakai teks kecil, tracking lebar, dan alpha putih 50%.

### 8.2 Breakpoint

| Breakpoint bawaan | Lebar minimum | Penerapan yang ditemukan |
| --- | --- | --- |
| Base | Di bawah 640px | Dashboard satu kolom; grid sensor dua kolom |
| `sm` | 640px | Label IoT dan detail profil muncul; beberapa form menjadi dua/tiga kolom |
| `md` | 768px | Padding global 32px; dashboard empat kolom; sensor empat kolom |
| `lg` | 1024px | Informasi last seen tampil; penyesuaian padding login |
| `xl` | 1280px | Tersedia dari Tailwind; bukan perpindahan layout utama aplikasi |
| `2xl` | 1536px | Tersedia dari Tailwind; container tetap dibatasi 1440px |

### 8.3 Grid dan lebar konten

| Area | Mobile | Mulai breakpoint terkait |
| --- | --- | --- |
| Dashboard utama | Satu kolom | `md:grid-cols-4`; metrik 1 kolom, grafik 2, ekspor 1 |
| Kartu sensor | 2 kolom | 4 kolom pada `md` |
| Daftar batch | 1 kolom | 2 kolom pada `md` |
| Wizard batch | Maksimum 768px (`max-w-3xl`) | Field umumnya 2 kolom pada `sm`; beberapa grup 3 kolom |
| Detail batch | Maksimum 896px (`max-w-4xl`) | Data pasangan label–nilai sampai 3 kolom pada `md` |
| Login | Lebar penuh hingga maksimum 448px | Tetap terpusat dengan padding tambahan halaman |
| Foto wizard | 3 kolom | 4 kolom pada `sm` |
| Foto detail batch | 3 kolom | 5 kolom pada `sm` |

Dashboard memiliki `min-h-[550px]`. Area grafik memiliki `min-h-[320px]`, berubah menjadi `sm:min-h-[220px]`; tinggi panel akhirnya juga dipengaruhi grid dan konten di dalamnya.

### 8.4 Overflow dan konten panjang

- Header memakai `flex-wrap` agar kelompok brand, navigasi, dan akun dapat berpindah baris.
- Navigasi chamber memakai `overflow-x-auto` dan label `whitespace-nowrap`.
- Email akun menggunakan `truncate` dan batas lebar 140/180px.
- Tabel telemetri memiliki minimum lebar 760px dan scroll di container modal.
- Tabel sesi detail batch memiliki minimum lebar 620px dan scroll horizontal lokal.
- Modal besar menggunakan batas tinggi viewport dan scroll internal.

Pemeriksaan mobile 390px hanya menjadi sampel. Keberadaan `overflow-hidden` pada shell tidak boleh dianggap bukti bahwa semua konten sudah bebas terpotong; uji isi panjang, banyak chamber, modal, dan zoom secara terpisah.

## 9. Surface, border, radius, dan elevation

### 9.1 Resep surface utama

Panel kaca utama berulang dengan pola:

```text
bg-white/10
backdrop-blur-lg
border border-white/20
rounded-2xl
shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]
```

Tidak semua kartu memakai seluruh resep tersebut. Kartu detail batch dan wizard misalnya memakai surface/border/blur yang serupa, tetapi tidak selalu memiliki bayangan eksplisit.

| Surface | Resep utama | Pemakaian |
| --- | --- | --- |
| Kaca utama | Putih 10%, blur 16px, border putih 20% | Header, metrik utama, grafik, sensor |
| Kaca sekunder | Putih 5%, border putih 10% | Metrik sekunder, status bar, empty state |
| Input gelap | Hitam 25–40%, border putih 10–20% | Form dan filter |
| Panel overlay biru | Gradasi `#24407F → #16295C`, border putih 15% | Menu, konfirmasi, foto, dialog sesi |
| Modal solid | `slate-900`, border putih 15% | Riwayat dan tambah chamber |

### 9.2 Radius

| Utility | Radius | Pemakaian |
| --- | --- | --- |
| `rounded` | 4px | Badge kecil |
| `rounded-md` | 6px | Badge tertentu |
| `rounded-lg` | 8px | Monogram, thumbnail, tombol kecil |
| `rounded-xl` | 12px | Input, tombol, kelompok navigasi |
| `rounded-2xl` | 16px | Kartu, header, dropdown, dialog |
| `rounded-3xl` | 24px | Login, modal riwayat, tambah chamber |
| `rounded-full` | Bentuk kapsul/lingkaran | Dot, spinner, badge tertentu |

### 9.3 Bayangan dan blur

| Efek | Nilai/kelas | Konteks |
| --- | --- | --- |
| Bayangan panel | `0 8px 32px 0 rgba(0,0,0,0.3)` | Header, metrik, grafik, sensor, ekspor |
| Bayangan login | `0 8px 32px 0 rgba(0,0,0,0.37)` | Kartu login |
| Bayangan dropdown | `0 20px 60px -10px rgba(0,0,0,0.7)` | Menu akun dan notifikasi |
| Elevation tambahan | `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-2xl` | Tombol, pilihan aktif, modal |
| Blur panel | `backdrop-blur-md/lg/xl` = 12/16/24px | Status/panel/login |
| Blur overlay | `backdrop-blur-sm` = 8px | Riwayat dan tambah chamber |
| Blur orb | `blur-[120px]` | Latar dekoratif |

### 9.4 Layering dan ukuran overlay

| Lapisan | Nilai yang ditemukan | Catatan |
| --- | --- | --- |
| Orb latar | `z-0` | `pointer-events-none` |
| Konten, header, sticky action | `z-10` | Nilai bergantung stacking context induk |
| Dropdown | `z-20` | Menu akun/notifikasi |
| Modal, toast, skip link saat fokus | `z-50` | Belum memiliki pemisahan layer yang terpusat |

| Overlay | Lebar maksimum | Tinggi maksimum |
| --- | --- | --- |
| Konfirmasi | 384px (`max-w-sm`) | Tidak diatur eksplisit pada komponen |
| Notifikasi / pra-sesi | 448px (`max-w-md`) | Pra-sesi 90vh |
| Tambah chamber | 576px (`max-w-xl`) | 90vh |
| Penampil foto | 672px (`max-w-2xl`) | 90vh |
| Tabel riwayat | 1024px (`max-w-5xl`) | 88vh |
| Menu akun | 256px | Dibatasi lebar viewport dengan `calc(100vw - 2rem)` |
| Dropdown notifikasi | 320px | Daftar internal maksimum tinggi 320px |

`CreateChamberModal` dipasang melalui React portal ke `document.body`. Modal lain masih berada dalam tree komponen masing-masing; nilai `z-50` yang sama tidak menjamin perilaku overlay identik dalam seluruh stacking context.

## 10. Ikon, identitas visual, dan gambar

### 10.1 Brand

- Identitas utama header adalah monogram teks `eS`, bukan berkas logo gambar.
- Frame monogram berukuran 32px, radius 8px, gradasi `from-cyan-500 to-blue-600` ke arah kanan atas.
- Wordmark `E-Sniffer` berukuran 20px dan menjadi 24px pada `md`, bobot 900, tracking 0.1em.
- Label `IoT Telemetry` berukuran 10px, uppercase, tersembunyi di bawah `sm`.
- `app/favicon.ico` menyediakan favicon. `LOGO_PROMPT.md` bukan sumber logo yang dirender header.

Belum ada pedoman resmi clear space, ukuran minimum logo lintas media, atau varian logo terang/gelap yang terpisah.

### 10.2 Ikon

Ikon UI menggunakan SVG inline dengan pola `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, stroke umumnya 2, serta ujung/sambungan membulat. Sebagian ikon menggunakan stroke 2.5.

`components/ui/icons.tsx` menyediakan `PencilIcon`, `RepeatIcon`, dan `CameraIcon`. Ikon lain seperti lonceng, unduh, tutup, mata, tambah, dan spinner masih didefinisikan pada komponen pemakainya.

Aturan penggunaan yang mengikuti implementasi: ikon mengikuti warna teks konteks; ikon dekoratif diberi `aria-hidden`; tombol ikon memiliki nama aksi melalui teks atau `aria-label`.

### 10.3 Aset gambar dan audio

| Aset | Penggunaan aktual |
| --- | --- |
| `public/mq137.png` | Foto modul MQ-137 |
| `public/mq136.png` | Foto modul MQ-136 |
| `public/mq4.png` | Foto modul MQ-4 |
| `public/dht22.png` | Foto perangkat DHT-22 |
| Foto unggahan batch/sesi | Dokumentasi pengadaan, kelompok sampel, dan tahap pengukuran |
| `public/assets/Better Call Saul Ringtone.mp3` | Audio notifikasi kesiapan sesi |

Foto sensor memakai frame 80px, `object-cover`, dan radius pada frame/gambar. Jika gagal dimuat, elemen gambar disembunyikan; tidak ada ilustrasi pengganti khusus. Pratinjau foto wizard memiliki tinggi 64px dan crop `object-cover`. Input unggah wizard menerima JPEG dan PNG.

Aset SVG seperti `next.svg`, `vercel.svg`, `globe.svg`, `file.svg`, dan `window.svg` ada di `public/`, tetapi tidak menjadi elemen utama halaman aplikasi yang dianalisis.

## 11. Katalog komponen

### 11.1 Header dan navigasi

**Sumber:** `components/layout/Header.tsx`.

Header berisi brand, navigasi chamber, tombol tambah chamber untuk ADMIN, lonceng notifikasi, serta menu akun. Navigasi disembunyikan pada `/login`. Tautan “Pencatatan” berada dalam menu akun; aplikasi belum menggunakan sidebar.

| State | Perlakuan visual/interaksi |
| --- | --- |
| Chamber aktif | `bg-cyan-500/25`, `text-cyan-200`, border cyan 40%; `aria-current="page"` pada daftar dinamis |
| Chamber tidak aktif | Teks putih 60%; hover menjadi putih dengan surface putih 5% |
| Profil hover/fokus | Surface putih 15%; ring emerald transparan |
| Menu terbuka | Panel gradasi biru; chevron diputar 180° |
| ADMIN / VIEWER | Badge emerald / indigo |
| Logout berjalan | Tombol disabled dan label “Keluar…” |

Menu profil mendukung fokus item pertama, Arrow Up/Down, Home/End, Escape, penutupan ketika Tab, dan klik luar. Escape mengembalikan fokus ke trigger.

### 11.2 Button dan link aksi

Belum ada satu komponen `Button` bersama. Varian berikut merangkum pola yang telah digunakan.

| Varian/konteks | Default | Hover | Focus / disabled |
| --- | --- | --- | --- |
| Utama login/perangkat | Gradasi cyan-500 → blue-600; teks putih | Cyan-400 → blue-500 | Login ring cyan dan offset slate; disabled opacity 50% |
| Utama pencatatan | Emerald-500/20, border emerald-500/40, teks emerald-200 | Emerald-500/30 | Wizard ring emerald; disabled opacity 50% |
| Ekspor | Gradasi emerald/teal transparan, border emerald | Alpha gradasi meningkat | Label proses dan spinner; disabled opacity 50% |
| Netral/ghost | Putih 5–10%, border putih 10–20%, teks putih 60–90% | Putih 10–15% | Ring putih/cyan sesuai pemakai |
| Destructive | Rose-500/15 hingga /25, border rose, teks rose-100/200/300 | Alpha rose meningkat | Disabled opacity 50% pada banyak aksi |
| Ikon sesi | 42px, putih 5%, border putih 15% | Putih 10% | Ring cyan; tooltip/title dan label aksi |

Padding umum tombol adalah `px-4 py-2`, radius 12px, ukuran teks 12–14px. Wizard memakai tombol utama penuh dengan `py-3`. Label uppercase digunakan pada login dan ekspor, tetapi bukan seluruh tombol.

State `pressed/active` saat tombol ditekan belum mempunyai resep global. State *selected* pada tab/navigation memiliki warna tersendiri dan tidak sama dengan state tekan tombol.

### 11.3 MetricCard

**Sumber:** `components/ui/MetricCard.tsx`.

| Aspek | Spesifikasi |
| --- | --- |
| Isi | `title`, `value`, `unit`, `subtitle`, `quality`, badge tambahan opsional |
| Varian | `isPrimary=true`: putih 10%, border putih 20%; sekunder: putih 5%, border putih 10% |
| Ukuran | Padding 24px; radius 16px; nilai 36 → 48px |
| Angka | Number diformat satu desimal |
| Kosong | `null`, `undefined`, atau string kosong menjadi `--` |
| Quality | OK tanpa badge; OUT_OF_RANGE amber “Range Warn”; SENSOR_ERROR/DISCONNECTED rose “Error” |

Kartu suhu menggunakan varian primary; kelembaban memakai varian sekunder. Unit ditampilkan lebih kecil dengan warna cyan transparan.

### 11.4 SensorCard

**Sumber:** `components/ui/SensorCard.tsx`.

Kartu memiliki surface putih 10%, blur, border putih 20%, radius 16px, padding 16px, alignment tengah, dan hover surface putih 15%.

Props utamanya: `imageSrc`, `name`, `compound`, `value`, `unit`, `quality`, `dotColorClass`, dan `compoundColorClass`. Angka memakai dua desimal; `null` menjadi `--`. Bila `value` tidak diberikan, kartu menampilkan keterangan compound/ringkasan, seperti DHT-22.

Quality selain OK ditampilkan dengan badge amber dan nama quality apa adanya. Ini berbeda dari pemetaan rose untuk error pada `MetricCard`. Hover kartu saat ini bersifat visual; kartu bukan otomatis tautan atau tombol.

### 11.5 Kartu batch dan pasangan data

- Kartu daftar batch: padding 20px, radius 16px, surface putih 10%, border putih 20%, hover putih 15%.
- Isi utama: ID batch, badge “Terbuka”/“Terkunci”, tanggal, jumlah udang, dan berat.
- Untuk ADMIN tersedia checkbox seleksi batch dan aksi hapus terpilih.
- `DataPair` di halaman detail menggunakan elemen `dt`/`dd`: label 11px putih 55%, nilai 14px semibold putih, nilai kosong putih 30%.

### 11.6 ConfirmDialog

**Sumber:** `components/ui/ConfirmDialog.tsx`.

Dialog konfirmasi memakai overlay hitam 60%, panel gradasi biru, radius 16px, padding 20px, dan maksimum lebar 384px.

Props: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `tone`, `busy`, `error`, `onConfirm`, `onCancel`.

- `tone="danger"`: tombol konfirmasi rose.
- `tone="primary"`: tombol konfirmasi emerald.
- Fokus awal menuju tombol Batal.
- Escape dan klik backdrop memanggil pembatalan.
- `busy` menonaktifkan kedua tombol dan mengganti label konfirmasi menjadi “Memproses…”.
- Error ditampilkan dalam panel rose di dalam dialog.
- Menggunakan `role="alertdialog"`, `aria-modal`, `aria-labelledby`, dan `aria-describedby`.

Fokus terperangkap di dalam modal dan pemulihan fokus ke trigger belum diimplementasikan secara lengkap pada komponen ini.

### 11.7 CreateChamberModal

**Sumber:** `components/chambers/CreateChamberModal.tsx`.

Modal solid slate dengan radius 24px, maksimum lebar 576px dan tinggi 90vh. Header/footer terpisah; bagian form dapat digulir. Overlay hitam 75% dengan blur 8px.

Form mencakup kode, nama, deskripsi, status aktif, dan opsi pasangan perangkat: alat baru, alat terdaftar, atau lewati. Aksi simpan bergradasi cyan–blue. Fokus awal menuju input pertama, scroll body dikunci selama modal terbuka, dan Escape/backdrop menutup modal.

Keberhasilan mengubah isi modal menjadi ringkasan pendaftaran/perangkat dengan warna emerald. Tampilan keberhasilan ini didokumentasikan dari kode; pembuatan chamber baru tidak diperlukan untuk analisis design system.

### 11.8 ExportPanel dan tabel riwayat

**Sumber:** `components/layout/ExportPanel.tsx`.

Panel ringkas menampilkan judul “Data & Ekspor”, rentang aktif, penjelasan, tombol unduh CSV, tombol tabel riwayat, dan tautan audit bila tersedia perangkat aktif.

Modal riwayat memuat preset 1 jam, 6 jam, 12 jam, 24 jam, 7 hari, 30 hari, 1 tahun, serta rentang tanggal/jam kustom. Tabel berisi waktu ukur, suhu, kelembaban, MQ-137, MQ-136, MQ-4, dan kualitas waktu; pagination menampilkan **15 baris per halaman**.

Header tabel sticky; angka rata kanan; kolom numerik memakai `tabular-nums`. Baris selang-seling memiliki surface putih 2%, hover cyan 6%, dan divider putih 5%. Loading awal memakai skeleton delapan baris; loading ulang dapat meredupkan data yang masih ditampilkan.

### 11.9 NotificationBell dan SuccessNotice

| Komponen | Perilaku dan gaya |
| --- | --- |
| `NotificationBell` | Trigger minimum 44px; badge rose untuk unread; hitungan di atas 9 ditulis `9+`; dropdown gradasi biru |
| Modal kesiapan sesi | Ikon centang emerald; judul “Sesi Siap Dimulai”; checkbox audio; panel maksimum 448px |
| `SuccessNotice` | Toast fixed kanan bawah; emerald-600/80, border emerald-400/50, blur dan bayangan; `role="status"`, `aria-live="polite"` |
| `useSuccessNotice` | Pesan menghilang setelah 5000ms atau ditutup pengguna |

Pada mobile, toast memakai offset kiri dan kanan 16px; mulai `sm` menggunakan posisi kanan dengan maksimum lebar 448px. Audio notifikasi bergantung izin autoplay browser dan interaksi pengguna; audio bukan satu-satunya indikator kesiapan.

## 12. Form dan validasi

### 12.1 Anatomi field

Urutan field yang digunakan wizard:

```text
Label + penanda wajib (*)
Input / select / radio
Helper text atau pesan error
```

| Elemen | Spesifikasi wizard batch |
| --- | --- |
| Wrapper field | Kolom vertikal, gap 6px |
| Label | 13px, semibold, putih 85% |
| Input | Lebar penuh, `px-3 py-2.5`, radius 12px, hitam 25%, border putih 10%, teks 14px |
| Placeholder | Putih 30% |
| Helper text | 12px, putih 70% |
| Required mark | Bintang rose-400; penjelasan arti tanda pada awal halaman |
| Input focus | Border emerald-400/60 dan ring emerald-400/50 2px |
| Invalid | Border rose-400/60, ring rose-300/50, pesan 11px rose-300 |

Login menggunakan padding lebih besar (`px-4 py-3`), border putih 20%, dan focus ring cyan. Form perangkat memiliki beberapa field lebih padat dengan padding 6–8px serta focus border cyan. Form edit detail batch memakai input 14px dan focus border emerald, tetapi belum seluruh ring mengikuti wizard.

### 12.2 Jenis kontrol

| Kontrol | Pola yang ada |
| --- | --- |
| Text / email / password | Surface gelap; toggle tampil/sembunyi password pada login dan perangkat |
| Number | Unit disebut pada label; batas dan step mengikuti field; beberapa memakai `inputMode="decimal"` |
| Datetime-local | Label waktu WIB pada pencatatan; wizard menggunakan `[color-scheme:dark]` |
| Select | Kontrol native dengan styling gelap; isi option mengikuti konteks |
| Radio wizard | Radio native di dalam label berbentuk chip/kartu; pilihan aktif emerald |
| Radio edit detail | Radio native beraksen cyan; tampilan lebih ringkas daripada wizard |
| Checkbox | Aksen emerald untuk proses, rose untuk seleksi hapus, cyan pada konteks tertentu |
| File upload | Foto JPEG/PNG, preview, caption per gambar, dan aksi hapus |

Catatan wizard setelah revisi langkah “Kondisi Udang”:

- **Kondisi awal udang** memakai radio chip native (dua pilihan: mati/hidup), bukan select. Fieldset-nya ber-`tabIndex={-1}` agar fokus programatik dari pesan error mendarat di grup pilihan.
- **Jumlah total udang (ekor)** (minimal 1, acuan 1–10; di luar acuan hanya peringatan amber) memunculkan daftar **pengukuran per ekor** di area bergulir `max-h-80`: setiap baris “Udang N” punya input suhu (°C) dan panjang (cm) **tanpa rentang** dan menerima desimal (maks 2 angka desimal). Baris 1-based sehingga pesan error memakai kode `shrimpTemp-N` / `shrimpLength-N`. Baris di luar viewport memakai `content-visibility: auto` agar jumlah besar tetap ringan.
- **Suhu cool box** (berangkat, di pasar, di lab) menerima angka desimal apa pun; nilai di luar acuan **0–4 °C** hanya memunculkan peringatan `role="status"` di bawah input (bukan galat) sehingga data tetap bisa disimpan.
- **Suhu awal udang saat pembelian (°C)** dan **Panjang udang (cm)** di bawah daftar bersifat **disabled** dan terisi otomatis dari rata-rata baris tersebut (pembulatan 2 desimal), dengan helper text yang menyebut asal angkanya.
- **Berat total udang saat pembelian (g)** tetap satu kolom karena berat ditimbang sekaligus untuk semua udang.
- Langkah **Pengelompokan** memuat waktu tiba, suhu cool box di lab, dan **dua** kolom jumlah udang per sesi: **suhu ruang (SR)** dan **suhu dingin (SD)**.
- **Temuan visual udang** berada di langkah Kondisi Udang dan berlaku untuk kedua grup.

### 12.3 Validasi dan progres

- Wizard terdiri dari “Pengadaan”, “Kondisi Udang”, dan “Pengelompokan”.
- Melompat ke langkah berikutnya memvalidasi langkah yang dilewati.
- Field invalid diberi `aria-invalid`; sejumlah field juga memiliki `aria-required`.
- Error tampil dekat field dan tersedia error tingkat form dengan `role="alert"`.
- Fokus diarahkan ke field bermasalah; error dapat dibersihkan ketika nilainya diperbaiki.
- Pesan menjelaskan syarat secara konkret, misalnya “Wajib diisi.” atau batas jam pengadaan.
- Aksi utama memakai label tujuan langkah, misalnya “Lanjut ke Kondisi Udang”.
- Tombol bawah wizard berada dalam action bar sticky dengan latar `slate-900/85`, blur, border, dan radius 16px.

Aturan bisnis seperti rentang suhu, urutan keberangkatan–pembelian–kedatangan, dan jendela 05:00–08:00 WIB berasal dari `lib/batch-wizard.ts` dan `shared/dataset.ts`. Jangan menduplikasi aturan ini sebagai nilai desain yang terpisah.

Draf dipulihkan dari penyimpanan browser. Banner cyan menjelaskan bahwa foto tidak ikut tersimpan dan perlu dipilih ulang. Tombol “Isi otomatis (data tes)” masih diaktifkan oleh `AUTO_FILL_ENABLED = true`; ini adalah alat bantu pengujian yang terlihat saat analisis, bukan fondasi desain produk.

## 13. Visualisasi data dan aturan penyajian angka

### 13.1 Spesifikasi grafik

**Sumber:** `components/charts/ChartPanel.tsx`.

| Properti | Implementasi |
| --- | --- |
| Library / tipe | Recharts, `LineChart`, garis `type="monotone"` |
| Seri | MQ-137, MQ-136, MQ-4 |
| Satuan | Nilai mentah ADC, ditulis `raw`; tidak diberi satuan ppm |
| Preset rentang | `30s`, `1m`, `15m`, `1h`, `6h`, `24h`; default `1h` |
| Lebar grafik | Mengikuti `ResponsiveContainer` |
| Tebal garis | 2.5px |
| Titik | Dot normal disembunyikan; active dot radius 5px |
| Grid | Horizontal; dash `3 3`; warna literal `#ffffff15` |
| Axis | Warna literal `#ffffff60`, font 11px; axis/tick line disembunyikan |
| Legend | Atas kanan, monospace 11px |
| Tooltip | Monospace 12px, radius 12px, border putih 20%, latar slate 95% |
| Nilai tooltip | Dua desimal dengan suffix `raw` |
| Animasi seri | `isAnimationActive={false}` |
| Data kosong | `connectNulls={false}`; garis tidak disambungkan melewati nilai null |

Suffix `15` dan `60` pada warna HEX delapan digit di atas adalah alpha HEX, **bukan** opacity 15% dan 60%. `#ffffff15` sekitar 8.2% putih dan `#ffffff60` sekitar 37.6% putih.

### 13.2 Semantik Live, Riwayat, dan koneksi

Status **Live** menunjukkan jendela waktu grafik yang mengikuti waktu berjalan. Status **Riwayat** menunjukkan jendela historis yang disematkan. Live tidak menjamin perangkat sedang ONLINE; status koneksi perangkat disajikan pada badge yang berbeda.

Jika rentang kosong tetapi ada pembacaan terdahulu, UI menawarkan “Tampilkan data terakhir”. Jika fetch gagal, UI menampilkan pesan dan aksi coba lagi. Keterangan di bawah grafik menjelaskan bahwa `--` berarti tidak ada data dan garis terputus berarti tidak ada kiriman alat.

### 13.3 Format angka, unit, dan nilai kosong

| Konteks | Format aktual |
| --- | --- |
| MetricCard suhu/kelembaban | `toFixed(1)`, contoh `27.5`; unit `°C` dan `%RH` |
| SensorCard gas | `toFixed(2)`, contoh `450.00 raw` |
| Tooltip grafik | Dua desimal, suffix `raw` |
| Tabel telemetri | Umumnya satu desimal dan rata kanan |
| Detail pencatatan batch | `Intl.NumberFormat('id-ID')`, maksimum satu desimal |
| Tabel suhu/berat sesi | `Intl.NumberFormat('id-ID')`, maksimum dua desimal |
| Angka kosong monitoring | `--` |
| Nilai kosong detail batch | Em dash `—` |
| Berat/panjang/jumlah | `g`, `cm`, dan `ekor` pada konteks pencatatan |

Data yang tidak ada tidak boleh diganti angka nol. Nilai raw ADC tidak boleh dilabeli sebagai konsentrasi gas terkalibrasi. Pembulatan dan pemisah desimal saat ini berbeda antara monitoring dan pencatatan; hal ini merupakan temuan standardisasi.

## 14. Status, feedback, dan notifikasi

### 14.1 Matriks status

| Domain/status | Visual | Label/perlakuan |
| --- | --- | --- |
| Perangkat ONLINE | Emerald | Dot berdenyut dan label ONLINE |
| Perangkat OFFLINE | Rose | Dot dan label OFFLINE |
| Koneksi belum pasti | Amber | Label status dari koneksi |
| Belum ada perangkat | Netral putih redup | “Device: Belum Terpasang” |
| Fresh | Cyan | Data berumur ≤15 detik menurut logika halaman |
| Stale | Amber | “Stale (…s)” dengan umur data |
| Waktu belum diketahui | Netral | “Unknown Time” |
| Permintaan berjalan baik | Emerald | “Poller OK” |
| Loading awal | Cyan | “Connecting…” / spinner |
| Pengambilan data terganggu | Rose, pulse | “Degraded (Cached)” |
| Grafik Live | Cyan, ping | Rentang waktu berjalan |
| Grafik Riwayat | Amber | Rentang historis tersemat |
| Sensor out of range pada MetricCard | Amber | “Range Warn” |
| Sensor error/disconnected pada MetricCard | Rose | “Error” |
| Quality non-OK pada SensorCard | Amber | Nilai quality apa adanya |
| Batch terbuka | Emerald | “Terbuka” |
| Batch terkunci | Netral | “Terkunci” |
| Sesi open | Cyan | `open` |
| Sesi complete | Emerald | `complete` |
| Sesi incomplete | Netral | `incomplete`, dengan penjelasan dan aksi ulang bila tersedia |
| Kualitas waktu SYNCED | Emerald | Badge tabel |
| Kualitas waktu RECONSTRUCTED | Amber | Badge tabel |
| Kualitas waktu lainnya | Netral | Badge tabel |

Koneksi, freshness, quality sensor, quality waktu, dan kondisi request adalah dimensi berbeda. Jangan menyatukannya menjadi satu badge “normal/error” karena makna informasinya akan hilang.

### 14.2 Loading, empty, error, success

| Kondisi | Pola antarmuka |
| --- | --- |
| Loading halaman | Spinner cyan/putih dan ruang kosong terpusat |
| Loading aksi | Tombol disabled, spinner, label “Memverifikasi…”, “Menyimpan…”, atau “Menyiapkan CSV…” |
| Loading tabel | Skeleton; data lama tetap dapat dirender dengan opacity berkurang |
| Tidak ada batch | Panel netral terpusat, pesan untuk membuat batch pertama |
| Tidak ada chamber | Ikon, judul informatif, aksi coba lagi/tambah sesuai akses |
| Tidak ada data rentang | Penjelasan rentang dan aksi membuka data terakhir jika tersedia |
| Request gagal | Alert rose dan aksi pemulihan sesuai konteks |
| Mode riwayat karena alat offline | Banner amber yang menjelaskan data terakhir tersimpan |
| Mutasi berhasil | Toast emerald atau layar keberhasilan pada modal |

Hasil keberhasilan mutasi, seluruh error, dan notifikasi otomatis tidak dipicu satu per satu dalam pemeriksaan visual; spesifikasinya didasarkan pada implementasi komponen.

## 15. Pola halaman dan alur interaksi

| Halaman | Susunan dan pola penting |
| --- | --- |
| `/` | Loading autentikasi → login bila belum masuk; pengguna terautentikasi diarahkan ke chamber aktif pertama; empty/error state bila chamber tidak tersedia |
| `/login` | Header brand, kartu login terpusat, email, password/toggle, error autentikasi, tombol penuh, footer |
| `/chamber/[chamberId]` | Status chamber → banner kondisi → metrik/grafik/ekspor → empat kartu sensor → footer |
| `/batches` | Heading dan aksi → section menurut sumber/pasar → kartu batch → seleksi/hapus untuk ADMIN |
| `/batches/new` | Heading/progres → banner draf bila ada → tab tiga langkah → form aktif → action bar sticky |
| `/batches/[batchId]` | Heading/status/aksi → data pencatatan/edit → foto → kartu grup → tabel riwayat sesi → aksi sesi dan dialog terkait |

### 15.1 Alur monitoring

1. Masuk ke aplikasi dan pilih chamber di header.
2. Periksa koneksi perangkat, freshness, dan kondisi request.
3. Baca suhu/kelembaban, tiga seri gas, dan kartu perangkat.
4. Ubah rentang grafik atau buka pembacaan historis terakhir.
5. Buka tabel riwayat atau unduh CSV.

### 15.2 Alur pencatatan

1. Buka menu akun → Pencatatan.
2. Pilih batch atau buat batch baru bila peran mengizinkan.
3. Isi pengadaan, kondisi/dokumentasi, lalu pengelompokan.
4. Tinjau data batch, foto, grup penyimpanan, dan timepoint.
5. Jalankan, lengkapi, edit, atau ulangi sesi sesuai status dan hak akses.

### 15.3 Pola akses berdasarkan peran

ADMIN memiliki aksi pengelolaan seperti tambah/hapus chamber, pembuatan/pengeditan/penghapusan batch dan pengelolaan sesi, sesuai guard halaman dan status data. VIEWER berfokus pada pembacaan/monitoring; aksi mutasi tertentu disembunyikan atau dibatasi. Batch terkunci membatasi aksi pengeditan.

Visibilitas tombol merupakan bagian presentasi. Aturan otorisasi sebenarnya tetap mengikuti API dan guard aplikasi; dokumen desain ini bukan pengganti matriks izin backend.

## 16. Motion dan microinteraction

| Efek | Implementasi | Fungsi |
| --- | --- | --- |
| Transisi warna | `transition-colors` | Tombol, item menu, pilihan |
| Transisi umum | `transition-all` | Surface dan aksi tertentu |
| Transform | `transition-transform` | Chevron menu, monogram hover |
| Durasi default | 150ms dari theme Tailwind | Bila komponen tidak menimpa durasi |
| Spinner | `animate-spin`, 1s linear infinite | Menunjukkan proses |
| Pulse | `animate-pulse`, 2s infinite | Orb biru, status, skeleton |
| Ping | `animate-ping`, 1s infinite | Indikator Live dan riwayat telemetri |
| Brand hover | `group-hover:scale-105` | Membesarkan monogram menjadi 105% |
| Chevron menu | `rotate-180` | Menandai menu terbuka |
| Grafik | Animasi garis dimatikan | Menjaga pembaruan data tanpa tween seri |

Belum ditemukan override aplikasi untuk `prefers-reduced-motion` atau kelas `motion-reduce` pada komponen yang dianalisis. Token durasi khusus produk, transisi modal terpadu, dan aturan easing per jenis interaksi belum tersedia.

## 17. Accessibility

### 17.1 Dukungan yang sudah diterapkan

- `html lang="id"` dan landmark header, nav, main, footer.
- Skip link “Lewati ke konten utama” menuju `#konten-utama`, terlihat saat fokus.
- Menu profil memakai atribut menu serta navigasi keyboard dan pemulihan fokus saat Escape.
- Sejumlah dialog memakai `aria-modal`, nama dialog, deskripsi, fokus awal, dan Escape/backdrop.
- Wizard memiliki label input, required/invalid state, error alert, progress text, serta fokus ke field bermasalah.
- Tombol ikon penting memiliki `aria-label` atau teks pendamping.
- Toast sukses memakai live region polite; error menggunakan `role="alert"` pada banyak lokasi.
- Header tabel memakai `th scope="col"`.
- Warna status disertai label teks; null sensor tidak dipresentasikan sebagai nol.
- Banyak kontrol menggunakan `focus-visible:ring-2` dan minimum target 44px.

### 17.2 Batasan yang perlu diperhatikan

| Area | Kondisi yang ditemukan | Rekomendasi |
| --- | --- | --- |
| Keterbacaan | Teks teknis 9–11px; sejumlah teks putih alpha 30–50% | Uji kontras terhadap hasil komposit gradasi/panel dan uji pembesaran teks |
| Modal | Focus trap, restore focus, dan penguncian scroll belum seragam | Buat primitive dialog bersama dengan perilaku keyboard yang konsisten |
| Target sentuh | Ada tombol 42px, dismiss 20px, dan aksi teks yang lebih kecil | Tetapkan ukuran target produk dan rapikan pengecualian |
| Wizard tabs | Ada `role="tablist"`/`role="tab"` dan `aria-selected` | Lengkapi pola tab, relasi panel, dan interaksi keyboard bila tetap memakai semantik tabs |
| Dropdown notifikasi | Menggunakan role menu; interaksinya tidak selengkap menu profil | Samakan semantik dan dukungan keyboard dengan jenis kontennya |
| Motion | Pulse/ping berulang tanpa override reduced motion aplikasi | Tambahkan perilaku pengurangan gerak |
| Grafik | Informasi visual disertai legend dan tabel riwayat | Evaluasi pengalaman keyboard, pembaca layar, dan pembacaan alternatif data |
| Form | Error dekat field tersedia, relasi deskripsi belum seragam | Hubungkan helper/error melalui `aria-describedby` secara konsisten |

Belum dilakukan pengukuran rasio kontras untuk seluruh kondisi komposit, audit pembaca layar, ataupun sertifikasi aksesibilitas. Karena itu dokumen ini tidak menyatakan aplikasi telah memenuhi tingkat kepatuhan tertentu.

## 18. UX writing dan lokalisasi

### 18.1 Gaya bahasa yang digunakan

Bahasa utama bersifat langsung dan operasional: “Masuk Sesi”, “Batch baru”, “Tabel Riwayat”, “Batal”, “Coba lagi”, “Simpan”, dan “Lanjut ke …”. Instruksi form menjelaskan waktu, unit, atau metode pengukuran di dekat field.

Istilah teknis yang tetap terlihat meliputi Chamber, Live, Poller OK, Degraded (Cached), Fresh, Stale, Unknown Time, open, complete, incomplete, raw, dan cleaning. Kapitalisasi dan istilah belum sepenuhnya seragam antarhalaman.

### 18.2 Pola pesan

| Jenis pesan | Pola yang digunakan/diikuti |
| --- | --- |
| Aksi | Kata kerja + objek: “Unduh CSV”, “Tambah Chamber”, “Buang draf” |
| Proses | Kata kerja proses: “Memverifikasi…”, “Mengunduh…”, “Memuat…” |
| Error | Jelaskan hal yang gagal dan berikan aksi bila tersedia |
| Validasi | Sebut syarat spesifik: wajib, rentang nilai, format, atau urutan waktu |
| Kosong | Jelaskan apa yang belum ada dan langkah berikutnya |
| Data historis | Sebut bahwa data terakhir masih tersedia ketika alat offline |
| Pemulihan draf | Jelaskan batas penyimpanan browser serta foto yang perlu dipilih ulang |

### 18.3 Waktu, angka, dan unit

- Pencatatan batch secara eksplisit memakai **WIB / Asia/Jakarta** melalui formatter dan konversi di `shared/dataset.ts` serta formatter detail batch.
- Sebagian waktu monitoring, grafik, tabel, dan notifikasi memakai `toLocaleString('id-ID')` atau `toLocaleTimeString('id-ID')` tanpa `timeZone` eksplisit. Locale Indonesia tidak otomatis menjamin zona WIB; hasil dapat mengikuti zona browser.
- Kontrol native `datetime-local` dapat menampilkan format mengikuti browser/OS, walaupun label dan interpretasi datanya adalah WIB.
- Monitoring menggunakan titik desimal dari `toFixed`; detail pencatatan memakai formatter Indonesia dengan koma desimal.
- Istilah satuan kelembaban bervariasi antara `%`, `%RH`, dan label “Kel”.

Untuk pengembangan berikutnya, pilih satu kamus istilah, format waktu, dan aturan pembulatan per jenis data sebelum menyatukan tampilannya. Jangan mengubah interpretasi data hanya demi konsistensi visual.

## 19. Panduan penggunaan dan pengembangan

### 19.1 Gunakan pola sesuai konteks

| Ketika membuat… | Ikuti pola… |
| --- | --- |
| Panel monitoring baru | Surface kaca utama, radius 16px, padding 24px, aksen cyan |
| Form pencatatan baru | `inputCls` dan struktur field wizard; label, unit, helper/error yang jelas |
| Aksi pencatatan | Emerald transparan, teks emerald terang, label kata kerja |
| Aksi penghapusan | Rose dan dialog konfirmasi dengan objek yang jelas |
| Nilai sensor utama | MetricCard; format unit dan quality terpisah |
| Ringkasan perangkat sensor | SensorCard; nama, foto, dot, unit, dan quality |
| Data tabular | Scroll lokal, header jelas, angka rata kanan, placeholder kosong eksplisit |
| Feedback keberhasilan mutasi | SuccessNotice atau ringkasan keberhasilan sesuai alur |
| Status koneksi/data | Badge terpisah untuk koneksi, freshness, quality, dan request |

### 19.2 Hal yang perlu dihindari

- Mengganti data kosong dengan `0`, menyambungkan garis grafik melintasi null, atau mengganti label raw menjadi ppm.
- Menganggap kelas `font-mono` membuktikan Geist Mono sudah dirender.
- Menambahkan palet baru untuk status yang sudah memiliki padanan warna.
- Menggunakan surface transparan tanpa mempertimbangkan latar dan kontras teksnya.
- Menyatakan seluruh tombol memiliki state fokus, disabled, atau ukuran target yang sama; implementasi saat ini masih bervariasi.
- Membuat tabel lebar yang memaksa halaman mobile ikut melebar.
- Membuat status hanya berupa dot warna tanpa label.
- Menganggap “Live” berarti perangkat ONLINE.
- Menganggap semua modal sudah memiliki focus trap hanya karena memakai `aria-modal`.

### 19.3 Checklist review perubahan UI

- [ ] Warna, radius, padding, dan ukuran teks mengikuti pola konteks yang sudah ada.
- [ ] Font hasil render sesuai keputusan desain, dibuktikan dengan computed style.
- [ ] Default, hover, focus-visible, loading, selected, disabled, error, dan empty state ditinjau bila relevan.
- [ ] Teks tombol menjelaskan aksi dan unit data tidak ambigu.
- [ ] Nilai null, nol, data stale, dan request gagal tetap dapat dibedakan.
- [ ] Layout diuji pada lebar mobile, breakpoint `md`, desktop, dan konten panjang.
- [ ] Keyboard dapat mengakses kontrol; modal dan dropdown menjaga alur fokus.
- [ ] Tabel dan foto menggulir di container yang tepat.
- [ ] Penambahan/pengubahan pola bersama dicatat pada dokumen ini.

Checklist ini adalah panduan pemeliharaan berikutnya, bukan pernyataan bahwa seluruh butir telah lulus pada implementasi sekarang.

## 20. Temuan dan rekomendasi standardisasi

Semua rekomendasi pada bagian ini **belum diterapkan oleh pembuatan dokumen ini**.

| Prioritas | Temuan aktual | Dampak | Rekomendasi |
| --- | --- | --- | --- |
| Tinggi | Alias Geist tidak mempunyai sumber font aktif | Maksud `font-sans`/`font-mono` berbeda dari render Arial | Putuskan font resmi; muat melalui mekanisme font proyek atau gunakan stack sistem yang eksplisit |
| Tinggi | Teks kecil dan alpha rendah pada surface transparan | Keterbacaan berubah menurut latar | Ukur kontras hasil komposit dan rapikan skala teks metadata |
| Tinggi | Perilaku fokus modal tidak seragam | Navigasi keyboard dapat keluar dari dialog | Konsolidasikan primitive dialog, focus trap, restore focus, dan scroll lock |
| Menengah | Warna MQ-4 berbeda antara grafik/dot dan tabel/unit | Identitas seri kurang konsisten | Buat satu pemetaan warna sensor yang dipakai seluruh representasi |
| Menengah | Quality error pada MetricCard rose, SensorCard amber | Arti warna quality berbeda antarkartu | Buat satu pemetaan quality dan label yang disepakati |
| Menengah | Button/Input/Badge/Card tersebar di konstanta lokal | Perubahan mudah menghasilkan variasi tak sengaja | Ekstrak primitive dengan varian monitoring, pencatatan, netral, destructive |
| Menengah | Token produk sangat terbatas | Warna dan ukuran yang sama tersebar di TSX | Bentuk lapisan primitive → semantic → component setelah nilai aktual disepakati |
| Menengah | Media query dark hanya mengubah token dasar | Tidak ada dukungan tema terang/gelap yang utuh | Dokumentasikan tema gelap sebagai tema aktif; rancang tema tambahan bila dibutuhkan |
| Menengah | Format angka dan zona waktu tidak seragam | Data serupa dapat terbaca berbeda | Satukan formatter menurut jenis data dan beri zona waktu eksplisit |
| Menengah | Target klik dan reduced motion belum seragam | Pengalaman mobile/keyboard/gerak berbeda | Standarkan ukuran target dan perilaku reduced motion |
| Menengah | Modal, toast, skip link berbagi z-50 | Potensi konflik stacking | Tetapkan skala layer dan kebijakan portal bersama |
| Rendah | Campuran istilah dan kapitalisasi | Beban memahami status bertambah | Susun kamus UI dan aturan kapitalisasi |
| Rendah | Alat bantu isi otomatis masih tampil | Tampilan uji bercampur alur pengadaan | Tentukan visibilitas alat bantu berdasarkan kebutuhan pengujian |

### 20.1 Kandidat token semantik

Nama berikut adalah **usulan**, bukan variabel yang saat ini sudah tersedia:

| Kandidat | Pemetaan awal berdasarkan implementasi |
| --- | --- |
| `--surface-panel` | Putih 10% |
| `--surface-subtle` | Putih 5% |
| `--surface-input` | Hitam 25% |
| `--border-panel` | Putih 20% |
| `--border-subtle` | Putih 10% |
| `--text-primary` | Putih |
| `--text-secondary` | Putih 70%, perlu validasi keterbacaan |
| `--action-monitoring` | Cyan |
| `--action-recording` | Emerald |
| `--status-warning` | Amber |
| `--status-danger` | Rose |
| `--radius-control` | 12px |
| `--radius-panel` | 16px |
| `--space-section` | 24px |

Jangan langsung mengganti seluruh variasi lokal dengan kandidat ini. Sejumlah perbedaan memang terkait konteks, seperti tombol login bergradasi, input pencatatan berfokus emerald, dan modal solid untuk tabel yang padat.

## 21. Pemeliharaan dan referensi sumber

### 21.1 Urutan sumber acuan

1. Source code pada checkout yang digunakan menjadi acuan nilai dan perilaku implementasi.
2. Render browser serta computed style menjadi acuan hasil CSS yang benar-benar diterapkan.
3. Dokumen ini merangkum keduanya; bila kode berubah, dokumen perlu diperbarui.
4. Rekomendasi baru menjadi standar setelah diputuskan dan diterapkan, bukan hanya karena tercantum di dokumen.

Versi dokumen perlu diperbarui ketika font, palette, layout global, komponen bersama, format data, atau state interaksi berubah. Catat tanggal, sumber perubahan, bagian yang terdampak, dan pemeriksaan visual yang dilakukan. Pemilik formal design system dan prosedur persetujuan perubahan belum ditetapkan pada implementasi yang dianalisis.

### 21.2 Indeks sumber implementasi

Tautan berikut relatif terhadap lokasi dokumen agar tetap dapat digunakan ketika repository dipindahkan.

| Sumber | Spesifikasi yang dirujuk |
| --- | --- |
| [package.json](package.json) | Stack dan versi dependency |
| [app/layout.tsx](app/layout.tsx) | Shell, latar, orb, padding, header/footer, skip link |
| [app/globals.css](app/globals.css) | Token dasar, alias font, body, media query dark |
| [app/page.tsx](app/page.tsx) | Pengarahan awal dan empty/error/loading |
| [app/login/page.tsx](app/login/page.tsx) | Login, field, fokus, tombol gradasi |
| [app/chamber/[chamberId]/page.tsx](app/chamber/%5BchamberId%5D/page.tsx) | Grid monitoring, badge status, pemetaan sensor |
| [app/batches/page.tsx](app/batches/page.tsx) | Daftar batch, pengelompokan, kartu, seleksi |
| [app/batches/new/page.tsx](app/batches/new/page.tsx) | Wizard, konstanta gaya, validasi UI, draf, upload |
| [app/batches/[batchId]/page.tsx](app/batches/%5BbatchId%5D/page.tsx) | DataPair, form edit, tabel sesi, foto, dialog |
| [Header.tsx](components/layout/Header.tsx) | Brand, navigasi, menu akun dan peran |
| [NotificationBell.tsx](components/layout/NotificationBell.tsx) | Dropdown, unread, modal kesiapan, audio |
| [ExportPanel.tsx](components/layout/ExportPanel.tsx) | Panel CSV, modal riwayat, skeleton, pagination |
| [ChartPanel.tsx](components/charts/ChartPanel.tsx) | Grafik, warna literal, axis, tooltip, mode rentang |
| [CreateChamberModal.tsx](components/chambers/CreateChamberModal.tsx) | Portal, form perangkat, modal dan layar sukses |
| [MetricCard.tsx](components/ui/MetricCard.tsx) | Kartu nilai utama, pembulatan, quality |
| [SensorCard.tsx](components/ui/SensorCard.tsx) | Kartu perangkat, gambar, null, quality |
| [ConfirmDialog.tsx](components/ui/ConfirmDialog.tsx) | Konfirmasi danger/primary dan fokus awal |
| [SuccessNotice.tsx](components/ui/SuccessNotice.tsx) | Toast, live region, timer 5 detik |
| [icons.tsx](components/ui/icons.tsx) | Ikon pensil, ulangi, kamera |
| [lib/batch-wizard.ts](lib/batch-wizard.ts) | Aturan validasi wizard |
| [lib/batch-draft.ts](lib/batch-draft.ts) | Penyimpanan dan pemulihan draf |
| [shared/units.ts](shared/units.ts) | Metadata sensor dan unit raw ADC |
| [shared/dataset.ts](shared/dataset.ts) | Aturan dataset dan formatter WIB |
| [hooks/useChamberLatest.ts](hooks/useChamberLatest.ts) | Kondisi request dan latest reading |
| [hooks/useChamberStream.ts](hooks/useChamberStream.ts) | Pembaruan stream chamber |
| [.gitignore](.gitignore) | Status direktori dokumentasi dan aset lokal |

Nilai bawaan spacing, breakpoint, typography, radius, blur, dan animasi diperiksa pada `node_modules/tailwindcss/theme.css` di instalasi lokal. File dependency tersebut tidak dijadikan tempat perubahan design system produk.

### 21.3 Riwayat dokumen

| Versi | Tanggal | Perubahan |
| --- | --- | --- |
| 1.0 | 30 Oktober 2026 | Inventaris awal design system dari struktur proyek, source code, dan pemeriksaan render lokal; mencatat perbedaan font, warna seri sensor, quality, formatter, dan konsistensi komponen |
