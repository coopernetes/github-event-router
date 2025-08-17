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

  private constructor(dbPath: string) {
    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");
  }

  private normalizeSubscriber(raw: {
    id?: number;
    name: string;
    events: string | string[];
    transport?: {
      id?: number;
      name: string;
      config: string | Record<string, unknown>;
    };
  }): Subscriber {
    // Ensure events is always an array
    const events =
      typeof raw.events === "string"
        ? raw.events.split(",").map((e) => e.trim())
        : Array.isArray(raw.events)
          ? raw.events
          : [];

    if (!raw.name || events.length === 0) {
      throw new Error("Invalid subscriber data: name and events are required");
    }

    // Normalize transport name (convert 'http' to 'https')
    const transportName =
      raw.transport?.name === "http" ? "https" : raw.transport?.name;
    if (transportName && !["https", "redis"].includes(transportName)) {
      throw new Error(`Invalid transport type: ${transportName}`);
    }

    return {
      id: raw.id ?? 0, // Use 0 for new subscribers
      name: raw.name,
      events,
      transport: raw.transport
        ? {
            id: raw.transport.id ?? 0,
            name: transportName as TransportName,
            config:
              typeof raw.transport.config === "string"
                ? JSON.parse(raw.transport.config)
                : raw.transport.config,
          }
        : undefined,
    };
  }

  static getInstance(dbPath = "./database.sqlite"): SubscriberService {
    if (!SubscriberService._instance) {
      SubscriberService._instance = new SubscriberService(dbPath);
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

    for (const row of subscriberRows) {
      const subRow = row as { id: number; name: string; events: string };

      // Get transport data
      const transportResult = this.db
        .prepare(
          "SELECT id, name, config FROM transports WHERE subscriber_id = ?"
        )
        .get(subRow.id);

      // Normalize the raw data from database
      const rawSubscriber: {
        id: number;
        name: string;
        events: string;
        transport?: {
          id: number;
          name: string;
          config: string;
        };
      } = {
        id: subRow.id,
        name: subRow.name,
        events: subRow.events, // This will be normalized by normalizeSubscriber
      };

      if (transportResult) {
        const transport = transportResult as {
          id: number;
          name: string;
          config: string;
        };
        rawSubscriber.transport = transport;
      }

      try {
        const subscriber = this.normalizeSubscriber(rawSubscriber);
        subscribers.push(subscriber);
      } catch (error) {
        console.error(`Error normalizing subscriber ${subRow.id}:`, error);
        // Skip this subscriber if normalization fails
        continue;
      }
    }
    return subscribers;
  }

  public getSubscribers(): Subscriber[] {
    if (this._subscribers === null) {
      this._subscribers = this.fetchSubscribers();
    }
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
          // Convert array to comma-separated string for database storage
          const eventsString = Array.isArray(updates.events)
            ? updates.events.join(",")
            : updates.events;
          params.push(eventsString);
        }
        params.push(id);

        const updateQuery = `UPDATE subscribers SET ${sets.join(", ")} WHERE id = ?`;
        this.db.prepare(updateQuery).run(...params);
      }

      // Update or insert transport if provided
      if (updates.transport) {
        // Check if transport already exists
        const existingTransport = this.db
          .prepare("SELECT id FROM transports WHERE subscriber_id = ?")
          .get(id);

        if (existingTransport) {
          // Update existing transport
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
        } else {
          // Insert new transport
          const transportStmt = this.db.prepare(`
            INSERT INTO transports (subscriber_id, name, config)
            VALUES (?, ?, ?)
          `);
          transportStmt.run(
            id,
            updates.transport.name,
            JSON.stringify(updates.transport.config)
          );
        }
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
