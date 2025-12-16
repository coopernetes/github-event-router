/**
 * Kafka queue implementation
 */
import { Kafka, type Producer, type Consumer, type EachMessagePayload } from "kafkajs";
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

export interface KafkaQueueConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  groupId?: string;
  ssl?: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
  partitions?: number;
  replicationFactor?: number;
}

export class KafkaQueue implements IQueue {
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private config: KafkaQueueConfig;
  private options: QueueOptions;
  private connected = false;
  private messageBuffer: QueueMessage<unknown>[] = [];
  private isConsuming = false;

  constructor(config: KafkaQueueConfig, options: QueueOptions = {}) {
    this.config = {
      ...config,
      clientId: config.clientId || "github-event-router",
      groupId: config.groupId || "github-event-router-group",
      partitions: config.partitions || 3,
      replicationFactor: config.replicationFactor || 1,
    };
    this.options = {
      maxRetries: options.maxRetries || 3,
      visibilityTimeout: options.visibilityTimeout || 30000,
      retentionPeriod: options.retentionPeriod || 604800000, // 7 days
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const kafkaConfig: {
      clientId: string;
      brokers: string[];
      ssl?: boolean;
      sasl?: {
        mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
        username: string;
        password: string;
      };
    } = {
      clientId: this.config.clientId!,
      brokers: this.config.brokers,
    };

    if (this.config.ssl) {
      kafkaConfig.ssl = this.config.ssl;
    }

    if (this.config.sasl) {
      kafkaConfig.sasl = this.config.sasl;
    }

    this.kafka = new Kafka(kafkaConfig);

    // Create producer
    this.producer = this.kafka.producer();
    await this.producer.connect();

    // Create consumer
    this.consumer = this.kafka.consumer({
      groupId: this.config.groupId!,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    await this.consumer.connect();

    // Create topic if it doesn't exist
    const admin = this.kafka.admin();
    await admin.connect();

    try {
      await admin.createTopics({
        topics: [
          {
            topic: this.config.topic,
            numPartitions: this.config.partitions!,
            replicationFactor: this.config.replicationFactor!,
            configEntries: [
              {
                name: "retention.ms",
                value: this.options.retentionPeriod!.toString(),
              },
            ],
          },
        ],
      });
    } catch (error) {
      // Topic might already exist
    } finally {
      await admin.disconnect();
    }

    // Subscribe to topic
    await this.consumer.subscribe({
      topic: this.config.topic,
      fromBeginning: false,
    });

    this.connected = true;
  }

  async close(): Promise<void> {
    this.isConsuming = false;

    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }

    this.kafka = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "kafka";
  }

  private getProducer(): Producer {
    if (!this.producer) {
      throw new Error("Kafka producer not connected");
    }
    return this.producer;
  }

  private getConsumer(): Consumer {
    if (!this.consumer) {
      throw new Error("Kafka consumer not connected");
    }
    return this.consumer;
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const producer = this.getProducer();
    const messageId = randomUUID();

    const messageData = {
      id: messageId,
      data: message,
      timestamp: new Date().toISOString(),
      attempts: 0,
      delayUntil: options?.delayMs
        ? new Date(Date.now() + options.delayMs).toISOString()
        : null,
    };

    await producer.send({
      topic: this.config.topic,
      messages: [
        {
          key: messageId,
          value: JSON.stringify(messageData),
          headers: {
            messageId,
            timestamp: Date.now().toString(),
          },
        },
      ],
    });

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

    // Start consuming if not already started
    if (!this.isConsuming) {
      await this.startConsuming();
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

  private async startConsuming(): Promise<void> {
    const consumer = this.getConsumer();
    this.isConsuming = true;

    await consumer.run({
      eachMessage: async ({ message }: EachMessagePayload) => {
        try {
          const messageData = JSON.parse(message.value!.toString());

          // Check if message is delayed
          if (messageData.delayUntil) {
            const delayUntil = new Date(messageData.delayUntil);
            if (delayUntil > new Date()) {
              // Skip delayed messages
              return;
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
          console.error("Error processing Kafka message:", error);
        }
      },
    });
  }

  async delete(messageId: string): Promise<void> {
    // Kafka uses offset commits for acknowledgment
    // Messages are automatically committed based on consumer configuration
    // Remove from buffer if present
    this.messageBuffer = this.messageBuffer.filter((m) => m.id !== messageId);

    // Commit offsets
    const consumer = this.getConsumer();
    await consumer.commitOffsets([]);
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    // Kafka doesn't support changing visibility
    // Messages are delivered at-least-once with offset management
    console.warn("Kafka does not support changing message visibility");
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    // Kafka doesn't provide easy access to queue depth without admin API
    // Return approximate counts based on buffer
    return {
      approximate: this.messageBuffer.length,
      inFlight: 0,
      delayed: 0,
    };
  }

  async purge(): Promise<void> {
    // Kafka doesn't support purging topics directly
    // We can only clear our local buffer
    this.messageBuffer = [];
    console.warn("Kafka does not support purging messages from topics");
  }
}
