import config from "config";

export interface ServerConfig {
  app: {
    id: number;
    client_id: string;
    client_secret: string;
    webhook_secret: string;
    private_key: string;
  };
  receivers: {
    url: string;
    webhook_secret: string;
  }[];
}

let appConfig: ServerConfig | null;

export function setAppConfig(config: ServerConfig): void {
  appConfig = config;
}

export function getAppConfig(): ServerConfig {
  if (!appConfig) {
    throw new Error("App config is not initialized!");
  }
  return appConfig;
}

export function loadConfig(): ServerConfig {
  return {
    app: {
      id: config.get("app.id") || 1, // Default to 1 if not set
      client_id: config.get("app.client_id") || "<your_client_id>",
      client_secret: config.get("app.client_secret") || "<your_client_secret>",
      webhook_secret:
        config.get("app.webhook_secret") || "<your_webhook_secret>",
      private_key: config.get("app.private_key") || "<your_private_key>",
    },
    receivers: config.get("receivers") || [],
  };
}
