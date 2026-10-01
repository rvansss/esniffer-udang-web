/**
 * Parser dan validator topic MQTT v1 e-Sniffer
 * Format: esniffer/v1/devices/{device_id}/{telemetry|status|ack}
 * Sesuai docs/esniffer/03-technical-design.md Section 6.1
 */

import { MAX_DEVICE_ID_LENGTH, type ParsedTopic, type MqttMessageType } from './types.ts';

const DEVICE_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export class TopicValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicValidationError';
  }
}

/**
 * Validasi string device_id:
 * - Hanya karakter [A-Za-z0-9_-]
 * - Panjang 1..64 karakter
 */
export function isValidDeviceId(deviceId: string): boolean {
  if (!deviceId || typeof deviceId !== 'string') return false;
  if (deviceId.length > MAX_DEVICE_ID_LENGTH) return false;
  return DEVICE_ID_REGEX.test(deviceId);
}

/**
 * Parsing dan validasi topic MQTT v1.
 * Mengembalikan objek ParsedTopic jika valid, atau melempar TopicValidationError jika invalid.
 */
export function parseTopic(topic: string): ParsedTopic {
  if (!topic || typeof topic !== 'string') {
    throw new TopicValidationError('Topic must be a non-empty string');
  }

  const parts = topic.split('/');
  if (parts.length !== 5) {
    throw new TopicValidationError(`Invalid topic structure. Expected 5 segments, got ${parts.length}: "${topic}"`);
  }

  const [system, version, resource, deviceId, messageType] = parts;

  if (system !== 'esniffer') {
    throw new TopicValidationError(`Invalid topic system prefix. Expected 'esniffer', got '${system}'`);
  }

  if (version !== 'v1') {
    throw new TopicValidationError(`Unsupported topic version. Expected 'v1', got '${version}'`);
  }

  if (resource !== 'devices') {
    throw new TopicValidationError(`Invalid topic resource. Expected 'devices', got '${resource}'`);
  }

  if (!isValidDeviceId(deviceId)) {
    throw new TopicValidationError(
      `Invalid device_id in topic: "${deviceId}". Allowed chars: [A-Za-z0-9_-], max length: ${MAX_DEVICE_ID_LENGTH}`
    );
  }

  if (messageType !== 'telemetry' && messageType !== 'status' && messageType !== 'ack') {
    throw new TopicValidationError(
      `Invalid message type in topic: "${messageType}". Expected telemetry, status, or ack`
    );
  }

  return {
    version: 'v1',
    deviceId,
    messageType: messageType as MqttMessageType,
    rawTopic: topic,
  };
}

/**
 * Membangun topic resmi dari deviceId dan messageType
 */
export function buildTopic(deviceId: string, messageType: MqttMessageType): string {
  if (!isValidDeviceId(deviceId)) {
    throw new TopicValidationError(`Cannot build topic with invalid deviceId: "${deviceId}"`);
  }
  return `esniffer/v1/devices/${deviceId}/${messageType}`;
}
