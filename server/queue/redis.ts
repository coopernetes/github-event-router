/**
 * Redis queue implementation using Redis Streams
 */
import { createClient, type RedisClientType } from "redis";
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

export interface RedisQueueConfig {
  url: string;
  password?: string;
  queueName: string;
  consumerGroup?: string;
  consumerName?: string;
}

export class RedisQueue implements IQueue {
  private client: RedisClientType | null = null;
  private config: RedisQueueConfig;
  private options: QueueOptions;
  private connected = false;
  private streamKey: string;
  private consumerGroup: string;
  private consumerName: string;

  constructor(config: RedisQueueConfig, options: QueueOptions = {}) {
    this.config = config;
    this.options = {
      maxRetries: options.maxRetries || 3,
      visibilityTimeout: options.visibilityTimeout || 30000,
      retentionPeriod: options.retentionPeriod || 345600000,
      ...options,
    };

    this.streamKey = `queue:${config.queueName}`;
    this.consumerGroup = config.consumerGroup || "default-group";
    this.consumerName = config.consumerName || `consumer-${randomUUID()}`;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const clientOptions: {
      url: string;
      password?: string;
    } = {
      url: this.config.url,
    };

    if (this.config.password) {
      clientOptions.password = this.config.password;
    }

    this.client = createClient(clientOptions);

    await this.client.connect();

    // Create consumer group if it doesn't exist
    try {
      await this.client.xGroupCreate(this.streamKey, this.consumerGroup, "0", {
        MKSTREAM: true,
      });
    } catch (error) {
      // Group might already exist, ignore error
      const err = error as Error;
      if (!err.message?.includes("BUSYGROUP")) {
        console.warn("Error creating consumer group:", err.message || "Unknown error");
      }
    }

    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "redis";
  }

  private getClient(): RedisClientType {
    if (!this.client) {
      throw new Error("Redis queue not connected");
    }
    return this.client;
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const client = this.getClient();
    const data = JSON.stringify({
      id: randomUUID(),
      data: message,
      timestamp: new Date().toISOString(),
      attempts: 0,
      delayUntil: options?.delayMs
        ? new Date(Date.now() + options.delayMs).toISOString()
        : null,
    });

    // Add to stream
    const id = await client.xAdd(this.streamKey, "*", {
      data,
    });

    return id;
  }

  async receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]> {
    const client = this.getClient();
    const maxMessages = options?.maxMessages || 1;
    const waitTimeMs = options?.waitTimeMs || 1000;

    try {
      // Read from consumer group
      const messages = await client.xReadGroup(
        this.consumerGroup,
        this.consumerName,
        [
          {
            key: this.streamKey,
            id: ">", // Read new messages
          },
        ],
        {
          COUNT: maxMessages,
          BLOCK: waitTimeMs,
        }
      );

      if (!messages || messages.length === 0) {
        return [];
      }

      const result: QueueMessage<T>[] = [];

      for (const stream of messages) {
        for (const msg of stream.messages) {
          const messageDataStr = msg.message.data;
          if (typeof messageDataStr !== "string") {
            continue;
          }
          const messageData = JSON.parse(messageDataStr);

          // Check if message is delayed
          if (messageData.delayUntil) {
            const delayUntil = new Date(messageData.delayUntil);
            if (delayUntil > new Date()) {
              // Skip this message, it's still delayed
              continue;
            }
          }

          messageData.attempts++;

          result.push({
            id: msg.id,
            data: messageData.data,
            timestamp: new Date(messageData.timestamp),
            attempts: messageData.attempts,
            maxAttempts: this.options.maxRetries || 3,
          });
        }
      }

      return result;
    } catch (error) {
      console.error("Error receiving from Redis queue:", error);
      return [];
    }
  }

  async delete(messageId: string): Promise<void> {
    const client = this.getClient();

    // Acknowledge the message
    await client.xAck(this.streamKey, this.consumerGroup, messageId);

    // Delete the message from stream
    await client.xDel(this.streamKey, messageId);
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    // Redis Streams don't support changing visibility directly
    // We can claim the message with a new idle time
    const client = this.getClient();

    await client.xClaim(
      this.streamKey,
      this.consumerGroup,
      this.consumerName,
      visibilityTimeoutMs,
      [messageId]
    );
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    const client = this.getClient();

    try {
      const info = await client.xInfoStream(this.streamKey);
      const groups = await client.xInfoGroups(this.streamKey);

      let inFlight = 0;
      for (const group of groups) {
        if (group.name === this.consumerGroup) {
          inFlight = group.pending;
          break;
        }
      }

      return {
        approximate: info.length - inFlight,
        inFlight,
        delayed: 0, // Not tracked in Redis Streams
      };
    } catch (error) {
      return {
        approximate: 0,
        inFlight: 0,
        delayed: 0,
      };
    }
  }

  async purge(): Promise<void> {
    const client = this.getClient();

    // Trim stream to 0 messages (delete all)
    await client.xTrim(this.streamKey, "MAXLEN", 0);
  }
}
