/**
 * Event Worker Service
 *
 * Responsible for consuming events from the internal queue and processing them.
 * This can run alongside the receiver in the same process, or be deployed separately.
 *
 * Features:
 * - Consumes from internal queue
 * - Delivers to subscribers via transport layer
 * - Handles retries and dead-letter queue
 * - Multiple consumers supported for horizontal scaling
 */
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Config } from "./config.js";
import type { IQueue, QueueMessage } from "./queue/interface.js";
import type { QueuedEvent } from "./event-ingestion.js";
import type { GitHubEvent, DeliveryResult } from "./transport.js";
import { TransportFactory } from "./transports/factory.js";
import { RetryHandler, type RetryContext } from "./retry.js";
import { getSubscribers, type Subscriber } from "./subscriber.js";
import { decryptHeaders } from "./encryption.js";
import { getAppMetrics } from "./telemetry.js";

const tracer = trace.getTracer("github-event-router");

export interface WorkerStats {
  processed: number;
  successful: number;
  failed: number;
  retried: number;
  deadLettered: number;
}

export class EventWorkerService {
  private db: DatabaseType;
  private config: Config;
  private queue: IQueue;
  private retryHandler: RetryHandler;
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private stats: WorkerStats = {
    processed: 0,
    successful: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
  };

  constructor(config: Config, queue: IQueue, dbPath = "./database.sqlite") {
    this.config = config;
    this.queue = queue;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.retryHandler = new RetryHandler(config.event_processing.retry);
  }

