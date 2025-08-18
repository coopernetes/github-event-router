import config from "config";

export interface Config {
  server: {
    port: number;
  };
  app: {
    id: number;
    private_key: string;
    webhook_secret: string;
  };
  database: DatabaseConfig | undefined;
  event_processing: EventProcessingConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
}

export type DatabaseType = "sqlite" | "postgres";

export interface DatabaseConfig {
  type: DatabaseType;
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
  return {
    server: {
      port: config.get("server.port"),
    },
    app: {
      id: config.get("app.id"),
      private_key: config.get("app.private_key"),
      webhook_secret: config.get("app.webhook_secret"),
    },
    database: config.get("database"),
    event_processing: config.get("event_processing"),
    monitoring: config.get("monitoring"),
    security: config.get("security"),
  };
}
