import Database, { type Database as DatabaseType } from "better-sqlite3";
import { type Config } from "./config.js";
import { type GitHubEvent, TransportFactory } from "./transport.js";
import { RetryHandler, type RetryContext } from "./retry.js";
import { getSubscribers, type Subscriber } from "./subscriber.js";
import { encryptHeaders, decryptHeaders } from "./encryption.js";
import crypto from "crypto";

export interface EventProcessingResult {
  eventId: string;
  subscriberId: number;
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
  nextRetryAt?: Date;
  durationMs: number;
}

export interface StoredEvent {
  id: number;
  github_delivery_id: string;
  event_type: string;
  payload_hash: string;
  payload_size: number;
  received_at: string;
  processed_at?: string;
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
}

export class EventProcessor {
  private db: DatabaseType;
  private config: Config;
  private retryHandler: RetryHandler;
  private transportFactory: TransportFactory;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(config: Config, dbPath = "./database.sqlite") {
    this.config = config;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.retryHandler = new RetryHandler(config.event_processing.retry);
    this.transportFactory = new TransportFactory();
  }

  async processEvent(event: GitHubEvent): Promise<EventProcessingResult[]> {
    // Store the event first
    const storedEventId = await this.storeEvent(event);

    // Get matching subscribers
    const subscribers = getSubscribers().filter((subscriber) =>
      subscriber.events.includes(event.type)
    );

    if (subscribers.length === 0) {
      await this.updateEventStatus(storedEventId, "completed");
      return [];
    }

    // Mark event as processing
    await this.updateEventStatus(storedEventId, "processing");

    // Process deliveries to subscribers
    const results: EventProcessingResult[] = [];
    const deliveryPromises = subscribers.map(async (subscriber) => {
      const result = await this.deliverToSubscriber(
        event,
        subscriber,
        storedEventId
      );
      results.push(result);
      return result;
    });

    await Promise.allSettled(deliveryPromises);

    // Update overall event status
    const allSuccessful = results.every((r) => r.success);
    const hasRetries = results.some((r) => r.nextRetryAt);

    if (allSuccessful) {
      await this.updateEventStatus(storedEventId, "completed");
    } else if (hasRetries) {
      await this.updateEventStatus(storedEventId, "pending"); // Will be retried
    } else {
      await this.updateEventStatus(storedEventId, "failed");
    }

    return results;
  }

  private async deliverToSubscriber(
    event: GitHubEvent,
    subscriber: Subscriber,
    eventId: number
  ): Promise<EventProcessingResult> {
    if (!subscriber.transport) {
      const error = "Subscriber has no transport configuration";
      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        1,
        undefined,
        error,
        0
      );
      return {
        eventId: event.id,
        subscriberId: subscriber.id,
        success: false,
        error,
        attempts: 1,
        durationMs: 0,
      };
    }

    const transport = TransportFactory.create(
      subscriber.transport.name,
      this.config
    );
    const startTime = Date.now();

    try {
      const result = await transport.deliver(
        event,
        subscriber.transport.config
      );

      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        1,
        result.statusCode,
        result.error,
        result.durationMs
      );

      if (result.success) {
        return {
          eventId: event.id,
          subscriberId: subscriber.id,
          success: true,
          statusCode: result.statusCode ?? 200,
          attempts: 1,
          durationMs: result.durationMs,
        };
      }

      // Check if we should retry
      const retryContext: RetryContext = {
        subscriberId: subscriber.id,
        eventId: event.id,
        eventType: event.type,
        attempt: 1,
      };

      if (this.retryHandler.shouldRetry(result, retryContext)) {
        const nextRetryAt = this.retryHandler.getNextRetryTime(2);

        await this.scheduleRetry(eventId, subscriber.id, 2, nextRetryAt);

        return {
          eventId: event.id,
          subscriberId: subscriber.id,
          success: false,
          statusCode: result.statusCode ?? 0,
          error: result.error ?? "Delivery failed",
          attempts: 1,
          nextRetryAt,
          durationMs: result.durationMs,
        };
      }

