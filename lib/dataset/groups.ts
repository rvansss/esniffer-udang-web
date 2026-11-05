import type { Prisma } from '@prisma/client';
import { buildGroupId } from '../../shared/dataset.ts';
import { parseVisualCheck, parseIntMinimum } from '../api/dataset.ts';
import { conflict, notFound, validationError } from '../api/errors.ts';

export function parseGrouping(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('Field "grouping" harus berisi temuan visual dan jumlah sampel');
  }
  const input = value as Record<string, unknown>;
  const visualCheck = parseVisualCheck(input.visualCheck);
  const sampleShrimpCount = parseIntMinimum(input.sampleShrimpCount, 'sampleShrimpCount', 3);
  if (sampleShrimpCount > 5) throw validationError('Jumlah sampel harus 3–5 ekor per sesi');
  return { visualCheck, sampleShrimpCount };
}

export function groupData(batchId: string, storage: 'room_temp' | 'cold', fields: ReturnType<typeof parseGrouping>) {
  return {
    groupId: buildGroupId(batchId, storage), batchId,
    storageCondition: storage === 'cold' ? 'COLD' as const : 'ROOM_TEMP' as const,
    targetTempC: storage === 'cold' ? 4 : 25,
    coldStorageMode: 'CHAMBER' as const,
    ...fields,
  };
}

export async function createBatchGroups(tx: Prisma.TransactionClient, batchId: string, fields: ReturnType<typeof parseGrouping>) {
  return tx.sampleGroup.createMany({ data: [groupData(batchId, 'room_temp', fields), groupData(batchId, 'cold', fields)] });
}

/** Serializes every batch mutation with locking, including session linking. */
export async function lockEditableBatch(tx: Prisma.TransactionClient, batchId: string) {
  const rows = await tx.$queryRaw<Array<{ locked_at: Date | null }>>`
    SELECT locked_at FROM collection_batches WHERE batch_id = ${batchId} FOR UPDATE`;
  if (!rows.length) throw notFound(`Batch "${batchId}" not found`);
  if (rows[0].locked_at) throw conflict(`Batch "${batchId}" sudah terkunci dan tidak bisa diubah`);
}

export function parseGroupingPatch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError('Field "grouping" harus objek');
  const input = value as Record<string, unknown>;
  const validated = parseGrouping({ visualCheck: input.visualCheck === undefined ? 'normal' : input.visualCheck, sampleShrimpCount: input.sampleShrimpCount === undefined ? 3 : input.sampleShrimpCount });
  if (input.visualCheck === undefined && input.sampleShrimpCount === undefined) throw validationError('Pengelompokan harus memuat temuan visual atau jumlah sampel');
  return {
    ...(input.visualCheck !== undefined ? { visualCheck: validated.visualCheck } : {}),
    ...(input.sampleShrimpCount !== undefined ? { sampleShrimpCount: validated.sampleShrimpCount } : {}),
  };
}
