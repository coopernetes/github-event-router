/**
 * PostgreSQL database adapter implementation
 */
import { Pool, type PoolClient, type QueryResult as PgQueryResult } from "pg";
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

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class PostgreSQLDatabase implements IDatabase {
  private pool: Pool | null = null;
  private config: PostgresConfig;
  private connected = false;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      max: this.config.max || 20,
      idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();

    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "postgres";
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error("Database not connected");
    }
    return this.pool;
  }

  async query<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    const pool = this.getPool();
    const result: PgQueryResult<T> = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  }

  async insert(
    table: string,
    data: Record<string, unknown>
  ): Promise<InsertResult> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await this.query<{ id: number }>(sql, values);

    return {
      insertId: result.rows[0]?.id || 0,
      affectedRows: result.rowCount,
    };
  }

  async update(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<UpdateResult> {
    const dataKeys = Object.keys(data);
    const dataValues = Object.values(data);
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);

    const setClause = dataKeys
      .map((key, i) => `${key} = $${i + 1}`)
      .join(", ");
    const whereClause = whereKeys
      .map((key, i) => `${key} = $${dataKeys.length + i + 1}`)
      .join(" AND ");

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const result = await this.query(sql, [...dataValues, ...whereValues]);

    return {
      affectedRows: result.rowCount,
    };
  }

  async delete(
    table: string,
    where: Record<string, unknown>
  ): Promise<DeleteResult> {
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);

    const whereClause = whereKeys
      .map((key, i) => `${key} = $${i + 1}`)
      .join(" AND ");

    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    const result = await this.query(sql, whereValues);

    return {
      affectedRows: result.rowCount,
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
    let sql = `SELECT * FROM ${table}`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (where && Object.keys(where).length > 0) {
      const whereClause = Object.keys(where)
        .map((key) => `${key} = $${paramIndex++}`)
        .join(" AND ");
      sql += ` WHERE ${whereClause}`;
      params.push(...Object.values(where));
    }

    if (options?.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
    }

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }

    if (options?.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }

    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  async findOne<T = unknown>(
    table: string,
    where: Record<string, unknown>
  ): Promise<T | null> {
    const results = await this.find<T>(table, where, { limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  async beginTransaction(): Promise<DatabaseTransaction> {
    const pool = this.getPool();
    const client = await pool.connect();
    await client.query("BEGIN");

    return {
      commit: async () => {
        try {
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      },
      rollback: async () => {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      },
    };
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgreSQLSubscriberRepository implements ISubscriberRepository {
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

export class PostgreSQLTransportRepository implements ITransportRepository {
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

export class PostgreSQLEventRepository implements IEventRepository {
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
      `UPDATE events SET status = $1, processed_at = NOW() WHERE id = $2`,
      [status, eventId]
    );
  }

  async getEventStats(): Promise<{
    total: number;
    pending: number;
    failed: number;
    completed: number;
  }> {
    const result = await this.db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count FROM events GROUP BY status`
    );

    const stats = { total: 0, pending: 0, failed: 0, completed: 0 };

    for (const row of result.rows) {
      const count = parseInt(row.count);
      stats.total += count;
      switch (row.status) {
        case "pending":
          stats.pending = count;
          break;
        case "failed":
          stats.failed = count;
          break;
        case "completed":
          stats.completed = count;
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
      AND da.next_retry_at <= NOW()
      ORDER BY da.next_retry_at
      LIMIT $1
    `,
      [limit]
    );

    return result.rows;
  }
}

export class PostgreSQLDeliveryAttemptRepository
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
       SET next_retry_at = $1
       WHERE event_id = $2 AND subscriber_id = $3 AND attempt_number = $4`,
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
       WHERE event_id = $1 AND subscriber_id = $2 AND attempt_number = $3`,
      [eventId, subscriberId, attemptNumber]
    );
  }
}
