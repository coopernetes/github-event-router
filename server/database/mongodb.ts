/**
 * MongoDB database adapter implementation
 */
import {
  MongoClient,
  type Db,
  type Collection,
  type ObjectId,
  type ClientSession,
} from "mongodb";
import type {
  IDatabase,
  ISubscriberRepository,
  ITransportRepository,
  IEventRepository,
  IDeliveryAttemptRepository,
  QueryResult,
  InsertResult,
  UpdateResult,
  DeleteResult,
  DatabaseTransaction,
  SubscriberRecord,
  TransportRecord,
  RetryRecord,
} from "./interface.js";

export interface MongoConfig {
  url: string;
  database: string;
  maxPoolSize?: number;
}

export class MongoDBDatabase implements IDatabase {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private config: MongoConfig;
  private connected = false;

  constructor(config: MongoConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = new MongoClient(this.config.url, {
      maxPoolSize: this.config.maxPoolSize || 10,
    });

    await this.client.connect();
    this.db = this.client.db(this.config.database);
    this.connected = true;

    // Create indexes for performance
    await this.createIndexes();
  }

  private async createIndexes(): Promise<void> {
    if (!this.db) return;

    // Subscribers indexes
    await this.db.collection("subscribers").createIndex({ id: 1 }, { unique: true });

    // Transports indexes
    await this.db.collection("transports").createIndex({ subscriber_id: 1 });

    // Events indexes
    await this.db
      .collection("events")
      .createIndex({ github_delivery_id: 1 }, { unique: true });
    await this.db.collection("events").createIndex({ status: 1 });
    await this.db.collection("events").createIndex({ received_at: -1 });
    await this.db.collection("events").createIndex({ id: 1 }, { unique: true });

    // Delivery attempts indexes
    await this.db
      .collection("delivery_attempts")
      .createIndex({ event_id: 1, subscriber_id: 1 });
    await this.db
      .collection("delivery_attempts")
      .createIndex({ next_retry_at: 1 }, { sparse: true });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "mongodb";
  }

  private getDb(): Db {
    if (!this.db) {
      throw new Error("Database not connected");
    }
    return this.db;
  }

  private getCollection(name: string): Collection {
    return this.getDb().collection(name);
  }

  async query<T = unknown>(
    // MongoDB doesn't use SQL queries, this is a compatibility method
    _sql: string,
    _params: unknown[] = []
  ): Promise<QueryResult<T>> {
    throw new Error(
      "Raw SQL queries not supported in MongoDB. Use find/insert/update/delete methods."
    );
  }

