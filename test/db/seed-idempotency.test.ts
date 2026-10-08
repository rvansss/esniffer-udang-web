/**
 * Integration Test: Seed Idempotency
 * Sesuai audit Pra-Fase 3 Poin 3:
 * Seed idempoten tidak mereset watermark, tidak mengubah password akun yang sudah ada,
 * dan tidak menimpa assignment pengguna.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, closeDb, getCurrentWatermark } from '../../lib/db/client.ts';
import { spawnSync } from 'node:child_process';

describe('Seed Idempotency & Protection Tests', () => {
  let customPasswordHash: string;
  let originalPasswordHash: string | null = null;
  let testWatermark: bigint;

  before(async () => {
    // 1. Set watermark ke nilai spesifik yang aman di atas data yang ada
    const maxRes = await prisma.$queryRaw<Array<{ max_seq: bigint | null }>>`
      SELECT MAX(history_sequence) as max_seq FROM sensor_readings;
    `;
    const currentMax = maxRes[0]?.max_seq != null ? BigInt(maxRes[0].max_seq) : 0n;
    testWatermark = currentMax + 1000n;

    await prisma.$executeRawUnsafe(`
      UPDATE "history_sequence_watermark"
      SET current_sequence = ${testWatermark.toString()}
      WHERE id = 1;
    `);

    // 2. Modifikasi password admin ke hash khusus.
    // Hash asli disimpan dulu agar after() bisa mengembalikannya:
    // suite test tidak boleh merusak kredensial dev.
    const adminBefore = await prisma.user.findUnique({
      where: { email: 'admin@esniffer.local' },
      select: { passwordHash: true },
    });
    originalPasswordHash = adminBefore?.passwordHash ?? null;
    customPasswordHash = 'custom_secret_hashed_password_xyz_987';
    await prisma.user.upsert({
      where: { email: 'admin@esniffer.local' },
      update: { passwordHash: customPasswordHash },
      create: {
        email: 'admin@esniffer.local',
        passwordHash: customPasswordHash,
        role: 'ADMIN',
      },
    });
  });

  after(async () => {
    try {
      // Kembalikan password admin seperti sebelum test berjalan.
      // Tanpa ini, tiap test:db meninggalkan hash palsu dan login admin123 rusak.
      if (originalPasswordHash !== null) {
        await prisma.user.update({
          where: { email: 'admin@esniffer.local' },
          data: { passwordHash: originalPasswordHash },
        });
      }
    } finally {
      await closeDb();
    }
  });

  it('Re-running seed tidak mereset watermark, tidak mengubah password, dan tidak menimpa assignment', async () => {
    // Ambil assignment aktif esp32-001 sebelum seed dijalankan
    const asgBefore = await prisma.deviceAssignment.findFirst({
      where: {
        device: { mqttDeviceId: 'esp32-001' },
        activeUntil: null,
      },
    });
    assert.ok(asgBefore, 'Harus ada assignment aktif sebelum uji');

    // Jalankan prisma/seed.ts via child process
    const res = spawnSync('node', ['--experimental-strip-types', 'prisma/seed.ts'], {
      encoding: 'utf8',
      env: process.env,
    });

    assert.strictEqual(res.status, 0, `Seed process failed with error: ${res.stderr}`);

    // 1. Verifikasi watermark: harus tetap testWatermark (tidak ter-reset ke 0)
    const currentSeq = await getCurrentWatermark();
    assert.strictEqual(currentSeq, testWatermark, 'Watermark tidak boleh ter-reset kembali ke 0');

    // 2. Verifikasi password hash: harus tetap customPasswordHash
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@esniffer.local' },
    });
    assert.ok(adminUser);
    assert.strictEqual(
      adminUser.passwordHash,
      customPasswordHash,
      'Password pengguna yang sudah ada tidak boleh ditimpa oleh seed'
    );

    // 3. Verifikasi assignment: assignment aktif esp32-001 tidak boleh berubah ID-nya atau terduplikasi
    const asgAfter = await prisma.deviceAssignment.findMany({
      where: {
        device: { mqttDeviceId: 'esp32-001' },
        activeUntil: null,
      },
    });

    assert.strictEqual(asgAfter.length, 1, 'Harus tepat ada 1 assignment aktif untuk esp32-001');
    assert.strictEqual(asgAfter[0].id, asgBefore.id, 'ID assignment aktif tidak boleh berubah');
    assert.strictEqual(asgAfter[0].chamberId, asgBefore.chamberId, 'Chamber assignment aktif tidak boleh ditimpa');
  });
});
