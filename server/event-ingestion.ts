/**
 * Event Ingestion Service
 *
 * Responsible for receiving GitHub webhook events and either:
 * 1. Publishing them to an internal queue (when queue is enabled)
 * 2. Processing them directly (when queue is disabled - legacy mode)
 *
 * This decoupling enables horizontal scaling and resilience.
 */
import Database, { type Database as DatabaseType } from "better-sqlite3";
import crypto from "crypto";
import { trace } from "@opentelemetry/api";
import type { Config } from "./config.js";
import type { GitHubEvent } from "./transport.js";
import type { IQueue } from "./queue/interface.js";
import { QueueFactory, type QueueConfig } from "./queue/factory.js";
import { encryptHeaders } from "./encryption.js";
import { getSubscribers, type Subscriber } from "./subscriber.js";
import { getAppMetrics } from "./telemetry.js";

const tracer = trace.getTracer("github-event-router");

/**
 * Message format for the internal queue
 */
export interface QueuedEvent {
  eventId: number;
  githubDeliveryId: string;
  eventType: string;
  subscriberId: number;
  subscriberName: string;
  enqueuedAt: string;
}

export interface IngestionResult {
  eventId: number;
  subscribersMatched: number;
  queued: boolean;
  queueMessageIds?: string[];
}

export class EventIngestionService {
  private db: DatabaseType;
  private config: Config;
  private queue: IQueue | null = null;
  private queueEnabled: boolean;

