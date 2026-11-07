/**
 * Layanan kalibrasi dua tahap di server (Fase 0).
 *
 * Sebelumnya status kalibrasi hanya ada di localStorage browser, sehingga
 * kalibrasi yang dimulai di ponsel tidak terlihat di laptop dan hitungannya
 * harus diulang. Sekarang:
 *
 * - Server yang menentukan waktu mulai tiap langkah (`nowMs()` di
 *   lib/runtime/clock.ts). Klien tidak pernah mengirim timestamp, jadi tidak
 *   ada cara "mengklaim" chamber sudah ditutup 30 menit.
 * - Server juga yang memutuskan kapan kalibrasi selesai, lalu menyimpan
 *   `completedAtUtc` sebagai bukti prasyarat yang bisa diaudit.
 * - Semua perangkat membaca baris yang sama, jadi sisa waktu selalu sama.
 *
 * Penulisan diserialkan lewat `lockEditableBatch` (SELECT ... FOR UPDATE pada
 * baris batch), primitif yang sudah dipakai seluruh mutasi dataset lain.
 */

import { Prisma, type GroupCalibration } from '@prisma/client';
import { prisma } from '../db/client.ts';
import { lockEditableBatch } from './groups.ts';
import { nowMs } from '../runtime/clock.ts';
import { conflict, notFound, validationError } from '../api/errors.ts';
import {
  CALIBRATION_STEPS,
  calibrationDone,
  defaultCalibrationDurations,
  normalizeCalibrationMins,
  nextCalibrationStep,
  runFromStoredSteps,
  runToWireSteps,
  startCalibration,
  startCalibrationStep,
  type CalibrationRun,
  type CalibrationWire,
} from '../calibration.ts';

/** Siapa (operator & perangkat) yang mengubah kalibrasi — akun dipakai bersama. */
export interface ActorAttribution {
  userId: string;
  operator: string;
  deviceLabel: string;
}

export type CalibrationAction = 'start' | 'advance' | 'reset';

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Baris DB → bentuk wire. `null` bila isi JSON tidak sesuai skema, supaya UI
 * memperlakukannya sebagai "belum ada kalibrasi" alih-alih menghitung dari
 * data yang tidak bisa dipercaya.
 */
export function serializeCalibration(row: GroupCalibration | null): CalibrationWire | null {
  if (!row) return null;
  const run = runFromStoredSteps(row.steps);
  if (!run) return null;
  return {
    steps: runToWireSteps(run),
    completedAtUtc: row.completedAtUtc ? row.completedAtUtc.toISOString() : null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedByOperator: row.updatedByOperator,
    updatedByDevice: row.updatedByDevice,
  };
}

/** Kalibrasi satu grup, atau `null` bila belum pernah dimulai. */
export async function loadGroupCalibration(
  groupId: string,
  client: DbClient = prisma
): Promise<CalibrationWire | null> {
  const row = await client.groupCalibration.findUnique({ where: { groupId } });
  return serializeCalibration(row);
}

/**
 * Semua kalibrasi satu batch, dipetakan per groupId. Dipakai GET detail batch
 * agar satu permintaan sudah membawa status kalibrasi semua grup — halaman
 * tidak perlu menembak endpoint per grup dan tidak ada state lokal.
 */
export async function loadBatchCalibrations(
  batchId: string,
  client: DbClient = prisma
): Promise<Map<string, CalibrationWire>> {
  const rows = await client.groupCalibration.findMany({ where: { batchId } });
  const map = new Map<string, CalibrationWire>();
  for (const row of rows) {
    const wire = serializeCalibration(row);
    if (wire) map.set(row.groupId, wire);
  }
  return map;
}

function parseDurations(value: unknown): number[] {
  if (value === undefined || value === null) return defaultCalibrationDurations();
  if (!Array.isArray(value) || value.length !== CALIBRATION_STEPS.length) {
    throw validationError(
      `Field "durations" harus berisi ${CALIBRATION_STEPS.length} angka durasi (menit)`
    );
  }
  return CALIBRATION_STEPS.map((step, i) => {
    const mins = normalizeCalibrationMins(value[i]);
    if (mins === null) {
      throw validationError(
        `Durasi ${step.label} harus bilangan bulat 1–120 menit`
      );
    }
    return mins;
  });
}

function parseStepIndex(value: unknown): number {
  const index = typeof value === 'string' ? Number(value) : value;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= CALIBRATION_STEPS.length) {
    throw validationError(`Field "stepIndex" harus bilangan bulat 0–${CALIBRATION_STEPS.length - 1}`);
  }
  return index;
}

/**
 * Menjalankan satu aksi kalibrasi. Mengembalikan bentuk wire terbaru (`null`
 * setelah reset).
 *
 * Aksi `start` menolak bila sudah ada kalibrasi berjalan — operator harus
 * me-reset lebih dulu, supaya hitungan tidak diam-diam mundur ke nol hanya
 * karena satu perangkat menekan tombol lagi.
 */