  /**
   * Start the worker - begins polling the queue for messages
   */
  start(): void {
    if (this.running) {
      console.log("Worker already running");
      return;
    }

    this.running = true;
    const pollIntervalMs = this.config.internal_queue.poll_interval_ms;

    console.log(`Starting event worker (poll interval: ${pollIntervalMs}ms)`);

    // Start polling
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), pollIntervalMs);
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    console.log("Stopping event worker...");
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log("Event worker stopped", this.stats);
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats };
  }

  /**
   * Poll the queue for messages and process them
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const messages = await this.queue.receive<QueuedEvent>({
        maxMessages: this.config.event_processing.queue.batch_size,
        waitTimeMs: 1000,
      });

      for (const message of messages) {
        await this.processMessage(message);
      }
    } catch (error) {
      console.error("Error polling queue:", error);
    }
  }

  /**
   * Process a single queued message
   */
  private async processMessage(
    message: QueueMessage<QueuedEvent>,
  ): Promise<void> {
    const queuedEvent = message.data;

    return tracer.startActiveSpan("worker.process_message", async (span) => {
      const metrics = getAppMetrics();

      span.setAttribute("event.id", queuedEvent.eventId);
      span.setAttribute("event.type", queuedEvent.eventType);
      span.setAttribute("subscriber.id", queuedEvent.subscriberId);
      span.setAttribute("subscriber.name", queuedEvent.subscriberName);
      span.setAttribute("message.attempt", message.attempts);

      this.stats.processed++;

      try {
        // Load event data from database
        const eventData = await this.loadEventData(queuedEvent.eventId);
        if (!eventData) {
          console.error(`Event ${queuedEvent.eventId} not found in database`);
          await this.queue.delete(message.id);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Event not found",
          });
          span.end();
          return;
        }

        // Load subscriber
        const subscriber = getSubscribers().find(
          (s) => s.id === queuedEvent.subscriberId,
        );
        if (!subscriber) {
          console.error(`Subscriber ${queuedEvent.subscriberId} not found`);
          await this.queue.delete(message.id);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Subscriber not found",
          });
          span.end();
          return;
        }

        // Reconstruct GitHub event
        const githubEvent: GitHubEvent = {
          id: queuedEvent.githubDeliveryId,
          type: queuedEvent.eventType,
          payload: JSON.parse(eventData.payload_data),
          headers: decryptHeaders(eventData.headers_data),
          receivedAt: new Date(eventData.received_at),
        };

        // Deliver to subscriber
        const result = await this.deliverToSubscriber(
          githubEvent,
          subscriber,
          queuedEvent.eventId,
          message.attempts,
        );

        if (result.success) {
          // Success - acknowledge the message
          await this.queue.delete(message.id);
          this.stats.successful++;

          metrics.deliverySuccess.add(1, {
            subscriber_id: subscriber.id.toString(),
            transport: subscriber.transport?.name || "unknown",
          });

          // Check if all deliveries for this event are complete
          await this.checkEventCompletion(queuedEvent.eventId);

          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          // Failed - check if we should retry
          const retryContext: RetryContext = {
            subscriberId: subscriber.id,
            eventId: queuedEvent.githubDeliveryId,
            eventType: queuedEvent.eventType,
            attempt: message.attempts,
          };

          const deliveryResult: DeliveryResult = {
            success: false,
            statusCode: result.statusCode ?? 0,
            error: result.error ?? "",
            durationMs: result.durationMs,
            attempt: message.attempts,
          };

          if (this.retryHandler.shouldRetry(deliveryResult, retryContext)) {
            // Schedule retry - change visibility timeout
            const delay = this.retryHandler.calculateDelay(
              message.attempts + 1,
            );
            await this.queue.changeVisibility(message.id, delay);
            this.stats.retried++;

            span.setAttribute("retry.scheduled", true);
            span.setAttribute("retry.delay_ms", delay);
          } else {
            // Max retries exceeded - dead letter
            await this.queue.delete(message.id);
            await this.recordDeadLetter(
              queuedEvent,
              result.error || "Max retries exceeded",
            );
            this.stats.deadLettered++;

            metrics.deliveryFailure.add(1, {
              subscriber_id: subscriber.id.toString(),
              transport: subscriber.transport?.name || "unknown",
              error: "dead_letter",
            });

            span.setAttribute("dead_letter", true);
          }

          this.stats.failed++;
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error ?? "",
          });
        }
      } catch (error) {
        console.error("Error processing message:", error);
        this.stats.failed++;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }

      span.end();
    });
  }

  /**
   * Deliver event to a subscriber
   */
  private async deliverToSubscriber(
    event: GitHubEvent,
    subscriber: Subscriber,
    eventId: number,
    attempt: number,
  ): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
    durationMs: number;
    attempt: number;
  }> {
    const startTime = Date.now();

    if (!subscriber.transport) {
      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        attempt,
        undefined,
        "No transport configured",
        0,
      );
      return {
        success: false,
        error: "No transport configured",
        durationMs: 0,
        attempt,
      };
    }

    try {
      const transport = TransportFactory.create(
        subscriber.transport.name,
        this.config,
      );
      const result = await transport.deliver(
        event,
        subscriber.transport.config,
      );

      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        attempt,
        result.statusCode,
        result.error,
        result.durationMs,
      );

      return {
        success: result.success,
        statusCode: result.statusCode ?? 0,
        error: result.error ?? "",
        durationMs: result.durationMs,
        attempt,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      await this.recordDeliveryAttempt(
        eventId,
        subscriber.id,
        attempt,
        undefined,
        errorMessage,
        durationMs,
      );

      return { success: false, error: errorMessage, durationMs, attempt };
    }
  }

  /**
   * Load event data from database
   */
  private async loadEventData(eventId: number): Promise<{
    payload_data: string;
    headers_data: string;
    received_at: string;
  } | null> {
    const stmt = this.db.prepare(`
      SELECT payload_data, headers_data, received_at
      FROM events
      WHERE id = ?
    `);
    return stmt.get(eventId) as {
      payload_data: string;
      headers_data: string;
      received_at: string;
    } | null;
  }

  /**
   * Record delivery attempt in database
   */
  private async recordDeliveryAttempt(
    eventId: number,
    subscriberId: number,
    attempt: number,
    statusCode: number | undefined,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO delivery_attempts (
        event_id,
        subscriber_id,
        attempt_number,
        status_code,
        error_message,
        duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(eventId, subscriberId, attempt, statusCode, error, durationMs);
  }

  /**
   * Record dead-lettered event
   */
  private async recordDeadLetter(
    queuedEvent: QueuedEvent,
    error: string,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE events SET status = 'dead_letter', processed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(queuedEvent.eventId);

    console.error(
      `Event ${queuedEvent.eventId} dead-lettered for subscriber ${queuedEvent.subscriberName}: ${error}`,
    );
  }

  /**
   * Check if all deliveries for an event are complete
   */
  private async checkEventCompletion(eventId: number): Promise<void> {
    // Count pending deliveries for this event
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as pending
      FROM delivery_attempts
      WHERE event_id = ?
      AND status_code IS NULL
    `);
    const result = stmt.get(eventId) as { pending: number };

    if (result.pending === 0) {
      // All deliveries complete - update event status
      const updateStmt = this.db.prepare(`
        UPDATE events 
        SET status = 'completed', processed_at = datetime('now')
        WHERE id = ? AND status != 'dead_letter'
      `);
      updateStmt.run(eventId);
    }
  }
}
