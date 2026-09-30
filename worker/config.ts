export interface WorkerConfig {
  mqttUrl?: string;
  clientId?: string;
  username?: string;
  password?: string;
  caFile?: string;
  clientCertFile?: string;
  clientKeyFile?: string;
  concurrencyLimit?: number;
  maxQueueSize?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  healthHost?: string;
  healthPort?: number | null;
}

export interface ResolvedWorkerConfig {
  mqttUrl: string;
  clientId: string;
  username: string;
  password: string;
  caFile: string | null;
  clientCertFile: string | null;
  clientKeyFile: string | null;
  concurrencyLimit: number;
  maxQueueSize: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  healthHost: string;
  healthPort: number | null;
}

function positiveInteger(value: number | string | undefined, fallback: number, name: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPort(value: number | string | null | undefined, fallback: number | null): number | null {
  if (value === null) return null;
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('WORKER_HEALTH_PORT must be an integer between 1 and 65535');
  }
  return parsed;
}

export function resolveWorkerConfig(
  config: WorkerConfig = {},
  env: NodeJS.ProcessEnv = process.env
): ResolvedWorkerConfig {
  const production = env.NODE_ENV === 'production';
  const mqttUrl = configured(config.mqttUrl) ?? configured(env.MQTT_URL);
  const clientId = configured(config.clientId) ?? configured(env.MQTT_CLIENT_ID);
  const username = configured(config.username) ?? configured(env.MQTT_USERNAME);
  const password = configured(config.password) ?? configured(env.MQTT_PASSWORD);
  const caFile = configured(config.caFile) ?? configured(env.MQTT_CA_FILE) ?? null;
  const clientCertFile = configured(config.clientCertFile) ?? configured(env.MQTT_CLIENT_CERT_FILE) ?? null;
  const clientKeyFile = configured(config.clientKeyFile) ?? configured(env.MQTT_CLIENT_KEY_FILE) ?? null;

  if (production) {
    const missing = [
      ['MQTT_URL', mqttUrl],
      ['MQTT_CLIENT_ID', clientId],
      ['MQTT_USERNAME', username],
      ['MQTT_PASSWORD', password],
      ['MQTT_CA_FILE', caFile],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing mandatory production environment: ${missing.join(', ')}`);
    }
    if (!mqttUrl!.startsWith('mqtts://')) {
      throw new Error('MQTT_URL must use mqtts:// in production');
    }
  }

  if (mqttUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(mqttUrl);
    } catch {
      throw new Error('MQTT_URL must be an absolute mqtt:// or mqtts:// URL');
    }
    if (!['mqtt:', 'mqtts:'].includes(parsedUrl.protocol)) {
      throw new Error('MQTT_URL must use mqtt:// or mqtts://');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('MQTT_URL must not contain credentials; use MQTT_USERNAME and MQTT_PASSWORD');
    }
  }

  if ((clientCertFile && !clientKeyFile) || (!clientCertFile && clientKeyFile)) {
    throw new Error('MQTT_CLIENT_CERT_FILE and MQTT_CLIENT_KEY_FILE must be configured together');
  }

  const reconnectMinMs = positiveInteger(
    config.reconnectMinMs ?? env.MQTT_RECONNECT_MIN_MS,
    1000,
    'MQTT_RECONNECT_MIN_MS'
  );
  const reconnectMaxMs = positiveInteger(
    config.reconnectMaxMs ?? env.MQTT_RECONNECT_MAX_MS,
    30000,
    'MQTT_RECONNECT_MAX_MS'
  );
  if (reconnectMaxMs < reconnectMinMs) {
    throw new Error('MQTT_RECONNECT_MAX_MS must be greater than or equal to MQTT_RECONNECT_MIN_MS');
  }

  return {
    mqttUrl: mqttUrl ?? 'mqtt://127.0.0.1:1883',
    clientId: clientId ?? 'esniffer-ingest-v1',
    username: username ?? 'worker',
    password: password ?? 'workerpass123',
    caFile,
    clientCertFile,
    clientKeyFile,
    concurrencyLimit: positiveInteger(config.concurrencyLimit ?? env.WORKER_CONCURRENCY, 5, 'WORKER_CONCURRENCY'),
    maxQueueSize: positiveInteger(config.maxQueueSize ?? env.WORKER_MAX_QUEUE, 500, 'WORKER_MAX_QUEUE'),
    reconnectMinMs,
    reconnectMaxMs,
    healthHost: configured(config.healthHost) ?? configured(env.WORKER_HEALTH_HOST) ?? (production ? '0.0.0.0' : '127.0.0.1'),
    healthPort: optionalPort(config.healthPort ?? env.WORKER_HEALTH_PORT, production ? 8081 : null),
  };
}