export async function applyCalibrationAction(input: {
  groupId: string;
  action: CalibrationAction;
  durations?: unknown;
  stepIndex?: unknown;
  durationMins?: unknown;
  restart?: boolean;
  actor: ActorAttribution;
}): Promise<CalibrationWire | null> {
  const group = await prisma.sampleGroup.findUnique({
    where: { groupId: input.groupId },
    select: { batchId: true },
  });
  if (!group) throw notFound(`Group "${input.groupId}" not found`);
  const batchId = group.batchId;

  return prisma.$transaction(async (tx) => {
    // Serialisasi per batch: aksi kalibrasi tidak bisa balapan dengan mutasi
    // dataset lain, dan dua perangkat yang menekan tombol bersamaan diproses
    // berurutan (yang kedua melihat state yang sudah diperbarui).
    await lockEditableBatch(tx, batchId);

    const existing = await tx.groupCalibration.findUnique({ where: { groupId: input.groupId } });
    const at = nowMs();

    if (input.action === 'reset') {
      if (existing) await tx.groupCalibration.delete({ where: { groupId: input.groupId } });
      return null;
    }

    if (input.action === 'start') {
      if (existing && !input.restart) {
        throw conflict(
          `Kalibrasi grup ini sudah dimulai (${serializeCalibration(existing)?.updatedAt ?? existing.updatedAt.toISOString()}). ` +
            'Selesaikan atau reset dulu sebelum memulai yang baru.'
        );
      }
      const durations = parseDurations(input.durations);
      const run = startCalibration(durations, at);
      if (!run) throw validationError('Durasi kalibrasi tidak sah');

      const data = {
        steps: runToWireSteps(run) as unknown as Prisma.InputJsonValue,
        completedAtUtc: null,
        updatedByUserId: input.actor.userId,
        updatedByOperator: input.actor.operator,
        updatedByDevice: input.actor.deviceLabel,
        version: { increment: 1 },
      };
      const row = existing
        ? await tx.groupCalibration.update({ where: { groupId: input.groupId }, data })
        : await tx.groupCalibration.create({
            data: { batchId, groupId: input.groupId, steps: data.steps, updatedByUserId: data.updatedByUserId, updatedByOperator: data.updatedByOperator, updatedByDevice: data.updatedByDevice },
          });
      return serializeCalibration(row);
    }

    // action === 'advance'
    if (!existing) {
      throw conflict('Kalibrasi grup ini belum dimulai. Mulai kalibrasi dulu.');
    }
    const run = runFromStoredSteps(existing.steps);
    if (!run) {
      throw conflict('Data kalibrasi tersimpan tidak terbaca. Reset lalu mulai ulang kalibrasi.');
    }
    const index = parseStepIndex(input.stepIndex);
    const expected = nextCalibrationStep(run);
    if (index !== expected) {
      throw conflict(
        `Langkah "${CALIBRATION_STEPS[index].label}" belum bisa dimulai: ` +
          `langkah berikutnya adalah "${CALIBRATION_STEPS[expected]?.label ?? 'selesai'}".`
      );
    }
    const previousDone =
      index === 0 ||
      (run.starts[index - 1] !== null &&
        at - (run.starts[index - 1] as number) >= (run.mins[index - 1] ?? 0) * 60_000);
    if (!previousDone) {
      throw conflict(
        `Langkah "${CALIBRATION_STEPS[index - 1].label}" belum selesai. Tunggu hitungannya habis dulu.`
      );
    }

    const nextRun: CalibrationRun | null = startCalibrationStep(run, index, input.durationMins, at);
    if (!nextRun) {
      throw validationError(`Durasi ${CALIBRATION_STEPS[index].label} harus bilangan bulat 1–120 menit`);
    }

    const done = calibrationDone(nextRun, at);
    const row = await tx.groupCalibration.update({
      where: { groupId: input.groupId },
      data: {
        steps: runToWireSteps(nextRun) as unknown as Prisma.InputJsonValue,
        completedAtUtc: done ? new Date(at) : null,
        updatedByUserId: input.actor.userId,
        updatedByOperator: input.actor.operator,
        updatedByDevice: input.actor.deviceLabel,
        version: { increment: 1 },
      },
    });
    return serializeCalibration(row);
  });
}

/**
 * Gerbang server untuk sesi rekam langsung: kalibrasi dua tahap harus benar-
 * benar selesai menurut jam server. Dipakai POST /groups/:groupId/sessions
 * menggantikan klaim `warmupDone: true` dari klien.
 */
export async function requireCompletedCalibration(groupId: string): Promise<{
  wire: CalibrationWire;
  run: CalibrationRun;
  completedAtUtc: Date;
  version: number;
}> {
  const row = await prisma.groupCalibration.findUnique({ where: { groupId } });
  if (!row) {
    throw validationError(
      'Kalibrasi dua tahap belum dimulai. Mulai kalibrasi (chamber tertutup lalu dibuka) sebelum merekam langsung.'
    );
  }
  const run = runFromStoredSteps(row.steps);
  const wire = serializeCalibration(row);
  if (!run || !wire) {
    throw validationError('Data kalibrasi tersimpan tidak terbaca. Reset lalu ulangi kalibrasi.');
  }
  if (!calibrationDone(run, nowMs())) {
    throw validationError(
      'Kalibrasi dua tahap belum selesai. Tunggu kedua hitungan habis sebelum merekam langsung.'
    );
  }
  return {
    wire,
    run,
    completedAtUtc: row.completedAtUtc ?? new Date(nowMs()),
    version: row.version,
  };
}
