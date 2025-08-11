import { getAppConfig, type Config, type DatabaseConfig } from "./config.js";
import Database from "better-sqlite3";

export interface Subscriber {
  id: number;
  name: string;
  events: string[];
  transport: ConfiguredTransport | undefined;
}

export type TransportName = "https" | "redis";

export interface Transport {
  id: number;
  name: TransportName;
}

export type ConfiguredTransport = Transport & {
  config: TransportConfig;
};

export type TransportRow = Transport & {
  config: string; // JSON string
};

export interface HttpsTransportConfig {
  url: string;
  webhook_secret: string;
}

export interface RedisTransportConfig {
  url: string;
  password: string;
}

export type TransportConfig = HttpsTransportConfig | RedisTransportConfig;

class SubscriberService {
  private static _instance: SubscriberService;
  private _subscribers: Subscriber[] | null = null;

  private constructor() {}

  static getInstance(): SubscriberService {
    if (!SubscriberService._instance) {
      SubscriberService._instance = new SubscriberService();
    }
    return SubscriberService._instance;
  }

  private fetchSubscribers(config: Config): Subscriber[] {
    if (!config.database) {
      return [];
    }
    if (config.database.type === "sqlite") {
      return this.sqliteSource(config.database);
    }
    return [];
  }

  private sqliteSource(config: DatabaseConfig): Subscriber[] {
    const subscribers: Subscriber[] = [];
    const db = new Database(config.filename);
    db.pragma("journal_mode = WAL");
    const subscriberRows = db
      .prepare("SELECT id, name, events FROM subscribers")
      .all();
    for (const subRow of subscriberRows) {
      console.log(`DEBUG: subRow ${JSON.stringify(subRow)}`);
      const subscriber = subRow as Subscriber;
      const transportResult = db
        .prepare(
          "SELECT id, name, config FROM transports WHERE subscriber_id = ?"
        )
        .get(subscriber.id);
      console.log(`DEBUG: transportResult ${JSON.stringify(transportResult)}`);
      if (!transportResult) {
        console.warn(`No transport found for subscriber ${subscriber.id}`);
      } else {
        const transportRow = transportResult as TransportRow;
        const config = this.configType(JSON.parse(transportRow.config));
        subscriber.transport = {
          id: transportRow.id,
          name: transportRow.name,
          config,
        };
      }
      subscribers.push(subscriber);
    }
    return subscribers;
  }

  public getSubscribers(): Subscriber[] {
    if (this._subscribers) {
      return this._subscribers;
    }
    const config = getAppConfig();
    this._subscribers = config.subscribers.concat(
      this.fetchSubscribers(config)
    );
    return this._subscribers;
  }

  public invalidateCache() {
    this._subscribers = null;
  }

  private configType(raw: Record<string, string>): TransportConfig {
    if (Object.keys(raw).includes("webhook_secret")) {
      return raw as unknown as HttpsTransportConfig;
    }
    return raw as unknown as RedisTransportConfig;
  }
}

export const getSubscribers = () => {
  return SubscriberService.getInstance().getSubscribers();
};

export const refreshSubscribers = () => {
  return SubscriberService.getInstance().invalidateCache();
};