      return {
        eventId: event.id,
        subscriberId: subscriber.id,
        success: false,
        statusCode: result.statusCode ?? 0,
        error: result.error ?? "Delivery failed",
        attempts: 1,
        durationMs: result.durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        1,
        undefined,
        errorMessage,
        durationMs
      );

      return {
        eventId: event.id,
        subscriberId: subscriber.id,
        success: false,
        error: errorMessage,
        attempts: 1,
        durationMs,
      };
    }
  }

  private async storeEvent(event: GitHubEvent): Promise<number> {
    const payloadString = JSON.stringify(event.payload);
    // Encrypt headers to protect sensitive information like webhook signatures
    const encryptedHeaders = encryptHeaders(event.headers);
    const payloadHash = crypto
      .createHash("sha256")
      .update(payloadString)
      .digest("hex");

    const stmt = this.db.prepare(`
      INSERT INTO events (github_delivery_id, event_type, payload_hash, payload_size, payload_data, headers_data, received_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      event.id,
      event.type,
      payloadHash,
      Buffer.from(payloadString).length,
      payloadString,
      encryptedHeaders,
      event.receivedAt.toISOString(),
      "pending"
    );

    return result.lastInsertRowid as number;
  }

  private async updateEventStatus(
    eventId: number,
    status: StoredEvent["status"]
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE events 
      SET status = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, eventId);
  }

  private async recordDeliveryAttempt(
    eventId: number,
    subscriberId: number,
    attempt: number,
    statusCode?: number,
    error?: string,
    durationMs?: number,
    nextRetryAt?: Date
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO delivery_attempts 
      (event_id, subscriber_id, attempt_number, status_code, error_message, duration_ms, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      eventId,
      subscriberId,
      attempt,
      statusCode || null,
      error || null,
      durationMs || null,
      nextRetryAt?.toISOString() || null
    );
  }

  private async scheduleRetry(
    eventId: number,
    subscriberId: number,
    nextAttempt: number,
    retryAt: Date
  ): Promise<void> {
    // Update the existing delivery attempt with retry time
    const stmt = this.db.prepare(`
      UPDATE delivery_attempts 
      SET next_retry_at = ?
      WHERE event_id = ? AND subscriber_id = ? AND attempt_number = ?
    `);
    stmt.run(retryAt.toISOString(), eventId, subscriberId, nextAttempt - 1);
  }

  startRetryProcessor(): void {
    if (this.processingInterval) {
      return;
    }

    console.log(
      `Starting retry processor with ${this.config.event_processing.queue.processing_interval_ms}ms interval`
    );

    this.processingInterval = setInterval(
      () => this.processRetries(),
      this.config.event_processing.queue.processing_interval_ms
    );
  }

  stopRetryProcessor(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  private async processRetries(): Promise<void> {
    try {
      const stmt = this.db.prepare(`
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
      `);

      const retries = stmt.all(
        this.config.event_processing.queue.batch_size
      ) as Array<{
        event_id: number;
        subscriber_id: number;
        next_attempt: number;
        github_delivery_id: string;
        event_type: string;
        payload_hash: string;
        payload_data: string;
        headers_data: string;
        next_retry_at: string;
      }>;

      if (retries.length > 0) {
        console.log(`Processing ${retries.length} retries`);
      }

      for (const retry of retries) {
        await this.processRetry(retry);
      }
    } catch (error) {
      console.error("Error processing retries:", error);
    }
  }
  private async processRetry(retry: {
    event_id: number;
    subscriber_id: number;
    next_attempt: number;
    github_delivery_id: string;
    event_type: string;
    payload_data: string;
    headers_data: string;
  }): Promise<void> {
    console.log(
      `Processing retry for event ${retry.github_delivery_id}, attempt ${retry.next_attempt}`
    );

    // Clear the retry schedule first
    const clearStmt = this.db.prepare(`
      UPDATE delivery_attempts 
      SET next_retry_at = NULL
      WHERE event_id = ? AND subscriber_id = ? AND attempt_number = ?
    `);
    clearStmt.run(retry.event_id, retry.subscriber_id, retry.next_attempt - 1);

    // Get the subscriber details
    const subscribers = getSubscribers();
    const subscriber = subscribers.find((s) => s.id === retry.subscriber_id);

    if (!subscriber || !subscriber.transport) {
      console.error(
        `Subscriber ${retry.subscriber_id} not found or has no transport for retry`
      );
      return;
    }

    // Parse the original payload and decrypt headers (contains sensitive webhook signatures)
    let originalPayload: Record<string, unknown>;
    let originalHeaders: Record<string, string>;

    try {
      originalPayload = JSON.parse(retry.payload_data);
      originalHeaders = decryptHeaders(retry.headers_data);
    } catch (error) {
      console.error(
        `Failed to parse stored payload/headers for event ${retry.github_delivery_id}:`,
        error
      );
      return;
    } // Create the retry event with original payload and headers
    const retryEvent: GitHubEvent = {
      id: retry.github_delivery_id,
      type: retry.event_type,
      payload: originalPayload,
      headers: originalHeaders,
      receivedAt: new Date(),
    };

    // Attempt delivery
    const transport = TransportFactory.create(
      subscriber.transport.name,
      this.config
    );
    const startTime = Date.now();

    try {
      const result = await transport.deliver(
        retryEvent,
        subscriber.transport.config
      );

      // Record this retry attempt
      await this.recordDeliveryAttempt(
        retry.event_id,
        retry.subscriber_id,
        retry.next_attempt,
        result.statusCode,
        result.error,
        result.durationMs
      );

      if (result.success) {
        console.log(
          `Retry successful for event ${retry.github_delivery_id}, attempt ${retry.next_attempt}`
        );
        // Mark event as completed if this was the last failing subscriber
        // (simplified - in reality you'd check if all subscribers succeeded)
        await this.updateEventStatus(retry.event_id, "completed");
      } else {
        // Check if we should retry again
        const retryContext: RetryContext = {
          subscriberId: subscriber.id,
          eventId: retry.github_delivery_id,
          eventType: retry.event_type,
          attempt: retry.next_attempt, // This is the attempt we just made
        };

        if (this.retryHandler.shouldRetry(result, retryContext)) {
          const nextRetryAt = this.retryHandler.getNextRetryTime(
            retry.next_attempt + 1
          );
          await this.scheduleRetry(
            retry.event_id,
            subscriber.id,
            retry.next_attempt + 1,
            nextRetryAt
          );
          console.log(
            `Retry failed, scheduling next retry for ${nextRetryAt} (attempt ${retry.next_attempt + 1})`
          );
        } else {
          console.log(
            `Max retries exceeded for event ${retry.github_delivery_id}, marking as failed`
          );
          await this.updateEventStatus(retry.event_id, "failed");
        }
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await this.recordDeliveryAttempt(
        retry.event_id,
        retry.subscriber_id,
        retry.next_attempt,
        undefined,
        errorMessage,
        durationMs
      );

      console.error(
        `Retry attempt ${retry.next_attempt} failed:`,
        errorMessage
      );
    }
  }

  getEventStats(): {
    total: number;
    pending: number;
    failed: number;
    completed: number;
  } {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM events
      GROUP BY status
    `);

    const results = stmt.all() as Array<{ status: string; count: number }>;
    const stats = { total: 0, pending: 0, failed: 0, completed: 0 };

    for (const result of results) {
      stats.total += result.count;
      switch (result.status) {
        case "pending":
          stats.pending = result.count;
          break;
        case "failed":
          stats.failed = result.count;
          break;
        case "completed":
          stats.completed = result.count;
          break;
      }
    }

    return stats;
  }

  close(): void {
    this.stopRetryProcessor();
    this.db.close();
  }
}
