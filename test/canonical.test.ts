/**
 * Pengujian unit RFC 8785 JSON Canonicalization Scheme & SHA-256 Payload Hash
 * Membuktikan ADR-005 dan Review Note 3
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalizeJson,
  processCanonicalPayload,
  assertNoDuplicateKeys,
  CanonicalizationError,
} from '../shared/canonical.ts';

test('RFC 8785: Serialisasi deterministik mengurutkan keys menurut UTF-16 code units', () => {
  const obj1 = { z: 1, a: 2, m: { y: 'bar', x: 'foo' } };
  const obj2 = { a: 2, m: { x: 'foo', y: 'bar' }, z: 1 };

  const canon1 = canonicalizeJson(obj1);
  const canon2 = canonicalizeJson(obj2);

  assert.strictEqual(canon1, canon2);
  assert.strictEqual(canon1, '{"a":2,"m":{"x":"foo","y":"bar"},"z":1}');
});

test('RFC 8785: Penanganan -0 dikonversi menjadi 0', () => {
  const obj = { normalZero: 0, negativeZero: -0 };
  const canon = canonicalizeJson(obj);
  assert.strictEqual(canon, '{"negativeZero":0,"normalZero":0}');
});

test('RFC 8785: Menolak angka non-finite (NaN, Infinity)', () => {
  assert.throws(
    () => canonicalizeJson({ val: NaN }),
    (err: Error) => err instanceof CanonicalizationError
  );
  assert.throws(
    () => canonicalizeJson({ val: Infinity }),
    (err: Error) => err instanceof CanonicalizationError
  );
});

test('RFC 8785: Menolak JSON dengan duplicate member keys', () => {
  const duplicateJson = '{"device_id":"esp32-001","device_id":"esp32-002"}';
  assert.throws(
    () => assertNoDuplicateKeys(duplicateJson),
    (err: Error) => err instanceof CanonicalizationError && err.message.includes('Duplicate key')
  );

  const nestedDuplicate = '{"sensors":{"mq137_raw":10,"mq137_raw":20}}';
  assert.throws(
    () => assertNoDuplicateKeys(nestedDuplicate),
    (err: Error) => err instanceof CanonicalizationError && err.message.includes('Duplicate key')
  );
});

test('RFC 8785: Menolak payload yang melebihi batas 4096 bytes', () => {
  const largeData = {
    schema_version: 1,
    device_id: 'esp32-001',
    message_id: 'boot:1',
    data: 'x'.repeat(4090),
  };
  const rawStr = JSON.stringify(largeData);
  assert.ok(Buffer.byteLength(rawStr) > 4096);

  assert.throws(
    () => processCanonicalPayload(rawStr),
    (err: Error) => err instanceof CanonicalizationError && err.message.includes('exceeds maximum')
  );
});

test('Review Note 3: Hash deduplikasi identik untuk representasi semantik sama dan berbeda saat data berubah', () => {
  const validPath = join(process.cwd(), 'test/fixtures/valid-telemetry.json');
  const duplicatePath = join(process.cwd(), 'test/fixtures/duplicate-identical.json');
  const conflictPath = join(process.cwd(), 'test/fixtures/id-conflict.json');

  const validRaw = readFileSync(validPath, 'utf8');
  const duplicateRaw = readFileSync(duplicatePath, 'utf8');
  const conflictRaw = readFileSync(conflictPath, 'utf8');

  const resValid = processCanonicalPayload(validRaw);
  const resDuplicate = processCanonicalPayload(duplicateRaw);
  const resConflict = processCanonicalPayload(conflictRaw);

  // Hash harus 64 hex characters (SHA-256)
  assert.strictEqual(resValid.payloadSha256.length, 64);
  assert.match(resValid.payloadSha256, /^[0-9a-f]{64}$/);

  // Payload identik menghasilkan hash sama persis
  assert.strictEqual(resValid.payloadSha256, resDuplicate.payloadSha256);

  // Payload dengan data berbeda menghasilkan hash berbeda meskipun message_id sama
  assert.notStrictEqual(resValid.payloadSha256, resConflict.payloadSha256);
});
