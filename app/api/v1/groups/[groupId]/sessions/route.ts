import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseIsoDate } from '../../../../../../lib/api/validation.ts';
import { conflict, notFound, validationError } from '../../../../../../lib/api/errors.ts';
import {
  buildSessionId,
  parseTimepointCode,
  timepointToElapsedHours,
  isNextTimepoint,
} from '../../../../../../shared/dataset.ts';
import { serializeSession, parseBoundedNumber, parsePositiveNumber } from '../../../../../../lib/api/dataset.ts';
import { backfillSessionReadings } from '../../../../../../lib/dataset/backfill.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { groupId } = await context.params;

    const group = await prisma.sampleGroup.findUnique({
      where: { groupId },
      include: { batch: true, sessions: { select: { timepointCode: true } } },
    });
    if (!group) {
      throw notFound(`Group "${groupId}" not found`);
    }
    if (group.batch.lockedAt) {
      throw conflict(`Batch "${group.batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    const body = await request.json();
    const timepointCode = typeof body?.timepointCode === 'string' ? body.timepointCode : '';
    try {
      parseTimepointCode(timepointCode);
    } catch {
      throw validationError('Field "timepointCode" harus berformat H<jam> atau D<hari> (misal H0, H12, H24, D1)');
    }

    for (const existing of group.sessions) {
      if (!isNextTimepoint(existing.timepointCode, timepointCode)) {
        throw conflict(
          `Timepoint "${timepointCode}" harus setelah timepoint terakhir grup ini`
        );
      }
    }

    const startedAtUtc = body?.startedAtUtc === undefined
      ? new Date()
      : parseIsoDate(body.startedAtUtc, 'startedAtUtc', true)!;

    let durationSeconds: number = 900;
    if (body?.durationSeconds !== undefined && body?.durationSeconds !== null) {
      if (typeof body.durationSeconds !== 'number' || !Number.isInteger(body.durationSeconds) || body.durationSeconds < 60 || body.durationSeconds > 7200) {
        throw validationError('Field "durationSeconds" harus antara 60 (1 menit) sampai 7200 (120 menit)');
      }
      durationSeconds = body.durationSeconds;
    }

    let endedAtUtc: Date | null = null;
    if (body?.endedAtUtc !== undefined && body?.endedAtUtc !== null) {
      endedAtUtc = parseIsoDate(body.endedAtUtc, 'endedAtUtc', true)!;
      if (endedAtUtc.getTime() <= startedAtUtc.getTime()) {
        throw validationError('Waktu selesai harus setelah waktu mulai sesi');
      }
      durationSeconds = Math.round((endedAtUtc.getTime() - startedAtUtc.getTime()) / 1000);
    }

    const isPast = Boolean(endedAtUtc && endedAtUtc.getTime() <= Date.now());
    const autoBackfill = Boolean(body?.autoBackfill || isPast);

    if (autoBackfill && !endedAtUtc) {
      endedAtUtc = new Date(startedAtUtc.getTime() + durationSeconds * 1000);
    }

    if (!autoBackfill && body?.warmupDone !== true) {
      throw validationError('Nyalakan sensor 30 menit dulu (warmupDone harus true) sebelum Start');
    }

    let chamberId: string | null = null;
    if (body?.chamberId !== undefined && body?.chamberId !== null) {
      if (typeof body.chamberId !== 'string' || !UUID_REGEX.test(body.chamberId)) {
        throw validationError('Field "chamberId" harus UUID valid');
      }
      const chamber = await prisma.chamber.findUnique({ where: { id: body.chamberId } });
      if (!chamber) {
        throw notFound(`Chamber "${body.chamberId}" not found`);
      }
      chamberId = chamber.id;
    } else if (group.chamberId) {
      chamberId = group.chamberId;
    }

    // Revisi putaran 2 butir 1 (validasi server): grup dingin mode chamber
    // wajib menunjuk chamber sebelum sesi berjalan karena chamber menentukan
    // sumber data sensor. Grup plain_fridge dan grup ruang tidak kena aturan.
    if (group.storageCondition === 'COLD' && group.coldStorageMode === 'CHAMBER' && !chamberId) {
      throw validationError(
        'Grup dingin mode chamber butuh pemilihan chamber sebelum sesi dimulai'
      );
    }
    if (body?.autoBackfill && group.coldStorageMode !== 'PLAIN_FRIDGE' && !chamberId) {
      throw validationError(
        'Sesi dengan pengambilan rentang waktu membutuhkan pemilihan chamber'
      );
    }

    let deviceId: string | null = null;
    if (body?.deviceId !== undefined && body?.deviceId !== null) {
      if (typeof body.deviceId !== 'string' || !UUID_REGEX.test(body.deviceId)) {
        throw validationError('Field "deviceId" harus UUID valid');
      }
      const device = await prisma.device.findUnique({ where: { id: body.deviceId } });
      if (!device) {
        throw notFound(`Device "${body.deviceId}" not found`);
      }
      deviceId = device.id;
    } else if (chamberId) {
      const assignment = await prisma.deviceAssignment.findFirst({
        where: {
          chamberId,
          activeFrom: { lte: endedAtUtc ?? startedAtUtc },
          OR: [
            { activeUntil: null },
            { activeUntil: { gte: startedAtUtc } },
          ],
        },
        orderBy: { activeFrom: 'desc' },
      });
      if (assignment) {
        deviceId = assignment.deviceId;
      }
    }

    // Data observasi tahap ini (modal pra-sesi): suhu udang, berat total
    // udang, dan foto (foto lewat route /photos dengan sessionId). Kolom
    // grup tidak ditimpa lagi — tiap tahap menyimpan pengukurannya sendiri.
    const shrimpTempC = body?.shrimpTempC === undefined || body?.shrimpTempC === null
      ? null
      : parseBoundedNumber(body.shrimpTempC, 'shrimpTempC', -2, 30);
    const shrimpWeightG = body?.shrimpWeightG === undefined || body?.shrimpWeightG === null
      ? null
      : parsePositiveNumber(body.shrimpWeightG, 'shrimpWeightG', 2000);

    const suffix = group.storageCondition === 'COLD' ? 'SD' : 'SR';
    const session = await prisma.measurementSession.create({
      data: {
        sessionId: buildSessionId(group.batchId, timepointCode, suffix),
        groupId,
        batchId: group.batchId,
        chamberId,
        deviceId,
        timepointCode,
        elapsedHours: timepointToElapsedHours(timepointCode),
        startedAtUtc,
        endedAtUtc: autoBackfill ? endedAtUtc : null,
        durationSeconds,
        warmupDone: true,
        cleaningDone: autoBackfill,
        status: autoBackfill ? 'COMPLETE' : 'OPEN',
        shrimpTempC,
        shrimpWeightG,
      },
    });

    if (autoBackfill) {
      const backfill = await backfillSessionReadings(session.id);
      const finalSession = await prisma.measurementSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      return jsonResponse(serializeSession(finalSession), {
        linkedReadings: backfill.linked,
        baselineReadings: backfill.baseline,
      }, 201);
    }

    return jsonResponse(serializeSession(session), undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
