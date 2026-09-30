/**
 * Worker Ingestion Daemon untuk e-Sniffer Udang
 * Sesuai Fase 3:
 * - Proses terpisah untuk koneksi MQTT broker (QoS 1, persistent session)
 * - Subscription ke topic telemetry dan status
 * - Bounded concurrency queue (max 5 paralel sesuai database connection pool)
 * - ACK aplikasi diterbitkan HANYA setelah transaksi database commit
 * - Penanganan duplicate/conflict, unresolved-time, status retained, dan reconnect
 * - Graceful shutdown (drains queue, terminates MQTT, disconnects DB)
 */

import 'dotenv/config';
import mqtt, { type MqttClient, type IPublishPacket } from 'mqtt';
import { logger } from '../lib/logging/logger.ts';
import { runWithLogContext } from '../lib/logging/context.ts';
import { processTelemetryMessage } from './pipeline.ts';
import { PrismaTelemetryStorage } from './storage.ts';
import { validateStatusPayload } from '../shared/status.ts';
import { parseTopic } from '../shared/topic.ts';
import { closeDb } from '../lib/db/client.ts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createWorkerHealthServer } from './health.ts';
import {
  resolveWorkerConfig,
  type ResolvedWorkerConfig,
  type WorkerConfig,
} from './config.ts';

export type { WorkerConfig } from './config.ts';

interface QueuedMessage {
  topic: string;
  payload: Buffer;
  packet: IPublishPacket;
}

export class WorkerDaemon {
  private isRunning = false;
  private isStopping = false;
  private mqttConnected = false;
  private subscriptionActive = false;
  private client: MqttClient | null = null;
  private config: ResolvedWorkerConfig;
  private storage: PrismaTelemetryStorage;
  private activeTasks = 0;
  private queue: QueuedMessage[] = [];
  private sigintHandler: (() => void) | null = null;
  private sigtermHandler: (() => void) | null = null;
  private healthServer: Server | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private permanentConnectionFailure = false;

  constructor(config: WorkerConfig = {}, storage?: PrismaTelemetryStorage) {
    this.config = resolveWorkerConfig(config);
    this.storage = storage || new PrismaTelemetryStorage();
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({
        service: 'worker',
        operation: 'startup',
        message: 'Worker is already running',
      });
      return;
    }

    this.isRunning = true;
    this.isStopping = false;
    this.permanentConnectionFailure = false;
    this.reconnectAttempt = 0;
    this.setupSignalHandlers();

    logger.info({
      service: 'worker',
      operation: 'startup',
      message: 'Worker daemon starting',
      mqtt_url: this.config.mqttUrl,
      client_id: this.config.clientId,
      concurrency_limit: this.config.concurrencyLimit,
    });

