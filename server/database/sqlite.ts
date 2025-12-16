/**
 * SQLite database adapter implementation
 */
import Database, { type Database as DatabaseType } from "better-sqlite3";
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

export class SQLiteDatabase implements IDatabase {
  private db: DatabaseType | null = null;
  private dbPath: string;
  private connected = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "sqlite";
  }

  private getDb(): DatabaseType {
    if (!this.db) {
      throw new Error("Database not connected");
    }
    return this.db;
  }

  async query<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as T[];
    return {
      rows,
      rowCount: rows.length,
    };
  }

  async insert(
    table: string,
    data: Record<string, unknown>
  ): Promise<InsertResult> {
    const db = this.getDb();
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => "?").join(", ");

    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
    const stmt = db.prepare(sql);
    const result = stmt.run(...values);

    return {
      insertId: result.lastInsertRowid as number,
      affectedRows: result.changes,
    };
  }

  async update(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<UpdateResult> {
    const db = this.getDb();
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ");
    const whereClause = Object.keys(where)
      .map((key) => `${key} = ?`)
      .join(" AND ");

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const stmt = db.prepare(sql);
    const result = stmt.run(...Object.values(data), ...Object.values(where));

    return {
      affectedRows: result.changes,
    };
  }

  async delete(
    table: string,
    where: Record<string, unknown>
  ): Promise<DeleteResult> {
    const db = this.getDb();
    const whereClause = Object.keys(where)
      .map((key) => `${key} = ?`)
      .join(" AND ");

    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    const stmt = db.prepare(sql);
    const result = stmt.run(...Object.values(where));

    return {
      affectedRows: result.changes,
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
    const db = this.getDb();
    let sql = `SELECT * FROM ${table}`;
    const params: unknown[] = [];

    if (where && Object.keys(where).length > 0) {
      const whereClause = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(" AND ");
      sql += ` WHERE ${whereClause}`;
      params.push(...Object.values(where));
    }

    if (options?.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
    }

    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options?.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }

    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async findOne<T = unknown>(
    table: string,
    where: Record<string, unknown>
  ): Promise<T | null> {
    const results = await this.find<T>(table, where, { limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  async beginTransaction(): Promise<DatabaseTransaction> {
    const db = this.getDb();
    db.prepare("BEGIN").run();

    return {
      commit: async () => {
        db.prepare("COMMIT").run();
      },
      rollback: async () => {
        db.prepare("ROLLBACK").run();
      },
    };
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    const db = this.getDb();
    return db.transaction(callback)();
  }
}

export class SQLiteSubscriberRepository implements ISubscriberRepository {
  constructor(private db: IDatabase) {}

  async getAllSubscribers(): Promise<SubscriberRecord[]> {
    const result = await this.db.query<SubscriberRecord>(
      "SELECT id, name, events FROM subscribers"
    );
    return result.rows;
  }

  async getSubscriberById(id: number): Promise<SubscriberRecord | null> {
    return await this.db.findOne<SubscriberRecord>("subscribers", { id });
  }

  async createSubscriber(
    name: string,
    events: string[]
  ): Promise<{ id: number; name: string; events: string[] }> {
    const eventsString = events.join(",");
    const result = await this.db.insert("subscribers", {
      name,
      events: eventsString,
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
      updateData.events = data.events.join(",");
    }

    if (Object.keys(updateData).length > 0) {
      await this.db.update("subscribers", updateData, { id });
    }
  }

  async deleteSubscriber(id: number): Promise<void> {
    await this.db.delete("subscribers", { id });
  }
}

export class SQLiteTransportRepository implements ITransportRepository {
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

export class SQLiteEventRepository implements IEventRepository {
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
    await this.db.query(
      `UPDATE events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, eventId]
    );
  }

  async getEventStats(): Promise<{
    total: number;
    pending: number;
    failed: number;
    completed: number;
  }> {
    const result = await this.db.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM events GROUP BY status`
    );

    const stats = { total: 0, pending: 0, failed: 0, completed: 0 };

    for (const row of result.rows) {
      stats.total += row.count;
      switch (row.status) {
        case "pending":
          stats.pending = row.count;
          break;
        case "failed":
          stats.failed = row.count;
          break;
        case "completed":
          stats.completed = row.count;
          break;
      }
    }

    return stats;
  }

  async getPendingRetries(limit: number): Promise<RetryRecord[]> {
    const result = await this.db.query<RetryRecord>(
      `
      SELECT 
        da.event_id,
        da.subscriber_id,
        da.attempt_number + 1 as next_attempt,
        e.github_delivery_id,
        e.event_type,
        e.payload_hash,
        e.payload_data,
        e.headers_data,
        da.next_retry_at
      FROM delivery_attempts da
      JOIN events e ON da.event_id = e.id
      WHERE da.next_retry_at IS NOT NULL 
      AND datetime(da.next_retry_at) <= datetime('now')
      ORDER BY da.next_retry_at
      LIMIT ?
    `,
      [limit]
    );

    return result.rows;
  }
}

export class SQLiteDeliveryAttemptRepository
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
    });
  }

  async updateRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number,
    nextRetryAt: Date
  ): Promise<void> {
    await this.db.query(
      `UPDATE delivery_attempts 
       SET next_retry_at = ?
       WHERE event_id = ? AND subscriber_id = ? AND attempt_number = ?`,
      [nextRetryAt.toISOString(), eventId, subscriberId, attemptNumber]
    );
  }

  async clearRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number
  ): Promise<void> {
    await this.db.query(
      `UPDATE delivery_attempts 
       SET next_retry_at = NULL
       WHERE event_id = ? AND subscriber_id = ? AND attempt_number = ?`,
      [eventId, subscriberId, attemptNumber]
    );
  }
}
