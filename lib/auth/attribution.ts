/**
 * Identitas perangkat & operator untuk satu akun bersama.
 *
 * Aplikasi ini sengaja memakai satu akun yang dipakai bergiliran oleh beberapa
 * operator di beberapa perangkat. Supaya dataset tetap "attributable" (prinsip
 * ALCOA) tanpa memecah akun lebih dulu, dua hal dicatat terpisah:
 *
 * - `deviceId`: UUID acak per browser, disimpan di cookie HttpOnly
 *   `esniffer_device` (bukan localStorage seperti draf isian), jadi satu
 *   perangkat selalu bisa dikenali walau berganti operator.
 * - `operatorName`: nama operator yang sedang memegang perangkat, dikirim
 *   klien lewat header `X-Operator` dan disimpan sebagai label di setiap baris
 *   dataset yang dibuat (batch, kalibrasi, draf, sesi).
 *
 * Keduanya bukan identitas kriptografis: akun tetap satu dan siapa pun yang
 * memegang perangkat bisa mengisi namanya. Yang didapat adalah jejak yang
 * konsisten antarperangkat, bukan pengganti akun per operator.
 */

export const DEVICE_COOKIE_NAME = 'esniffer_device';
export const OPERATOR_HEADER = 'x-operator';
/** Batas panjang label operator — sama dengan kolom VARCHAR(80) di DB. */
export const OPERATOR_MAX_LENGTH = 40;
/** Label bila perangkat belum mengisi nama operator. */
export const OPERATOR_FALLBACK = 'Tanpa nama';

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Attribution {
  /** UUID perangkat; `null` bila cookie belum ada (mis. klien non-browser). */
  deviceId: string | null;
  /** Label perangkat untuk ditampilkan, mis. "Chrome · Android". */
  deviceLabel: string;
  /** Nama operator yang dikirim klien; jatuh ke "Tanpa nama". */
  operator: string;
}

/** Membaca satu cookie dari header Cookie tanpa memuat parser tambahan. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return rest.join('=') || null;
  }
  return null;
}

/** Device id yang sah dari cookie, atau `null`. */
export function readDeviceId(request: Request): string | null {
  const value = readCookie(request, DEVICE_COOKIE_NAME);
  return value && DEVICE_ID_PATTERN.test(value) ? value : null;
}

/**
 * Normalisasi nama operator: rapikan spasi, buang karakter kendali, potong ke
 * batas kolom. String kosong berarti "belum diisi", bukan error — akun bersama
 * tidak boleh gagal menyimpan data hanya karena nama belum diketik.
 */
export function normalizeOperator(value: unknown): string {
  if (typeof value !== 'string') return OPERATOR_FALLBACK;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return OPERATOR_FALLBACK;
  return cleaned.slice(0, OPERATOR_MAX_LENGTH);
}

/**
 * Label perangkat dari User-Agent. Tujuannya hanya membantu operator mengenali
 * "perangkat mana ini" di daftar perangkat aktif, jadi heuristik sederhana
 * sudah cukup; tidak perlu pustaka parsing UA.
 */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (ua === '') return 'Perangkat tanpa label';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os = 'Lain';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}

/** User-Agent yang dipotong ke lebar kolom (255). */
export function userAgentOf(request: Request): string | null {
  const ua = request.headers.get('user-agent');
  if (!ua) return null;
  return ua.slice(0, 255);
}

/** IP klien dari header proxy umum; `null` bila tidak tersedia. */
export function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? null;
}

/** Operator dari header permintaan (sudah dinormalisasi). */
export function operatorOf(request: Request): string {
  return normalizeOperator(request.headers.get(OPERATOR_HEADER) ?? undefined);
}

/** Ringkasan atribusi untuk satu permintaan. */
export function resolveAttribution(request: Request): Attribution {
  return {
    deviceId: readDeviceId(request),
    deviceLabel: deviceLabelFromUserAgent(request.headers.get('user-agent')),
    operator: operatorOf(request),
  };
}

/** Cookie perangkat berumur panjang; nilainya bukan rahasia otentikasi. */
export function buildDeviceCookie(deviceId: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  return `${DEVICE_COOKIE_NAME}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 24 * 60 * 60}${secureFlag}`;
}
