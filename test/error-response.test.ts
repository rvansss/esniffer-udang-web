/**
 * Pengujian pemetaan error respons API (Fase: laporan error).
 *
 * Kode PostgreSQL asli harus dikenali baik dari error Prisma driver adapter
 * (dibungkus, `code` berisi kode Prisma) maupun dari error mentah, supaya
 * pelanggaran aturan database tidak pernah bocor ke pengguna sebagai pesan
 * generik 500.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { errorResponse, postgresErrorCode } from '../lib/api/response.ts';

const prismaCheckViolation = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2039',
  message: 'Database error. Code: `23514`.',
  meta: {
    modelName: 'CollectionBatch',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23514',
        originalMessage:
          'new row for relation "collection_batches" violates check constraint "collection_batches_purchase_within_trip"',
        kind: 'postgres',
        code: '23514',
        severity: 'ERROR',
        message: 'violates check constraint',
      },
    },
  },
};

const prismaUniqueViolation = { name: 'PrismaClientKnownRequestError', code: 'P2002' };

const envelope = async (res: Response) => (await res.json()) as { error: { code: string; message: string } };

test('postgresErrorCode: membongkar bungkusan Prisma driver adapter', () => {
  assert.equal(postgresErrorCode(prismaCheckViolation), '23514');
});

test('postgresErrorCode: tanpa kode asli → undefined (dibiarkan ke cabang umum)', () => {
  assert.equal(postgresErrorCode(new Error('boom')), undefined);
  assert.equal(postgresErrorCode({ code: 'P2039' }), undefined);
  assert.equal(postgresErrorCode(null), undefined);
});

test('check_violation lewat driver adapter dilaporkan 422, bukan 500', async () => {
  const res = errorResponse(prismaCheckViolation, 'req-test-1');
  assert.equal(res.status, 422);
  const body = await envelope(res);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /aturan validasi penyimpanan/);
});

test('check_violation mentah (tanpa pembungkusan Prisma) tetap 422', async () => {
  const res = errorResponse({ code: '23514', message: 'violates check constraint' }, 'req-test-2');
  assert.equal(res.status, 422);
  assert.equal((await envelope(res)).error.code, 'VALIDATION_ERROR');
});

test('unique violation Prisma tetap 409', async () => {
  const res = errorResponse(prismaUniqueViolation, 'req-test-3');
  assert.equal(res.status, 409);
  assert.equal((await envelope(res)).error.code, 'UNIQUE_CONSTRAINT_VIOLATION');
});

test('error tak dikenal tetap 500 dengan pesan berbahasa Indonesia', async () => {
  const res = errorResponse(new TypeError('x is not a function'), 'req-test-4');
  assert.equal(res.status, 500);
  const body = await envelope(res);
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.match(body.error.message, /kesalahan tak terduga/);
  assert.doesNotMatch(body.error.message, /unexpected error/i);
});