    await this.startHealthServer();
    await this.connectMqtt();
  }

  private async startHealthServer(): Promise<void> {
    if (this.config.healthPort === null || this.healthServer) return;

    this.healthServer = createWorkerHealthServer({
      isLive: () => this.isRunning && !this.isStopping,
      isReady: () => this.isReady(),
    });
    await new Promise<void>((resolve, reject) => {
      this.healthServer!.once('error', reject);
      this.healthServer!.listen(this.config.healthPort!, this.config.healthHost, () => {
        this.healthServer!.off('error', reject);
        resolve();
      });
    });
  }

  private async connectMqtt(): Promise<void> {
    const ca = this.config.caFile ? readFileSync(this.config.caFile) : undefined;
    const cert = this.config.clientCertFile ? readFileSync(this.config.clientCertFile) : undefined;
    const key = this.config.clientKeyFile ? readFileSync(this.config.clientKeyFile) : undefined;

    return new Promise((resolve, reject) => {
      let initialPending = true;
      const settleInitial = (error?: Error) => {
        if (!initialPending) return;
        initialPending = false;
        if (error) reject(error);
        else resolve();
      };

      this.client = mqtt.connect(this.config.mqttUrl, {
        clientId: this.config.clientId,
        username: this.config.username,
        password: this.config.password,
        clean: false, // Persistent session untuk at-least-once ingestion
        protocolVersion: 5,
        properties: { sessionExpiryInterval: 24 * 60 * 60 },
        reconnectPeriod: 0,
        connectTimeout: 5000,
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
        ...(cert && key ? { cert, key } : {}),
      });

      this.client.on('connect', () => {
        this.mqttConnected = true;
        this.subscriptionActive = false;
        this.permanentConnectionFailure = false;
        this.reconnectAttempt = 0;
        logger.info({
          service: 'worker',
          operation: 'mqtt_connected',
          message: 'MQTT connection established',
          client_id: this.config.clientId,
        });

        const topics = [
          'esniffer/v1/devices/+/telemetry',
          'esniffer/v1/devices/+/status',
        ];

        this.client!.subscribe(topics, { qos: 1 }, (err) => {
          if (err) {
            logger.error({
              service: 'worker',
              operation: 'subscription_error',
              message: err.message,
            });
            this.permanentConnectionFailure = true;
            settleInitial(err);
            this.client?.end(true);
          } else {
            this.subscriptionActive = true;
            logger.info({
              service: 'worker',
              operation: 'subscription_active',
              message: 'Subscribed to telemetry and status topics (QoS 1)',
            });
            settleInitial();
          }
        });
      });

      this.client.on('message', (topic, payload, packet) => {
        this.handleIncomingMessage(topic, payload, packet);
      });

      this.client.on('error', (err) => {
        this.mqttConnected = false;
        logger.error({
          service: 'worker',
          operation: 'mqtt_error',
          message: err.message,
        });
        if (this.isPermanentMqttError(err)) {
          this.permanentConnectionFailure = true;
          settleInitial(err);
          this.client?.end(true);
        } else {
          // Broker/network outage must not terminate the worker process. The
          // close handler schedules a bounded reconnect in the background.
          settleInitial();
        }
      });

      this.client.on('offline', () => {
        this.mqttConnected = false;
        this.subscriptionActive = false;
        logger.warn({
          service: 'worker',
          operation: 'mqtt_offline',
          message: 'MQTT client is offline, reconnecting...',
        });
      });

      this.client.on('close', () => {
        this.mqttConnected = false;
        this.subscriptionActive = false;
        settleInitial();
        this.scheduleReconnect();
      });
    });
  }

  private isPermanentMqttError(error: Error): boolean {
    return /not authorized|bad user name|bad username|certificate|self[- ]signed|unable to verify|hostname\/ip does not match|tlsv1 alert|unknown ca/i.test(error.message);
  }

  private scheduleReconnect(): void {
    if (
      !this.isRunning ||
      this.isStopping ||
      this.permanentConnectionFailure ||
      this.reconnectTimer ||
      !this.client
    ) return;

    const exponential = Math.min(
      this.config.reconnectMaxMs,
      this.config.reconnectMinMs * (2 ** Math.min(this.reconnectAttempt, 30))
    );
    const jittered = Math.round(exponential * (0.75 + Math.random() * 0.5));
    const delayMs = Math.max(
      this.config.reconnectMinMs,
      Math.min(this.config.reconnectMaxMs, jittered)
    );
    const attempt = ++this.reconnectAttempt;

    logger.warn({
      service: 'worker',
      operation: 'mqtt_reconnect_scheduled',
      attempt,
      delay_ms: delayMs,
      message: 'MQTT reconnect scheduled with bounded exponential backoff',
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isRunning || this.isStopping || this.permanentConnectionFailure) return;
      try {
        this.client?.reconnect();
      } catch (error) {
        logger.error({
          service: 'worker',
          operation: 'mqtt_reconnect_error',
          message: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  public async isReady(): Promise<boolean> {
    if (!this.isRunning || this.isStopping || !this.mqttConnected || !this.subscriptionActive) {
      return false;
    }
    try {
      await this.storage.checkHealth();
      return true;
    } catch {
      return false;
    }
  }

  private handleIncomingMessage(
    topic: string,
    payload: Buffer,
    packet: IPublishPacket
  ): void {
    if (!this.isRunning || this.isStopping) return;

    if (this.queue.length >= this.config.maxQueueSize) {
      logger.warn({
        service: 'worker',
        operation: 'process_queue',
        outcome: 'rejected',
        reason_code: 'QUEUE_CAPACITY_EXCEEDED',
        message: `Worker queue reached maximum capacity (${this.config.maxQueueSize}), dropping incoming message for backpressure`,
      });
      return;
    }

    this.queue.push({ topic, payload, packet });
    this.processQueue();
  }

  private processQueue(): void {
    if (
      this.activeTasks >= this.config.concurrencyLimit ||
      this.queue.length === 0 ||
      !this.isRunning
    ) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeTasks++;

    this.dispatchMessage(item.topic, item.payload, item.packet)
      .catch((err) => {
        logger.error({
          service: 'worker',
          operation: 'dispatch_error',
          topic: item.topic,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.activeTasks--;
        setImmediate(() => this.processQueue());
      });
  }

  private async dispatchMessage(
    topicStr: string,
    payloadBuf: Buffer,
    packet: IPublishPacket
  ): Promise<void> {
    let parsedTopic;
    try {
      parsedTopic = parseTopic(topicStr);
    } catch {
      logger.warn({
        service: 'worker',
        operation: 'topic_invalid',
        topic: topicStr,
      });
      return;
    }

    const correlationId = randomUUID();
    await runWithLogContext({ correlationId, service: 'worker' }, async () => {
      if (parsedTopic.messageType === 'telemetry') {
        const outcome = await processTelemetryMessage(
          topicStr,
          payloadBuf,
          this.storage,
          new Date(),
          correlationId
        );

        // KRITIKAL: ACK hanya diterbitkan sesudah transaksi database commit (status accepted/accepted_unresolved_time)
        // atau duplicate/reject terkonfirmasi.
        if (outcome && outcome.ack) {
          const ackTopic = `esniffer/v1/devices/${parsedTopic.deviceId}/ack`;
          const ackPayload = JSON.stringify(outcome.ack);
          await this.publishAck(ackTopic, ackPayload);
        }
      } else if (parsedTopic.messageType === 'status') {
        try {
          const json = JSON.parse(payloadBuf.toString('utf8'));
          const validated = validateStatusPayload(json, parsedTopic.deviceId);
          await this.storage.recordStatusEvent(
            validated,
            packet.retain ?? false,
            new Date()
          );
        } catch (err) {
          logger.warn({
            service: 'worker',
            operation: 'status_validation_failed',
            device_id: parsedTopic.deviceId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  }

  public async publishAck(ackTopic: string, ackPayload: string): Promise<void> {
    if (!this.client || !this.client.connected) {
      logger.error({
        service: 'worker',
        operation: 'publish_ack_failed',
        message: 'MQTT client not connected',
        topic: ackTopic,
      });
      throw new Error('MQTT client not connected');
    }

    return new Promise((resolve, reject) => {
      this.client!.publish(
        ackTopic,
        ackPayload,
        { qos: 1, retain: false },
        (err) => {
          if (err) {
            logger.error({
              service: 'worker',
              operation: 'publish_ack_error',
              topic: ackTopic,
              message: err.message,
            });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  public async stop(closeDatabase = false): Promise<void> {
    if (!this.isRunning || this.isStopping) return;

    logger.info({
      service: 'worker',
      operation: 'shutdown',
      message: 'Worker daemon stopping gracefully; draining in-flight queue',
    });

    this.isStopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Berhenti menerima pesan baru, tetapi terus proses seluruh antrean yang
    // sudah diterima sebelum memutus persistent MQTT session.
    this.processQueue();
    const deadline = Date.now() + 5000;
    while ((this.activeTasks > 0 || this.queue.length > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (this.activeTasks > 0 || this.queue.length > 0) {
      logger.warn({
        service: 'worker',
        operation: 'shutdown_drain_timeout',
        active_tasks: this.activeTasks,
        queued_count: this.queue.length,
        message: 'Worker grace period expired before the queue fully drained',
      });
    }

    this.isRunning = false;

    if (this.client) {
      // Seluruh pekerjaan aplikasi sudah di-drain. Tutup transport tanpa
      // menulis paket baru agar callback MQTT.js yang sedang menutup stream
      // tidak berlomba menulis DISCONNECT (ERR_STREAM_WRITE_AFTER_END).
      // Session tetap persisten karena clean=false + session expiry MQTT 5;
      // redelivery sesudah restart tetap dilindungi deduplikasi database.
      await new Promise<void>((resolve) => {
        this.client!.end(true, {}, () => resolve());
      });
      this.client = null;
    }
    this.mqttConnected = false;
    this.subscriptionActive = false;
    if (this.healthServer) {
      const server = this.healthServer;
      this.healthServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.isStopping = false;
    this.removeSignalHandlers();

    if (closeDatabase) {
      await closeDb();
    }

    logger.info({
      service: 'worker',
      operation: 'shutdown_complete',
      message: 'Worker daemon stopped',
    });
  }

  public getStatus(): {
    isRunning: boolean;
    activeTasks: number;
    queuedCount: number;
    mqttConnected: boolean;
    subscriptionActive: boolean;
    isStopping: boolean;
    config: {
      mqttUrl: string;
      clientId: string;
      concurrencyLimit: number;
      maxQueueSize: number;
      reconnectMinMs: number;
      reconnectMaxMs: number;
      tlsEnabled: boolean;
      mutualTlsEnabled: boolean;
    };
  } {
    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks,
      queuedCount: this.queue.length,
      mqttConnected: this.mqttConnected,
      subscriptionActive: this.subscriptionActive,
      isStopping: this.isStopping,
      config: {
        mqttUrl: this.config.mqttUrl,
        clientId: this.config.clientId,
        concurrencyLimit: this.config.concurrencyLimit,
        maxQueueSize: this.config.maxQueueSize,
        reconnectMinMs: this.config.reconnectMinMs,
        reconnectMaxMs: this.config.reconnectMaxMs,
        tlsEnabled: this.config.mqttUrl.startsWith('mqtts://'),
        mutualTlsEnabled: Boolean(this.config.clientCertFile && this.config.clientKeyFile),
      },
    };
  }

  private setupSignalHandlers(): void {
    this.removeSignalHandlers();
    const handleShutdown = async (signal: string) => {
      logger.info({
        service: 'worker',
        operation: 'signal_received',
        message: `Received ${signal}, initiating shutdown`,
      });
      await this.stop(true);
      process.exit(0);
    };

    this.sigintHandler = () => { void handleShutdown('SIGINT'); };
    this.sigtermHandler = () => { void handleShutdown('SIGTERM'); };
    process.once('SIGINT', this.sigintHandler);
    process.once('SIGTERM', this.sigtermHandler);
  }

  private removeSignalHandlers(): void {
    if (this.sigintHandler) process.off('SIGINT', this.sigintHandler);
    if (this.sigtermHandler) process.off('SIGTERM', this.sigtermHandler);
    this.sigintHandler = null;
    this.sigtermHandler = null;
  }
}

// Entry point jika dijalankan langsung melalui CLI
if (
  typeof process !== 'undefined' &&
  process.argv[1]?.endsWith('worker/index.ts')
) {
  const worker = new WorkerDaemon();
  worker.start().catch((err) => {
    logger.error({
      service: 'worker',
      operation: 'startup_error',
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
