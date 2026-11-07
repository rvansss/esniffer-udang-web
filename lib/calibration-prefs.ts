/**
 * Preferensi isian durasi kalibrasi — satu-satunya sisa pemakaian localStorage
 * di modul kalibrasi, dan sengaja bukan sumber kebenaran.
 *
 * Yang disimpan hanya "angka yang terakhir diketik operator di perangkat ini"
 * supaya tidak perlu mengetik ulang. Status kalibrasi (kapan mulai, sisa
 * waktu, apakah selesai) ada di server (`group_calibrations`); kalau
 * localStorage ini hilang, fitur tetap jalan dengan nilai bawaan protokol.
 */

import {
  CALIBRATION_STEPS,
  defaultCalibrationDurations,
  normalizeCalibrationMins,
} from './calibration.ts';

const DURATIONS_KEY = 'esniffer:calibration:durations-v2';

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Penjelajah mode privat/kuota penuh boleh melempar; fitur lalu jalan
    // tanpa ingatan, bukan gagal.
    return null;
  }
};

/** Durasi terakhir yang dipakai operator; nilai rusak jatuh ke bawaan. */
export function readCalibrationDurations(): number[] {
  try {
    const raw = storage()?.getItem(DURATIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return CALIBRATION_STEPS.map(
      (step, i) => normalizeCalibrationMins(Array.isArray(parsed) ? parsed[i] : null) ?? step.defaultMins
    );
  } catch {
    return defaultCalibrationDurations();
  }
}

/** Simpan durasi yang baru dipakai sebagai nilai awal tahap berikutnya. */
export function saveCalibrationDurations(mins: readonly unknown[]): number[] {
  const normalized = CALIBRATION_STEPS.map(
    (step, i) => normalizeCalibrationMins(mins[i]) ?? step.defaultMins
  );
  try {
    storage()?.setItem(DURATIONS_KEY, JSON.stringify(normalized));
  } catch {
    // Tanpa localStorage: durasi tetap terpakai di sesi ini, hanya tidak diingat.
  }
  return normalized;
}
