/**
 * Pengujian unit structured logger, redaksi rahasia, batas panjang string,
 * dan peredaman (suppression) duplikasi error saat outage
 * Sesuai KNF-LOG-001 dan docs/esniffer/03-technical-design.md Section 12.1
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { StructuredLogger, resetErrorSuppressionForTesting } from '../lib/logging/logger.ts';
import { runWithLogContext } from '../lib/logging/context.ts';

test('StructuredLogger: Format JSON dan redaksi rahasia', () => {
  const logger = new StructuredLogger({ minLevel: 'DEBUG', service: 'test' });

  // Uji fungsi sanitasi langsung
  const sanitized = logger.sanitize('auth', {
    password: 'supersecretpassword123',
    token: 'jwt-bearer-token-here',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/db',
    raw_payload: { temp: 25.0 },
    normalField: 'ok',
  }) as Record<string, unknown>;

  assert.strictEqual(sanitized.password, '[REDACTED]');
  assert.strictEqual(sanitized.token, '[REDACTED]');
  assert.strictEqual(sanitized.DATABASE_URL, '[REDACTED]');
  assert.strictEqual(sanitized.raw_payload, '[REDACTED]');
  assert.strictEqual(sanitized.normalField, 'ok');
});

test('StructuredLogger: Pembatasan panjang string > 256 karakter', () => {
  const logger = new StructuredLogger();
  const longString = 'A'.repeat(300);
  const result = logger.sanitize('description', longString) as string;

  assert.ok(result.length < 300);
  assert.ok(result.endsWith('...[TRUNCATED]'));
  assert.strictEqual(result.slice(0, 256), 'A'.repeat(256));
});

test('StructuredLogger: Propagasi correlation ID melalui context', () => {
  const logger = new StructuredLogger({ minLevel: 'DEBUG' });
  let capturedLog = '';

  const originalWrite = process.stdout.write;
  try {
    process.stdout.write = ((chunk: string) => {
      capturedLog = chunk;
      return true;
    }) as unknown as typeof process.stdout.write;

    runWithLogContext(
      { correlationId: 'corr-uuid-1234', deviceId: 'esp32-001' },
      () => {
        logger.info({
          operation: 'test_op',
          outcome: 'success',
        });
      }
    );

    assert.ok(capturedLog.length > 0);
    const parsed = JSON.parse(capturedLog);
    assert.strictEqual(parsed.correlation_id, 'corr-uuid-1234');
    assert.strictEqual(parsed.device_id, 'esp32-001');
    assert.strictEqual(parsed.operation, 'test_op');
    assert.strictEqual(parsed.level, 'INFO');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('StructuredLogger: Peredaman (suppression) duplikasi error identik saat outage', () => {
  resetErrorSuppressionForTesting();
  const logger = new StructuredLogger({ minLevel: 'ERROR', service: 'test' });
  const capturedErrors: string[] = [];

  const originalStderrWrite = process.stderr.write;
  try {
    process.stderr.write = ((chunk: string) => {
      capturedErrors.push(chunk);
      return true;
    }) as unknown as typeof process.stderr.write;

    // Kirim 5 kali error identik berturut-turut (misal DB outage)
    for (let i = 0; i < 5; i++) {
      logger.error({
        operation: 'db_query',
        reason_code: 'DB_UNAVAILABLE',
        message: 'Connection refused at 5432',
      });
    }

    // Hanya kejadian pertama yang dicetak ke stderr; 4 kejadian berikutnya diredam
    assert.strictEqual(capturedErrors.length, 1);
    const parsed = JSON.parse(capturedErrors[0]);
    assert.strictEqual(parsed.operation, 'db_query');
    assert.strictEqual(parsed.reason_code, 'DB_UNAVAILABLE');
  } finally {
    process.stderr.write = originalStderrWrite;
    resetErrorSuppressionForTesting();
  }
});

test('StructuredLogger: Volume log terkendali (telemetry accepted & routine duplicate tidak menghasilkan INFO/WARN per paket)', () => {
  const logger = new StructuredLogger({ minLevel: 'INFO', service: 'test' });
  const capturedOutput: string[] = [];

  const originalStdoutWrite = process.stdout.write;
  try {
    process.stdout.write = ((chunk: string) => {
      capturedOutput.push(chunk);
      return true;
    }) as unknown as typeof process.stdout.write;

    // Paket telemetry accepted dan duplicate rutin dikirim via DEBUG
    logger.debug({
      operation: 'process_telemetry',
      outcome: 'accepted',
      device_id: 'esp32-001',
    });
    logger.debug({
      operation: 'process_telemetry',
      outcome: 'duplicate',
      device_id: 'esp32-001',
    });

    // Ketika minLevel = INFO (default produksi), output stdout harus kosong (tidak ada spam per paket)
    assert.strictEqual(capturedOutput.length, 0);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
});