  async insert(
    table: string,
    data: Record<string, unknown>
  ): Promise<InsertResult> {
    const collection = this.getCollection(table);

    // Auto-generate sequential ID if not provided
    if (!data.id) {
      const counters = this.getDb().collection<{ _id: string; seq: number }>("counters");
      const counter = await counters.findOneAndUpdate(
        { _id: table as string },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
      data.id = counter?.seq || 1;
    }

    const result = await collection.insertOne(data);

    return {
      insertId: data.id as number,
      affectedRows: result.acknowledged ? 1 : 0,
    };
  }

  async update(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<UpdateResult> {
    const collection = this.getCollection(table);
    const result = await collection.updateMany(where, { $set: data });

    return {
      affectedRows: result.modifiedCount,
    };
  }

  async delete(
    table: string,
    where: Record<string, unknown>
  ): Promise<DeleteResult> {
    const collection = this.getCollection(table);
    const result = await collection.deleteMany(where);

    return {
      affectedRows: result.deletedCount,
    };
  }

  async find<T = unknown>(
    table: string,
    where?: Record<string, unknown>,
    options?: {
      orderBy?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<T[]> {
    const collection = this.getCollection(table);
    let cursor = collection.find(where || {});

    if (options?.orderBy) {
      const parts = options.orderBy.split(" ");
      const field = parts[0];
      if (field) {
        const direction = parts[1];
        const sortOrder: Record<string, 1 | -1> = {};
        sortOrder[field] = direction === "DESC" ? -1 : 1;
        cursor = cursor.sort(sortOrder);
      }
    }

    if (options?.offset) {
      cursor = cursor.skip(options.offset);
    }

    if (options?.limit) {
      cursor = cursor.limit(options.limit);
    }

    const results = await cursor.toArray();

    // Remove MongoDB's _id field from results
    return results.map((doc) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, ...rest } = doc;
      return rest as T;
    });
  }

  async findOne<T = unknown>(
    table: string,
    where: Record<string, unknown>
  ): Promise<T | null> {
    const collection = this.getCollection(table);
    const result = await collection.findOne(where);

    if (!result) return null;

    // Remove MongoDB's _id field
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = result;
    return rest as T;
  }

  async beginTransaction(): Promise<DatabaseTransaction> {
    const client = this.client;
    if (!client) {
      throw new Error("Database not connected");
    }

    const session = client.startSession();
    session.startTransaction();

    return {
      commit: async () => {
        await session.commitTransaction();
        await session.endSession();
      },
      rollback: async () => {
        await session.abortTransaction();
        await session.endSession();
      },
    };
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    const client = this.client;
    if (!client) {
      throw new Error("Database not connected");
    }

    const session = client.startSession();

    try {
      await session.withTransaction(async () => {
        return await callback();
      });

      return await callback();
    } finally {
      await session.endSession();
    }
  }
}

export class MongoDBSubscriberRepository implements ISubscriberRepository {
  constructor(private db: IDatabase) {}

  async getAllSubscribers(): Promise<SubscriberRecord[]> {
    return await this.db.find<SubscriberRecord>("subscribers");
  }

  async getSubscriberById(id: number): Promise<SubscriberRecord | null> {
    return await this.db.findOne<SubscriberRecord>("subscribers", { id });
  }

  async createSubscriber(
    name: string,
    events: string[]
  ): Promise<{ id: number; name: string; events: string[] }> {
    const eventsJson = JSON.stringify(events);
    const result = await this.db.insert("subscribers", {
      name,
      events: eventsJson,
    });

    return {
      id: result.insertId as number,
      name,
      events,
    };
  }

  async updateSubscriber(
    id: number,
    data: Partial<{ name: string; events: string[] }>
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (data.name) {
      updateData.name = data.name;
    }

    if (data.events) {
      updateData.events = JSON.stringify(data.events);
    }

    if (Object.keys(updateData).length > 0) {
      await this.db.update("subscribers", updateData, { id });
    }
  }

  async deleteSubscriber(id: number): Promise<void> {
    await this.db.delete("subscribers", { id });
  }
}

export class MongoDBTransportRepository implements ITransportRepository {
  constructor(private db: IDatabase) {}

  async getTransportBySubscriberId(
    subscriberId: number
  ): Promise<TransportRecord | null> {
    return await this.db.findOne<TransportRecord>("transports", {
      subscriber_id: subscriberId,
    });
  }

  async createTransport(
    subscriberId: number,
    name: string,
    config: string
  ): Promise<{ id: number }> {
    const result = await this.db.insert("transports", {
      subscriber_id: subscriberId,
      name,
      config,
    });

    return {
      id: result.insertId as number,
    };
  }

  async updateTransport(
    subscriberId: number,
    name: string,
    config: string
  ): Promise<void> {
    await this.db.update(
      "transports",
      { name, config },
      { subscriber_id: subscriberId }
    );
  }

  async deleteTransport(subscriberId: number): Promise<void> {
    await this.db.delete("transports", { subscriber_id: subscriberId });
  }
}

export class MongoDBEventRepository implements IEventRepository {
  constructor(private db: IDatabase) {}

  async storeEvent(event: {
    githubDeliveryId: string;
    eventType: string;
    payloadHash: string;
    payloadSize: number;
    payloadData: string;
    headersData: string;
    receivedAt: Date;
    status: string;
  }): Promise<number> {
    const result = await this.db.insert("events", {
      github_delivery_id: event.githubDeliveryId,
      event_type: event.eventType,
      payload_hash: event.payloadHash,
      payload_size: event.payloadSize,
      payload_data: event.payloadData,
      headers_data: event.headersData,
      received_at: event.receivedAt.toISOString(),
      status: event.status,
    });

    return result.insertId as number;
  }

  async updateEventStatus(eventId: number, status: string): Promise<void> {
    await this.db.update(
      "events",
      { status, processed_at: new Date().toISOString() },
      { id: eventId }
    );
  }

  async getEventStats(): Promise<{
    total: number;
    pending: number;
    failed: number;
    completed: number;
  }> {
    const events = await this.db.find<{ status: string }>("events");

    const stats = { total: 0, pending: 0, failed: 0, completed: 0 };
    stats.total = events.length;

    for (const event of events) {
      switch (event.status) {
        case "pending":
          stats.pending++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "completed":
          stats.completed++;
          break;
      }
    }

    return stats;
  }

  async getPendingRetries(limit: number): Promise<RetryRecord[]> {
    // MongoDB doesn't support JOINs, so we need to do this in application code
    const now = new Date().toISOString();
    const attempts = await this.db.find<{
      event_id: number;
      subscriber_id: number;
      attempt_number: number;
      next_retry_at: string;
    }>(
      "delivery_attempts",
      {
        next_retry_at: { $lte: now, $ne: null },
      },
      {
        orderBy: "next_retry_at ASC",
        limit,
      }
    );

    const retries: RetryRecord[] = [];

    for (const attempt of attempts) {
      const event = await this.db.findOne<{
        id: number;
        github_delivery_id: string;
        event_type: string;
        payload_hash: string;
        payload_data: string;
        headers_data: string;
      }>("events", { id: attempt.event_id });

      if (event) {
        retries.push({
          event_id: attempt.event_id,
          subscriber_id: attempt.subscriber_id,
          next_attempt: attempt.attempt_number + 1,
          github_delivery_id: event.github_delivery_id,
          event_type: event.event_type,
          payload_hash: event.payload_hash,
          payload_data: event.payload_data,
          headers_data: event.headers_data,
          next_retry_at: attempt.next_retry_at,
        });
      }
    }

    return retries;
  }
}

export class MongoDBDeliveryAttemptRepository
  implements IDeliveryAttemptRepository
{
  constructor(private db: IDatabase) {}

  async recordDeliveryAttempt(attempt: {
    eventId: number;
    subscriberId: number;
    attemptNumber: number;
    statusCode?: number;
    errorMessage?: string;
    durationMs?: number;
    nextRetryAt?: Date;
  }): Promise<void> {
    await this.db.insert("delivery_attempts", {
      event_id: attempt.eventId,
      subscriber_id: attempt.subscriberId,
      attempt_number: attempt.attemptNumber,
      status_code: attempt.statusCode || null,
      error_message: attempt.errorMessage || null,
      duration_ms: attempt.durationMs || null,
      next_retry_at: attempt.nextRetryAt?.toISOString() || null,
      attempted_at: new Date().toISOString(),
    });
  }

  async updateRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number,
    nextRetryAt: Date
  ): Promise<void> {
    await this.db.update(
      "delivery_attempts",
      { next_retry_at: nextRetryAt.toISOString() },
      {
        event_id: eventId,
        subscriber_id: subscriberId,
        attempt_number: attemptNumber,
      }
    );
  }

  async clearRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number
  ): Promise<void> {
    await this.db.update(
      "delivery_attempts",
      { next_retry_at: null },
      {
        event_id: eventId,
        subscriber_id: subscriberId,
        attempt_number: attemptNumber,
      }
    );
  }
}