  constructor(config: Config, dbPath = "./database.sqlite") {
    this.config = config;
    this.queueEnabled = config.internal_queue.enabled;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  /**
   * Initialize the queue connection if enabled
   */
  async initialize(): Promise<void> {
    if (!this.queueEnabled) {
      console.log(
        "Internal queue disabled - events will be processed synchronously",
      );
      return;
    }

    const queueConfig = this.buildQueueConfig();
    this.queue = await QueueFactory.create(queueConfig);
    await this.queue.connect();
    console.log(
      `Internal queue connected (${this.config.internal_queue.type})`,
    );
  }

  /**
   * Shutdown the queue connection
   */
  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      console.log("Internal queue connection closed");
    }
  }

  /**
   * Get the queue instance (for worker to consume from)
   */
  getQueue(): IQueue | null {
    return this.queue;
  }

  /**
   * Check if queue-based processing is enabled
   */
  isQueueEnabled(): boolean {
    return this.queueEnabled && this.queue !== null;
  }

  /**
   * Ingest a GitHub event - stores it and either queues or returns for direct processing
   */
  async ingestEvent(event: GitHubEvent): Promise<IngestionResult> {
    return tracer.startActiveSpan("event.ingest", async (span) => {
      const metrics = getAppMetrics();

      span.setAttribute("github.event.type", event.type);
      span.setAttribute("github.delivery.id", event.id);
      span.setAttribute("queue.enabled", this.queueEnabled);

      // Store the event in database first (for durability)
      const eventId = await this.storeEvent(event);
      span.setAttribute("event.id", eventId);

      // Find matching subscribers
      const subscribers = getSubscribers().filter((subscriber) =>
        subscriber.events.includes(event.type),
      );

      span.setAttribute("subscribers.matched", subscribers.length);

      if (subscribers.length === 0) {
        await this.updateEventStatus(eventId, "completed");
        span.end();
        return {
          eventId,
          subscribersMatched: 0,
          queued: false,
        };
      }

      // If queue is enabled, publish to queue
      if (this.isQueueEnabled()) {
        const messageIds = await this.enqueueForSubscribers(
          eventId,
          event,
          subscribers,
        );

        metrics.eventsQueued?.add(subscribers.length, {
          event_type: event.type,
        });

        span.setAttribute("queue.messages", messageIds.length);
        span.end();

        return {
          eventId,
          subscribersMatched: subscribers.length,
          queued: true,
          queueMessageIds: messageIds,
        };
      }

      // Queue not enabled - mark as pending for direct processing
      await this.updateEventStatus(eventId, "pending");
      span.end();

      return {
        eventId,
        subscribersMatched: subscribers.length,
        queued: false,
      };
    });
  }

  /**
   * Enqueue event for each matching subscriber
   */
  private async enqueueForSubscribers(
    eventId: number,
    event: GitHubEvent,
    subscribers: Subscriber[],
  ): Promise<string[]> {
    const messageIds: string[] = [];

    for (const subscriber of subscribers) {
      const queuedEvent: QueuedEvent = {
        eventId,
        githubDeliveryId: event.id,
        eventType: event.type,
        subscriberId: subscriber.id,
        subscriberName: subscriber.name,
        enqueuedAt: new Date().toISOString(),
      };

      const messageId = await this.queue!.send(queuedEvent);
      messageIds.push(messageId);
    }

    // Mark event as queued
    await this.updateEventStatus(eventId, "processing");

    return messageIds;
  }

  /**
   * Store event in database
   */
  private async storeEvent(event: GitHubEvent): Promise<number> {
    const payloadString = JSON.stringify(event.payload);
    const payloadHash = crypto
      .createHash("sha256")
      .update(payloadString)
      .digest("hex");

    // Encrypt headers before storing
    const encryptedHeaders = encryptHeaders(event.headers);

    const stmt = this.db.prepare(`
      INSERT INTO events (
        github_delivery_id,
        event_type,
        payload_hash,
        payload_size,
        payload_data,
        headers_data,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = stmt.run(
      event.id,
      event.type,
      payloadHash,
      payloadString.length,
      payloadString,
      encryptedHeaders,
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update event status
   */
  private async updateEventStatus(
    eventId: number,
    status: "pending" | "processing" | "completed" | "failed" | "dead_letter",
  ): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE events 
      SET status = ?, processed_at = CASE WHEN ? IN ('completed', 'failed', 'dead_letter') THEN datetime('now') ELSE processed_at END
      WHERE id = ?
    `);
    stmt.run(status, status, eventId);
  }

  /**
   * Build queue configuration from app config
   */
  private buildQueueConfig(): QueueConfig {
    const queueConfig = this.config.internal_queue;

    const baseConfig: QueueConfig = {
      type: queueConfig.type,
      options: {
        visibilityTimeout: queueConfig.visibility_timeout_ms,
        maxRetries: this.config.event_processing.retry.max_attempts,
      },
    };

    // Add type-specific configuration
    switch (queueConfig.type) {
      case "redis":
        if (queueConfig.redis) {
          baseConfig.redis = {
            url: queueConfig.redis.url,
            queueName: queueConfig.redis.stream_name || "github-events",
            consumerGroup: queueConfig.redis.consumer_group || "event-workers",
            ...(queueConfig.redis.password && {
              password: queueConfig.redis.password,
            }),
          };
        }
        break;

      case "kafka":
        if (queueConfig.kafka) {
          baseConfig.kafka = {
            brokers: queueConfig.kafka.brokers,
            topic: queueConfig.kafka.topic,
            clientId: queueConfig.kafka.client_id || "github-event-router",
            groupId: queueConfig.kafka.group_id || "event-workers",
          };
        }
        break;

      case "amqp":
        if (queueConfig.amqp) {
          baseConfig.amqp = {
            url: queueConfig.amqp.url,
            queueName: queueConfig.amqp.queue_name || "github-events",
            exchange: queueConfig.amqp.exchange || "github-events",
          };
        }
        break;

      case "sqs":
        if (queueConfig.sqs) {
          baseConfig.sqs = {
            region: queueConfig.sqs.region,
            queueUrl: queueConfig.sqs.queue_url,
            ...(queueConfig.sqs.access_key_id && {
              accessKeyId: queueConfig.sqs.access_key_id,
            }),
            ...(queueConfig.sqs.secret_access_key && {
              secretAccessKey: queueConfig.sqs.secret_access_key,
            }),
          };
        }
        break;

      case "azure-eventhub":
        if (queueConfig.azure_eventhub) {
          baseConfig.azureEventHub = {
            connectionString: queueConfig.azure_eventhub.connection_string,
            eventHubName: queueConfig.azure_eventhub.event_hub_name,
            consumerGroup:
              queueConfig.azure_eventhub.consumer_group || "$Default",
          };
        }
        break;

      case "memory":
      default:
        // No additional config needed for memory queue
        break;
    }

    return baseConfig;
  }
}
