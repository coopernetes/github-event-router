/**
 * Azure Event Hub queue implementation
 */
import {
  EventHubProducerClient,
  EventHubConsumerClient,
  type ReceivedEventData,
  type PartitionContext,
  type Subscription,
} from "@azure/event-hubs";
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

export interface AzureEventHubConfig {
  connectionString: string;
  eventHubName: string;
  consumerGroup?: string;
}

export class AzureEventHubQueue implements IQueue {
  private producerClient: EventHubProducerClient | null = null;
  private consumerClient: EventHubConsumerClient | null = null;
  private subscription: Subscription | null = null;
  private config: AzureEventHubConfig;
  private options: QueueOptions;
  private connected = false;
  private messageBuffer: QueueMessage<unknown>[] = [];
  private processingPartitions: Set<string> = new Set();

  constructor(config: AzureEventHubConfig, options: QueueOptions = {}) {
    this.config = config;
    this.options = {
      maxRetries: options.maxRetries || 3,
      visibilityTimeout: options.visibilityTimeout || 30000,
      retentionPeriod: options.retentionPeriod || 345600000,
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.producerClient = new EventHubProducerClient(
      this.config.connectionString,
      this.config.eventHubName
    );

    this.consumerClient = new EventHubConsumerClient(
      this.config.consumerGroup || "$Default",
      this.config.connectionString,
      this.config.eventHubName
    );

    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }

    if (this.producerClient) {
      await this.producerClient.close();
      this.producerClient = null;
    }

    if (this.consumerClient) {
      await this.consumerClient.close();
      this.consumerClient = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "azure-eventhub";
  }

  private getProducerClient(): EventHubProducerClient {
    if (!this.producerClient) {
      throw new Error("Azure Event Hub not connected");
    }
    return this.producerClient;
  }

  private getConsumerClient(): EventHubConsumerClient {
    if (!this.consumerClient) {
      throw new Error("Azure Event Hub not connected");
    }
    return this.consumerClient;
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const client = this.getProducerClient();
    const messageId = randomUUID();

    const eventData = {
      body: {
        id: messageId,
        data: message,
        timestamp: new Date().toISOString(),
        attempts: 0,
        delayUntil: options?.delayMs
          ? new Date(Date.now() + options.delayMs).toISOString()
          : null,
      },
      properties: {
        messageId,
      },
    };

    const batch = await client.createBatch();
    batch.tryAdd(eventData);

    await client.sendBatch(batch);

    return messageId;
  }

  async receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]> {
    const maxMessages = options?.maxMessages || 1;

    // Return buffered messages if we have enough
    if (this.messageBuffer.length >= maxMessages) {
      return this.messageBuffer.splice(0, maxMessages) as QueueMessage<T>[];
    }

    // Start subscription if not already started
    if (!this.subscription) {
      await this.startSubscription();
    }

    // Wait for messages to arrive in buffer
    const waitTimeMs = options?.waitTimeMs || 1000;
    const startTime = Date.now();

    while (
      this.messageBuffer.length < maxMessages &&
      Date.now() - startTime < waitTimeMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const result = this.messageBuffer.splice(
      0,
      maxMessages
    ) as QueueMessage<T>[];
    return result;
  }

  private async startSubscription(): Promise<void> {
    const client = this.getConsumerClient();

    this.subscription = client.subscribe({
      processEvents: async (
        events: ReceivedEventData[],
        context: PartitionContext
      ) => {
        for (const event of events) {
          try {
            const messageData = event.body;

            // Check if message is delayed
            if (messageData.delayUntil) {
              const delayUntil = new Date(messageData.delayUntil);
              if (delayUntil > new Date()) {
                continue; // Skip delayed messages
              }
            }

            messageData.attempts = (messageData.attempts || 0) + 1;

            this.messageBuffer.push({
              id: messageData.id || randomUUID(),
              data: messageData.data,
              timestamp: new Date(messageData.timestamp),
              attempts: messageData.attempts,
              maxAttempts: this.options.maxRetries || 3,
            });
          } catch (error) {
            console.error("Error processing Event Hub message:", error);
          }
        }

        // Update checkpoint
        if (events.length > 0) {
          const lastEvent = events[events.length - 1];
          if (lastEvent) {
            await context.updateCheckpoint(lastEvent);
          }
        }
      },
      processError: async (error: Error) => {
        console.error("Error in Event Hub subscription:", error);
      },
    });
  }

  async delete(messageId: string): Promise<void> {
    // Azure Event Hub uses checkpointing, messages are automatically
    // marked as processed when checkpoint is updated
    // Remove from buffer if present
    this.messageBuffer = this.messageBuffer.filter((m) => m.id !== messageId);
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    // Azure Event Hub doesn't support changing visibility
    // We can simulate by keeping the message in buffer longer
    console.warn(
      "Azure Event Hub does not support changing message visibility"
    );
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    // Azure Event Hub doesn't provide easy access to queue depth
    // Return approximate counts based on buffer
    return {
      approximate: this.messageBuffer.length,
      inFlight: 0,
      delayed: 0,
    };
  }

  async purge(): Promise<void> {
    // Azure Event Hub doesn't support purging
    // We can only clear our local buffer
    this.messageBuffer = [];
    console.warn("Azure Event Hub does not support purging messages");
  }
}
