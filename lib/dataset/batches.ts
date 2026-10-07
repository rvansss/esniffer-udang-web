import { rm } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.ts';
import { validationError } from '../api/errors.ts';
import { logger } from '../logging/logger.ts';

export interface BatchDeleteResult {
  batchId: string;
  deleted: boolean;
  unlinkedReadings: number;
  error?: string;
}

/**
 * Hapus satu batch beserta grup, sesi, dan fotonya.
 * Aman secara default: batch terkunci (error) atau masih punya reading
 * tertaut (error + jumlahnya) tidak ikut terhapus kecuali force=true,
 * yang memutus tautan reading (kembali menjadi telemetri biasa).
 */
export async function deleteBatch(batchId: string, force: boolean): Promise<BatchDeleteResult> {
  const batch = await prisma.collectionBatch.findUnique({ where: { batchId } });
  if (!batch) {
    return { batchId, deleted: false, unlinkedReadings: 0, error: `Batch "${batchId}" not found` };
  }
  if (batch.lockedAt) {
    return { batchId, deleted: false, unlinkedReadings: 0, error: `Batch "${batchId}" sudah terkunci` };
  }

  const linkedCount = await prisma.sensorReading.count({ where: { batchId } });
  if (linkedCount > 0 && !force) {
    return {
      batchId,
      deleted: false,
      unlinkedReadings: linkedCount,
      error: `Batch "${batchId}" memiliki ${linkedCount} data tertaut; ulangi dengan force=true untuk memutus tautan`,
    };
  }

  await prisma.$transaction([
    prisma.sensorReading.updateMany({
      where: { batchId },
      data: { sessionId: null, batchId: null, timepointCode: null, isBaseline: null },
    }),
    prisma.measurementSession.deleteMany({ where: { batchId } }),
    prisma.sampleGroup.deleteMany({ where: { batchId } }),
    prisma.collectionBatch.delete({ where: { batchId } }),
  ]);

  try {
    await rm(path.join(process.cwd(), 'public', 'uploads', batchId), { recursive: true, force: true });
  } catch (err) {
    logger.warn({
      service: 'web',
      operation: 'batch_photo_cleanup',
      outcome: 'warning',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { batchId, deleted: true, unlinkedReadings: linkedCount };
}

export function parseBatchIds(val: unknown): string[] {
  if (!Array.isArray(val) || val.length === 0 || val.length > 50) {
    throw validationError('Field "batchIds" harus array 1–50 batch_id');
  }
  const ids = val.map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (ids.some((id) => id.length === 0)) {
    throw validationError('Field "batchIds" hanya boleh berisi string tak kosong');
  }
  return [...new Set(ids)];
}
