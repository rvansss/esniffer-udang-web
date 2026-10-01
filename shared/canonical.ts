/**
 * Implementasi JSON Canonicalization Scheme (RFC 8785) & SHA-256 Payload Hash
 *
 * Menggunakan library resmi RFC 8785 `canonicalize` (karya Samuel Erdtman, co-author RFC 8785)
 * untuk serialisasi kanonikal deterministik.
 *
 * Pemeriksaan Duplicate Keys dilakukan pada raw JSON string SEBELUM JSON.parse,
 * karena JSON.parse bawaan JavaScript secara diam-diam menimpa dan membuang informasi
 * duplicate member keys.
 *
 * Sesuai ADR-005, Review Note 3, dan docs/esniffer/03-technical-design.md Section 5.5
 */

import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { MAX_PAYLOAD_BYTES } from './types.ts';

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Memeriksa apakah string JSON memuat duplicate member keys pada level object manapun.
 * Dijalankan SEBELUM JSON.parse agar duplicate keys tidak hilang tertimpa diam-diam.
 * Melempar CanonicalizationError jika ditemukan duplicate key atau syntax error.
 */
export function assertNoDuplicateKeys(jsonString: string): void {
  let idx = 0;
  const len = jsonString.length;

  function skipWhitespace(): void {
    while (idx < len) {
      const ch = jsonString.charCodeAt(idx);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        idx++;
      } else {
        break;
      }
    }
  }

  function parseString(): string {
    idx++; // Lewati tanda kutip pembuka '"'
    let result = '';
    while (idx < len) {
      const ch = jsonString[idx];
      if (ch === '"') {
        idx++;
        return result;
      }
      if (ch === '\\') {
        idx++;
        if (idx >= len) throw new CanonicalizationError('Unterminated escape sequence in JSON');
        const esc = jsonString[idx++];
        if (esc === '"' || esc === '\\' || esc === '/') result += esc;
        else if (esc === 'b') result += '\b';
        else if (esc === 'f') result += '\f';
        else if (esc === 'n') result += '\n';
        else if (esc === 'r') result += '\r';
        else if (esc === 't') result += '\t';
        else if (esc === 'u') {
          const hex = jsonString.slice(idx, idx + 4);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new CanonicalizationError('Invalid unicode escape sequence in JSON');
          }
          result += String.fromCharCode(parseInt(hex, 16));
          idx += 4;
        } else {
          throw new CanonicalizationError(`Invalid escape character in JSON: \\${esc}`);
        }
      } else {
        result += ch;
        idx++;
      }
    }
    throw new CanonicalizationError('Unterminated string in JSON');
  }

  function parseValue(): void {
    skipWhitespace();
    if (idx >= len) throw new CanonicalizationError('Unexpected end of JSON');
    const ch = jsonString[idx];

    if (ch === '{') {
      parseObject();
    } else if (ch === '[') {
      parseArray();
    } else if (ch === '"') {
      parseString();
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      parseNumber();
    } else if (ch === 't' && jsonString.startsWith('true', idx)) {
      idx += 4;
    } else if (ch === 'f' && jsonString.startsWith('false', idx)) {
      idx += 5;
    } else if (ch === 'n' && jsonString.startsWith('null', idx)) {
      idx += 4;
    } else {
      throw new CanonicalizationError(`Unexpected character in JSON: '${ch}' at index ${idx}`);
    }
  }

  function parseNumber(): void {
    const start = idx;
    if (jsonString[idx] === '-') idx++;
    while (
      idx < len &&
      ((jsonString[idx] >= '0' && jsonString[idx] <= '9') ||
        jsonString[idx] === '.' ||
        jsonString[idx] === 'e' ||
        jsonString[idx] === 'E' ||
        jsonString[idx] === '+' ||
        jsonString[idx] === '-')
    ) {
      idx++;
    }
    const numStr = jsonString.slice(start, idx);
    const n = Number(numStr);
    if (!Number.isFinite(n)) {
      throw new CanonicalizationError(`Invalid number in JSON: ${numStr}`);
    }
  }

  function parseArray(): void {
    idx++; // lewati '['
    skipWhitespace();
    if (idx < len && jsonString[idx] === ']') {
      idx++;
      return;
    }
    while (idx < len) {
      parseValue();
      skipWhitespace();
      if (idx >= len) throw new CanonicalizationError('Unterminated array in JSON');
      if (jsonString[idx] === ']') {
        idx++;
        return;
      }
      if (jsonString[idx] === ',') {
        idx++;
        skipWhitespace();
      } else {
        throw new CanonicalizationError(`Expected ',' or ']' in array at index ${idx}`);
      }
    }
    throw new CanonicalizationError('Unterminated array in JSON');
  }

  function parseObject(): void {
    idx++; // lewati '{'
    skipWhitespace();
    if (idx < len && jsonString[idx] === '}') {
      idx++;
      return;
    }
    const seenKeys = new Set<string>();

    while (idx < len) {
      skipWhitespace();
      if (jsonString[idx] !== '"') {
        throw new CanonicalizationError(`Expected string key in object at index ${idx}`);
      }
      const key = parseString();
      if (seenKeys.has(key)) {
        throw new CanonicalizationError(`Duplicate key in JSON object: "${key}"`);
      }
      seenKeys.add(key);

      skipWhitespace();
      if (idx >= len || jsonString[idx] !== ':') {
        throw new CanonicalizationError(`Expected ':' after key in object at index ${idx}`);
      }
      idx++; // lewati ':'

      parseValue();
      skipWhitespace();
      if (idx >= len) throw new CanonicalizationError('Unterminated object in JSON');
      if (jsonString[idx] === '}') {
        idx++;
        return;
      }
      if (jsonString[idx] === ',') {
        idx++;
        skipWhitespace();
      } else {
        throw new CanonicalizationError(`Expected ',' or '}' in object at index ${idx}`);
      }
    }
    throw new CanonicalizationError('Unterminated object in JSON');
  }

  parseValue();
  skipWhitespace();
  if (idx < len) {
    throw new CanonicalizationError(`Trailing garbage in JSON at index ${idx}`);
  }
}

