import config from "config";
import type { QueueType } from "./queue/factory.js";

export interface Config {
  server: {
    port: number;
  };
  app: {
    webhook_secret: string;
  };
  database: DatabaseConfig | undefined;
  event_processing: EventProcessingConfig;
  internal_queue: InternalQueueConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
}

export type DatabaseType = "sqlite" | "postgres";

export interface DatabaseConfig {
  type: DatabaseType;
  encryption_key: string;
  filename?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

export interface RetryConfig {
  max_attempts: number;
  backoff_strategy: "linear" | "exponential";
  initial_delay_ms: number;
  max_delay_ms: number;
  retryable_status_codes: number[];
}

export interface InternalQueueConfig {
  enabled: boolean;
  type: QueueType;
  consumer_count: number;
  poll_interval_ms: number;
  visibility_timeout_ms: number;
  // Redis-specific
  redis?: {
    url: string;
    password?: string;
    stream_name?: string;
    consumer_group?: string;
  };
  // Kafka-specific
  kafka?: {
    brokers: string[];
    topic: string;
    client_id?: string;
    group_id?: string;
  };
  // AMQP-specific
  amqp?: {
    url: string;
    queue_name?: string;
    exchange?: string;
  };
  // SQS-specific
  sqs?: {
    region: string;
    queue_url: string;
    access_key_id?: string;
    secret_access_key?: string;
  };
  // Azure Event Hub-specific
  azure_eventhub?: {
    connection_string: string;
    event_hub_name: string;
    consumer_group?: string;
  };
}

export interface EventProcessingConfig {
  retry: RetryConfig;
  timeouts: {
    http_delivery_timeout_ms: number;
    redis_delivery_timeout_ms: number;
  };
  queue: {
    batch_size: number;
    processing_interval_ms: number;
    dead_letter_threshold: number;
  };
}

export interface MonitoringConfig {
  enable_metrics: boolean;
  log_level: string;
  failed_delivery_alerts: boolean;
}

export interface SecurityConfig {
  enable_rate_limiting: boolean;
  requests_per_minute: number;
  payload_size_limit_mb: number;
}

let appConfig: Config | null;

export function setAppConfig(config: Config): void {
  appConfig = config;
}

export function getAppConfig(): Config {
  if (!appConfig) {
    throw new Error("App config is not initialized!");
  }
  return appConfig;
}

export function loadConfig(): Config {
  // Load internal_queue config with defaults
  let internalQueueConfig: InternalQueueConfig;
  try {
    internalQueueConfig = config.get("internal_queue");
  } catch {
    // Default to disabled (synchronous processing) if not configured
    internalQueueConfig = {
      enabled: false,
      type: "memory",
      consumer_count: 1,
      poll_interval_ms: 100,
      visibility_timeout_ms: 30000,
    };
  }

  return {
    server: {
      port: config.get("server.port"),
    },
    app: {
      webhook_secret: config.get("app.webhook_secret"),
    },
    database: config.get("database"),
    event_processing: config.get("event_processing"),
    internal_queue: internalQueueConfig,
    monitoring: config.get("monitoring"),
    security: config.get("security"),
  };
}
