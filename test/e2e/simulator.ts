/**
 * ESP32 Device Simulator for e-Sniffer Udang
 * Sesuai kontrak MQTT v1 di docs/esniffer/03-technical-design.md Section 6:
 * - Menggunakan kredensial per perangkat
 * - Memasang retained LWT offline pada connect
 * - Menerbitkan status connect/heartbeat
 * - Menerbitkan telemetry QoS 1
 * - Menangkap application ACK pada topic .../ack
 */

import mqtt, { type MqttClient } from 'mqtt';
import { randomUUID } from 'node:crypto';
import {
  type ApplicationAck,
  type StatusPayloadInput,
  type TelemetryPayloadInput,
  SCHEMA_VERSION,
} from '../../shared/types.ts';

export interface SimulatorOptions {
  mqttUrl?: string;
  deviceId?: string;
  password?: string;
  firmwareVersion?: string;
}

export class DeviceSimulator {
  public deviceId: string;
  public bootId: string;
  public sessionId: string;
  public connectionSeq: number;
  public statusSeq: number;
  public telemetrySeq: number;
  private password: string;
  private mqttUrl: string;
  private firmwareVersion: string;
  private client: MqttClient | null = null;
  private ackListeners: Map<string, (ack: ApplicationAck) => void> = new Map();
  private receivedAcks: ApplicationAck[] = [];

  constructor(options: SimulatorOptions = {}) {
    this.deviceId = options.deviceId || 'esp32-001';
    this.password = options.password || 'devicepass001';
    this.mqttUrl = options.mqttUrl || 'mqtt://127.0.0.1:1883';
    this.firmwareVersion = options.firmwareVersion || '1.0.0';
    this.bootId = randomUUID();
    this.sessionId = randomUUID();
    this.connectionSeq = 1;
    this.statusSeq = 1;
    this.telemetrySeq = 1;
  }

  public async connect(): Promise<void> {
    const lwtPayload: StatusPayloadInput = {
      schema_version: SCHEMA_VERSION,
      device_id: this.deviceId,
      boot_id: this.bootId,
      session_id: this.sessionId,
      connection_sequence: this.connectionSeq,
      status_sequence: this.statusSeq,
      event_type: 'will',
      state: 'offline',
      uptime_ms: 0,
      event_at: null,
      clock_synced: false,
    };

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.mqttUrl, {
        clientId: `${this.deviceId}-${Date.now().toString().slice(-6)}`,
        username: this.deviceId,
        password: this.password,
        clean: true,
        connectTimeout: 4000,
        will: {
          topic: `esniffer/v1/devices/${this.deviceId}/status`,
          payload: Buffer.from(JSON.stringify(lwtPayload)),
          qos: 1,
          retain: true,
        },
      });

      this.client.on('connect', () => {
        // Subscribe ke application ack
        this.client!.subscribe(`esniffer/v1/devices/${this.deviceId}/ack`, { qos: 1 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.client.on('message', (topic, payload) => {
        if (topic === `esniffer/v1/devices/${this.deviceId}/ack`) {
          try {
            const ack = JSON.parse(payload.toString('utf8')) as ApplicationAck;
            const listener = this.ackListeners.get(ack.message_id);
            if (listener) {
              this.ackListeners.delete(ack.message_id);
              listener(ack);
            } else {
              this.receivedAcks.push(ack);
            }
          } catch {
            // Ignore malformed ack
          }
        }
      });

      this.client.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async publishConnectStatus(uptimeMs = 500): Promise<void> {
    const statusPayload: StatusPayloadInput = {
      schema_version: SCHEMA_VERSION,
      device_id: this.deviceId,
      boot_id: this.bootId,
      session_id: this.sessionId,
      connection_sequence: this.connectionSeq,
      status_sequence: ++this.statusSeq,
      event_type: 'connect',
      state: 'online',
      uptime_ms: uptimeMs,
      event_at: new Date().toISOString(),
      clock_synced: true,
      firmware_version: this.firmwareVersion,
    };

    await this.publish(
      `esniffer/v1/devices/${this.deviceId}/status`,
      JSON.stringify(statusPayload),
      { qos: 1, retain: true }
    );
  }

  public async publishHeartbeat(uptimeMs = 15000): Promise<void> {
    const statusPayload: StatusPayloadInput = {
      schema_version: SCHEMA_VERSION,
      device_id: this.deviceId,
      boot_id: this.bootId,
      session_id: this.sessionId,
      connection_sequence: this.connectionSeq,
      status_sequence: ++this.statusSeq,
      event_type: 'heartbeat',
      state: 'online',
      uptime_ms: uptimeMs,
      event_at: new Date().toISOString(),
      clock_synced: true,
      firmware_version: this.firmwareVersion,
    };

    await this.publish(
      `esniffer/v1/devices/${this.deviceId}/status`,
      JSON.stringify(statusPayload),
      { qos: 1, retain: true }
    );
  }

  public createTelemetryPayload(
    options: Partial<TelemetryPayloadInput> = {}
  ): TelemetryPayloadInput {
    const seq = options.sequence ?? this.telemetrySeq++;
    const messageId = `${this.bootId}:${String(seq).padStart(10, '0')}`;

    return {
      schema_version: SCHEMA_VERSION,
      device_id: this.deviceId,
      message_id: messageId,
      boot_id: this.bootId,
      sequence: seq,
      sample_uptime_ms: options.sample_uptime_ms ?? 10000,
      measured_at: options.measured_at !== undefined ? options.measured_at : new Date().toISOString(),
      clock_synced: options.clock_synced ?? true,
      firmware_version: this.firmwareVersion,
      sensors: options.sensors || {
        temperature_c: { value: 27.5, quality: 'ok' },
        humidity_percent: { value: 76.0, quality: 'ok' },
        mq137_raw: { value: 450, quality: 'ok' },
        mq136_raw: { value: null, quality: 'missing' },
        mq4_raw: { value: 280, quality: 'ok' },
      },
      ...options,
    };
  }

  public async sendTelemetry(payload: TelemetryPayloadInput | string): Promise<void> {
    const topic = `esniffer/v1/devices/${this.deviceId}/telemetry`;
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await this.publish(topic, data, { qos: 1, retain: false });
  }

  public async sendRaw(topic: string, data: string | Buffer): Promise<void> {
    await this.publish(topic, data, { qos: 1, retain: false });
  }

  public clearAcks(): void {
    this.receivedAcks = [];
  }

  public waitForAck(messageId: string, timeoutMs = 4000): Promise<ApplicationAck> {
    const existingIndex = this.receivedAcks.findIndex((a) => a.message_id === messageId);
    if (existingIndex !== -1) {
      const ack = this.receivedAcks[existingIndex];
      this.receivedAcks.splice(existingIndex, 1);
      return Promise.resolve(ack);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ackListeners.delete(messageId);
        reject(new Error(`Timeout waiting for ACK for message_id "${messageId}" (${timeoutMs}ms)`));
      }, timeoutMs);

      this.ackListeners.set(messageId, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  private publish(topic: string, data: string | Buffer, opts: { qos: 0 | 1 | 2; retain: boolean }): Promise<void> {
    if (!this.client || !this.client.connected) {
      return Promise.reject(new Error('Simulator not connected'));
    }

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, data, opts, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => {
        this.client!.end(true, {}, () => resolve());
      });
      this.client = null;
    }
  }
}
