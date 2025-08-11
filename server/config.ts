import config from "config";
import type { Subscriber } from "./subscriber.js";

export interface Config {
  server: {
    port: number;
  };
  app: {
    id: number;
    private_key: string;
    webhook_secret: string;
  };
  subscribers: Subscriber[];
  database: DatabaseConfig | undefined;
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
    subscribers: config.has('subscribers') ? config.get("subscribers") : [],
    database: config.get("database"),
  };
}
