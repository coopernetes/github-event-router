/**
 * Database abstraction layer for the GitHub Event Router
 * Provides a unified interface for different database backends
 */

export interface DatabaseTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface InsertResult {
  insertId: number | string;
  affectedRows: number;
}

export interface UpdateResult {
  affectedRows: number;
}

export interface DeleteResult {
  affectedRows: number;
}

/**
 * Base database interface that all database adapters must implement
 */
export interface IDatabase {
  /**
   * Initialize the database connection
   */
  connect(): Promise<void>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;

  /**
   * Execute a raw query with parameters
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * Execute an insert statement
   */
  insert(table: string, data: Record<string, unknown>): Promise<InsertResult>;

  /**
   * Execute an update statement
   */
  update(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<UpdateResult>;

  /**
   * Execute a delete statement
   */
  delete(table: string, where: Record<string, unknown>): Promise<DeleteResult>;

  /**
   * Find records matching criteria
   */
  find<T = unknown>(
    table: string,
    where?: Record<string, unknown>,
    options?: {
      orderBy?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<T[]>;

  /**
   * Find a single record matching criteria
   */
  findOne<T = unknown>(
    table: string,
    where: Record<string, unknown>
  ): Promise<T | null>;

  /**
   * Begin a transaction
   */
  beginTransaction(): Promise<DatabaseTransaction>;

  /**
   * Execute operations within a transaction
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

  /**
   * Check if the database is connected
   */
  isConnected(): boolean;

  /**
   * Get the database type identifier
   */
  getType(): string;
}

/**
 * Subscriber-related database operations
 */
export interface ISubscriberRepository {
  getAllSubscribers(): Promise<SubscriberRecord[]>;
  getSubscriberById(id: number): Promise<SubscriberRecord | null>;
  createSubscriber(
    name: string,
    events: string[]
  ): Promise<{ id: number; name: string; events: string[] }>;
  updateSubscriber(
    id: number,
    data: Partial<{ name: string; events: string[] }>
  ): Promise<void>;
  deleteSubscriber(id: number): Promise<void>;
}

/**
 * Transport-related database operations
 */
export interface ITransportRepository {
  getTransportBySubscriberId(subscriberId: number): Promise<TransportRecord | null>;
  createTransport(
    subscriberId: number,
    name: string,
    config: string
  ): Promise<{ id: number }>;
  updateTransport(
    subscriberId: number,
    name: string,
    config: string
  ): Promise<void>;
  deleteTransport(subscriberId: number): Promise<void>;
}

/**
 * Event-related database operations
 */
export interface IEventRepository {
  storeEvent(event: {
    githubDeliveryId: string;
    eventType: string;
    payloadHash: string;
    payloadSize: number;
    payloadData: string;
    headersData: string;
    receivedAt: Date;
    status: string;
  }): Promise<number>;

  updateEventStatus(eventId: number, status: string): Promise<void>;

  getEventStats(): Promise<{
    total: number;
    pending: number;
    failed: number;
    completed: number;
  }>;

  getPendingRetries(limit: number): Promise<RetryRecord[]>;
}

/**
 * Delivery attempt-related database operations
 */
export interface IDeliveryAttemptRepository {
  recordDeliveryAttempt(attempt: {
    eventId: number;
    subscriberId: number;
    attemptNumber: number;
    statusCode?: number;
    errorMessage?: string;
    durationMs?: number;
    nextRetryAt?: Date;
  }): Promise<void>;

  updateRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number,
    nextRetryAt: Date
  ): Promise<void>;

  clearRetrySchedule(
    eventId: number,
    subscriberId: number,
    attemptNumber: number
  ): Promise<void>;
}

// Database record types
export interface SubscriberRecord {
  id: number;
  name: string;
  events: string; // JSON or comma-separated
}

export interface TransportRecord {
  id: number;
  subscriber_id: number;
  name: string;
  config: string; // JSON
}

export interface EventRecord {
  id: number;
  github_delivery_id: string;
  event_type: string;
  payload_hash: string;
  payload_size: number;
  payload_data?: string;
  headers_data?: string;
  received_at: string;
  processed_at?: string;
  status: string;
}

export interface DeliveryAttemptRecord {
  id: number;
  event_id: number;
  subscriber_id: number;
  attempt_number: number;
  status_code?: number;
  error_message?: string;
  attempted_at: string;
  duration_ms?: number;
  next_retry_at?: string;
}

export interface RetryRecord {
  event_id: number;
  subscriber_id: number;
  next_attempt: number;
  github_delivery_id: string;
  event_type: string;
  payload_hash: string;
  payload_data: string;
  headers_data: string;
  next_retry_at: string;
}
