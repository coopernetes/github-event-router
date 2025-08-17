import { getAppConfig } from "./config.js";
import Database, { type Database as DatabaseType } from "better-sqlite3";

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
  private _db: DatabaseType | null = null;

  private constructor() {
    const config = getAppConfig();
    if (config.database?.type === "sqlite") {
      this._db = new Database(config.database.filename);
      this._db.pragma("journal_mode = WAL");
    }
  }

  static getInstance(): SubscriberService {
    if (!SubscriberService._instance) {
      SubscriberService._instance = new SubscriberService();
    }
    return SubscriberService._instance;
  }

  private get db(): DatabaseType {
    if (!this._db) {
      throw new Error("Database not configured");
    }
    return this._db;
  }

  private fetchSubscribers(): Subscriber[] {
    if (!this._db) {
      return [];
    }
    return this.sqliteSource();
  }

  private sqliteSource(): Subscriber[] {
    const subscribers: Subscriber[] = [];
    const subscriberRows = this.db
      .prepare("SELECT id, name, events FROM subscribers")
      .all();
    for (const subRow of subscriberRows) {
      console.log(`DEBUG: subRow ${JSON.stringify(subRow)}`);
      const subscriber = subRow as Subscriber;
      const transportResult = this.db
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
    this._subscribers = config.subscribers.concat(this.fetchSubscribers());
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

  public createSubscriber(
    name: string,
    events: string[],
    transport: Omit<ConfiguredTransport, "id">
  ): Subscriber {
    const result = this.db.transaction(() => {
      // Insert subscriber
      const subscriberStmt = this.db.prepare(
        "INSERT INTO subscribers (name, events) VALUES (?, ?)"
      );
      const subscriberResult = subscriberStmt.run(name, JSON.stringify(events));
      const subscriberId = subscriberResult.lastInsertRowid as number;

      // Insert transport
      const transportStmt = this.db.prepare(
        "INSERT INTO transports (subscriber_id, name, config) VALUES (?, ?, ?)"
      );
      const transportResult = transportStmt.run(
        subscriberId,
        transport.name,
        JSON.stringify(transport.config)
      );

      return {
        id: subscriberId,
        name,
        events,
        transport: {
          id: transportResult.lastInsertRowid as number,
          name: transport.name,
          config: transport.config,
        },
      };
    })();

    this.invalidateCache();
    return result;
  }

  public updateSubscriber(
    id: number,
    updates: Partial<Omit<Subscriber, "id">>
  ): Subscriber {
    const result = this.db.transaction(() => {
      // Update subscriber details if provided
      if (updates.name || updates.events) {
        const sets = [];
        const params = [];
        if (updates.name) {
          sets.push("name = ?");
          params.push(updates.name);
        }
        if (updates.events) {
          sets.push("events = ?");
          params.push(JSON.stringify(updates.events));
        }
        params.push(id);

        const updateQuery = `UPDATE subscribers SET ${sets.join(", ")} WHERE id = ?`;
        this.db.prepare(updateQuery).run(...params);
      }

      // Update transport if provided
      if (updates.transport) {
        const transportStmt = this.db.prepare(`
          UPDATE transports 
          SET name = ?, config = ?
          WHERE subscriber_id = ?
        `);
        transportStmt.run(
          updates.transport.name,
          JSON.stringify(updates.transport.config),
          id
        );
      }

      // Fetch and return updated subscriber
      const subscriber = this.db
        .prepare("SELECT id, name, events FROM subscribers WHERE id = ?")
        .get(id) as Subscriber;
      const transportResult = this.db
        .prepare(
          "SELECT id, name, config FROM transports WHERE subscriber_id = ?"
        )
        .get(id) as TransportRow | undefined;

      if (transportResult) {
        subscriber.transport = {
          id: transportResult.id,
          name: transportResult.name,
          config: this.configType(JSON.parse(transportResult.config)),
        };
      }

      return subscriber;
    })();

    this.invalidateCache();
    return result;
  }

  public deleteSubscriber(id: number): void {
    this.db.transaction(() => {
      // Delete transport first due to foreign key constraint
      this.db.prepare("DELETE FROM transports WHERE subscriber_id = ?").run(id);
      // Then delete subscriber
      this.db.prepare("DELETE FROM subscribers WHERE id = ?").run(id);
    })();

    this.invalidateCache();
  }
}

export const getSubscribers = () => {
  return SubscriberService.getInstance().getSubscribers();
};

export const createSubscriber = (
  name: string,
  events: string[],
  transport: Omit<ConfiguredTransport, "id">
) => {
  return SubscriberService.getInstance().createSubscriber(
    name,
    events,
    transport
  );
};

export const updateSubscriber = (
  id: number,
  updates: Partial<Omit<Subscriber, "id">>
) => {
  return SubscriberService.getInstance().updateSubscriber(id, updates);
};

export const deleteSubscriber = (id: number) => {
  return SubscriberService.getInstance().deleteSubscriber(id);
};

export const refreshSubscribers = () => {
  return SubscriberService.getInstance().invalidateCache();
};
