/**
 * Pengujian unit parser dan validator topic MQTT v1
 * Sesuai docs/esniffer/03-technical-design.md Section 6.1
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopic, buildTopic, isValidDeviceId, TopicValidationError } from '../shared/topic.ts';

test('parseTopic: Mem-parsing topic telemetry valid', () => {
  const result = parseTopic('esniffer/v1/devices/esp32-001/telemetry');
  assert.strictEqual(result.version, 'v1');
  assert.strictEqual(result.deviceId, 'esp32-001');
  assert.strictEqual(result.messageType, 'telemetry');
});

test('parseTopic: Mem-parsing topic status dan ack valid', () => {
  const statusRes = parseTopic('esniffer/v1/devices/esp32_chamber_02/status');
  assert.strictEqual(statusRes.messageType, 'status');
  assert.strictEqual(statusRes.deviceId, 'esp32_chamber_02');

  const ackRes = parseTopic('esniffer/v1/devices/ESP32-DEV/ack');
  assert.strictEqual(ackRes.messageType, 'ack');
});

test('parseTopic: Menolak topic dengan struktur salah', () => {
  // Kurang segment
  assert.throws(
    () => parseTopic('esniffer/v1/devices/esp32-001'),
    (err: Error) => err instanceof TopicValidationError
  );

  // Prefix sistem salah
  assert.throws(
    () => parseTopic('other/v1/devices/esp32-001/telemetry'),
    (err: Error) => err instanceof TopicValidationError
  );

  // Versi salah
  assert.throws(
    () => parseTopic('esniffer/v2/devices/esp32-001/telemetry'),
    (err: Error) => err instanceof TopicValidationError
  );

  // Message type salah
  assert.throws(
    () => parseTopic('esniffer/v1/devices/esp32-001/command'),
    (err: Error) => err instanceof TopicValidationError
  );

  // Wildcard pada publish dilarang
  assert.throws(
    () => parseTopic('esniffer/v1/devices/+/telemetry'),
    (err: Error) => err instanceof TopicValidationError
  );
  assert.throws(
    () => parseTopic('esniffer/v1/devices/#/telemetry'),
    (err: Error) => err instanceof TopicValidationError
  );
});

test('isValidDeviceId: Karakter yang diizinkan dan batas panjang', () => {
  assert.ok(isValidDeviceId('esp32-001'));
  assert.ok(isValidDeviceId('DEV_01'));
  assert.ok(isValidDeviceId('a'.repeat(64)));

  assert.ok(!isValidDeviceId('')); // kosong
  assert.ok(!isValidDeviceId('a'.repeat(65))); // melebihi 64 karakter
  assert.ok(!isValidDeviceId('esp/32')); // ada slash
  assert.ok(!isValidDeviceId('esp 32')); // ada spasi
  assert.ok(!isValidDeviceId('esp*32')); // karakter khusus
});

test('buildTopic: Membangun topic yang tepat', () => {
  const topic = buildTopic('esp32-001', 'telemetry');
  assert.strictEqual(topic, 'esniffer/v1/devices/esp32-001/telemetry');
});
