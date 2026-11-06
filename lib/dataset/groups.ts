import type { Prisma } from '@prisma/client';
import { buildGroupId } from '../../shared/dataset.ts';
import { parseVisualCheck, parseIntMinimum } from '../api/dataset.ts';
import { conflict, notFound, validationError } from '../api/errors.ts';

/**
 * Jumlah udang per sesi: bilangan bulat ≥ 1, tanpa batas atas domain.
 * CHECK DB hanya `sample_shrimp_count >= 1`; nilai di luar acuan 1–10 ekor
 * tetap diterima (UI menampilkan peringatan, bukan galat).
 */
function parseSampleShrimpCount(value: unknown, fieldName: string): number {
  return parseIntMinimum(value, fieldName, 1);
}

export function parseGrouping(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('Field "grouping" harus berisi temuan visual dan jumlah sampel');
  }
  const input = value as Record<string, unknown>;
  const visualCheck = parseVisualCheck(input.visualCheck);
  const sampleShrimpCount = parseSampleShrimpCount(input.sampleShrimpCount, 'sampleShrimpCount');
  return { visualCheck, sampleShrimpCount };
}

/**
 * Pengelompokan saat batch dibuat. Wizard mencatat jumlah udang per sesi
 * terpisah untuk suhu ruang (SR) dan suhu dingin (SD), jadi selain
 * `sampleShrimpCount` (nilai dasar) kedua kunci opsional
 * `sampleShrimpCountRoomTemp` / `sampleShrimpCountCold` boleh ditimpa sendiri.
 * Klien lama yang hanya mengirim satu nilai tetap mendapat dua grup bernilai
 * sama; wizard boleh mengirim dua nilai per suhu tanpa nilai dasar sama sekali.
 */
export function parseBatchGrouping(value: unknown): {
  visualCheck: ReturnType<typeof parseVisualCheck>;
  roomTempCount: number;
  coldCount: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('Field "grouping" harus berisi temuan visual dan jumlah sampel');
  }
  const input = value as Record<string, unknown>;
  const visualCheck = parseVisualCheck(input.visualCheck);
  const shared = input.sampleShrimpCount === undefined
    ? undefined
    : parseSampleShrimpCount(input.sampleShrimpCount, 'sampleShrimpCount');
  const roomTemp = input.sampleShrimpCountRoomTemp === undefined
    ? shared
    : parseSampleShrimpCount(input.sampleShrimpCountRoomTemp, 'sampleShrimpCountRoomTemp');
  const cold = input.sampleShrimpCountCold === undefined
    ? shared
    : parseSampleShrimpCount(input.sampleShrimpCountCold, 'sampleShrimpCountCold');
  // Nilai yang hanya dikirim untuk satu grup dipakai juga oleh grup lainnya;
  // tanpa satu pun nilai, grouping dianggap tidak lengkap.
  const roomTempCount = roomTemp ?? cold;
  const coldCount = cold ?? roomTemp;
  if (roomTempCount === undefined || coldCount === undefined) {
    throw validationError(
      'Field "grouping" harus berisi jumlah udang per sesi (sampleShrimpCount atau pasangan sampleShrimpCountRoomTemp/sampleShrimpCountCold)'
    );
  }
  return { visualCheck, roomTempCount, coldCount };
}

export function groupData(
  batchId: string,
  storage: 'room_temp' | 'cold',
  fields: { visualCheck: ReturnType<typeof parseVisualCheck>; sampleShrimpCount: number }
) {
  return {
    groupId: buildGroupId(batchId, storage), batchId,
    storageCondition: storage === 'cold' ? 'COLD' as const : 'ROOM_TEMP' as const,
    targetTempC: storage === 'cold' ? 4 : 25,
    coldStorageMode: 'CHAMBER' as const,
    ...fields,
  };
}

export async function createBatchGroups(
  tx: Prisma.TransactionClient,
  batchId: string,
  grouping: ReturnType<typeof parseBatchGrouping>
) {
  const { visualCheck, roomTempCount, coldCount } = grouping;
  return tx.sampleGroup.createMany({
    data: [
      groupData(batchId, 'room_temp', { visualCheck, sampleShrimpCount: roomTempCount }),
      groupData(batchId, 'cold', { visualCheck, sampleShrimpCount: coldCount }),
    ],
  });
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
