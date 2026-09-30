/**
 * Definisi unit, valid range, dan batasan sensor e-Sniffer Udang
 * Sesuai ADR-003 dan docs/esniffer/03-technical-design.md
 */

export interface SensorMetadata {
  key: string;
  name: string;
  unit: string;
  isRawAdc: boolean;
  minVal: number;
  maxVal: number;
  description: string;
}

export const SENSOR_METADATA: Record<string, SensorMetadata> = {
  temperature_c: {
    key: 'temperature_c',
    name: 'Suhu',
    unit: '°C',
    isRawAdc: false,
    minVal: -40.0,
    maxVal: 85.0,
    description: 'Suhu ruangan/chamber dalam derajat Celsius',
  },
  humidity_percent: {
    key: 'humidity_percent',
    name: 'Kelembaban',
    unit: '%',
    isRawAdc: false,
    minVal: 0.0,
    maxVal: 100.0,
    description: 'Kelembaban relatif dalam persen',
  },
  mq137_raw: {
    key: 'mq137_raw',
    name: 'MQ-137 Raw',
    unit: 'raw_adc',
    isRawAdc: true,
    minVal: 0,
    maxVal: 4095,
    description: 'Nilai mentah 12-bit ADC sensor gas amonia (NH3)',
  },
  mq136_raw: {
    key: 'mq136_raw',
    name: 'MQ-136 Raw',
    unit: 'raw_adc',
    isRawAdc: true,
    minVal: 0,
    maxVal: 4095,
    description: 'Nilai mentah 12-bit ADC sensor gas hidrogen sulfida (H2S)',
  },
  mq4_raw: {
    key: 'mq4_raw',
    name: 'MQ-4 Raw',
    unit: 'raw_adc',
    isRawAdc: true,
    minVal: 0,
    maxVal: 4095,
    description: 'Nilai mentah 12-bit ADC sensor gas metana (CH4)',
  },
} as const;

export const REQUIRED_SENSOR_KEYS = [
  'temperature_c',
  'humidity_percent',
  'mq137_raw',
  'mq136_raw',
  'mq4_raw',
] as const;

export function isSensorValueInRange(key: string, value: number): boolean {
  const meta = SENSOR_METADATA[key];
  if (!meta) return false;
  return Number.isFinite(value) && value >= meta.minVal && value <= meta.maxVal;
}