/**
 * Melakukan serialisasi kanonikal deterministik sesuai RFC 8785 memakai library referensi `canonicalize`.
 */
export function canonicalizeJson(value: unknown): string {
  try {
    const result = canonicalize(value);
    if (result === undefined) {
      throw new CanonicalizationError('Cannot canonicalize undefined value');
    }
    return result;
  } catch (err) {
    if (err instanceof CanonicalizationError) throw err;
    throw new CanonicalizationError(
      `RFC 8785 canonicalization failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export interface CanonicalResult {
  canonicalJson: string;
  payloadSha256: string;
  byteLength: number;
}

/**
 * Memvalidasi batas ukuran payload (maks. 4096 byte),
 * memastikan tidak ada duplicate key (sebelum JSON.parse),
 * melakukan canonicalization RFC 8785, dan menghitung SHA-256 hex lowercase.
 *
 * Sesuai Catatan Review 3: Hash dihitung atas payload asli yang immutable
 * sebelum ada normalisasi per-sensor ataupun penambahan metadata server.
 */
export function processCanonicalPayload(rawPayload: string | Buffer): CanonicalResult {
  const payloadBuffer = typeof rawPayload === 'string' ? Buffer.from(rawPayload, 'utf8') : rawPayload;

  if (payloadBuffer.length > MAX_PAYLOAD_BYTES) {
    throw new CanonicalizationError(
      `Payload size ${payloadBuffer.length} bytes exceeds maximum ${MAX_PAYLOAD_BYTES} bytes`
    );
  }

  const rawString = payloadBuffer.toString('utf8');

  // 1. Pastikan tidak ada duplicate keys pada raw JSON string
  assertNoDuplicateKeys(rawString);

  // 2. Parse JSON ke objek setelah duplicate key lolos pemeriksaan
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch (err) {
    throw new CanonicalizationError(
      `Malformed JSON payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 3. Serialisasi kanonikal RFC 8785 via library referensi
  const canonicalJson = canonicalizeJson(parsed);

  // 4. Hitung SHA-256 hex lowercase atas bytes canonical
  const payloadSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');

  return {
    canonicalJson,
    payloadSha256,
    byteLength: payloadBuffer.length,
  };
}
