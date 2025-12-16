/**
 * AMQP (RabbitMQ) queue implementation
 */
import amqp, { type Connection, type Channel, type Message } from "amqplib";
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

export interface AMQPQueueConfig {
  url: string;
  queueName: string;
  exchange?: string;
  routingKey?: string;
  durable?: boolean;
  prefetch?: number;
}

export class AMQPQueue implements IQueue {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private config: AMQPQueueConfig;
  private options: QueueOptions;
  private connected = false;
  private consumerTag: string | null = null;
  private pendingMessages: Map<string, Message> = new Map();

  constructor(config: AMQPQueueConfig, options: QueueOptions = {}) {
    this.config = {
      ...config,
      exchange: config.exchange || "",
      routingKey: config.routingKey || config.queueName,
      durable: config.durable !== false,
      prefetch: config.prefetch || 10,
    };
    this.options = {
      maxRetries: options.maxRetries || 3,
      visibilityTimeout: options.visibilityTimeout || 30000,
      retentionPeriod: options.retentionPeriod || 345600000,
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.connection = await amqp.connect(this.config.url);
    this.channel = await this.connection.createChannel();

    // Set prefetch for fair dispatch
    await this.channel.prefetch(this.config.prefetch || 10);

    // Assert queue exists
    await this.channel.assertQueue(this.config.queueName, {
      durable: this.config.durable,
      arguments: {
        "x-message-ttl": this.options.retentionPeriod,
      },
    });

    // If using an exchange, bind the queue
    if (this.config.exchange) {
      await this.channel.assertExchange(this.config.exchange, "direct", {
        durable: true,
      });
      await this.channel.bindQueue(
        this.config.queueName,
        this.config.exchange,
        this.config.routingKey || ""
      );
    }

    this.connected = true;

    // Handle connection errors
    this.connection.on("error", (error) => {
      console.error("AMQP connection error:", error);
      this.connected = false;
    });

    this.connection.on("close", () => {
      console.log("AMQP connection closed");
      this.connected = false;
    });
  }

  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "amqp";
  }

  private getChannel(): Channel {
    if (!this.channel) {
      throw new Error("AMQP queue not connected");
    }
    return this.channel;
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const channel = this.getChannel();
    const messageId = randomUUID();

    const messageData = {
      id: messageId,
      data: message,
      timestamp: new Date().toISOString(),
      attempts: 0,
    };

    const buffer = Buffer.from(JSON.stringify(messageData));

    const publishOptions: {
      persistent: boolean;
      messageId: string;
      timestamp: number;
      expiration?: string;
    } = {
      persistent: true,
      messageId,
      timestamp: Date.now(),
    };

    // Handle delayed messages using dead-letter exchange with TTL
    if (options?.delayMs && options.delayMs > 0) {
      // Create a temporary delay queue
      const delayQueue = `${this.config.queueName}.delay.${messageId}`;
      await channel.assertQueue(delayQueue, {
        durable: false,
        autoDelete: true,
        expires: options.delayMs + 10000, // Auto-delete after use
        arguments: {
          "x-dead-letter-exchange": this.config.exchange || "",
          "x-dead-letter-routing-key":
            this.config.routingKey || this.config.queueName,
          "x-message-ttl": options.delayMs,
        },
      });

      channel.sendToQueue(delayQueue, buffer, publishOptions);
    } else {
      // Send directly to queue or exchange
      if (this.config.exchange) {
        channel.publish(
          this.config.exchange,
          this.config.routingKey || "",
          buffer,
          publishOptions
        );
      } else {
        channel.sendToQueue(this.config.queueName, buffer, publishOptions);
      }
    }

    return messageId;
  }

  async receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]> {
    const channel = this.getChannel();
    const maxMessages = options?.maxMessages || 1;
    const result: QueueMessage<T>[] = [];

    for (let i = 0; i < maxMessages; i++) {
      const msg = await channel.get(this.config.queueName, { noAck: false });

      if (!msg) {
        break; // No more messages
      }

      try {
        const messageData = JSON.parse(msg.content.toString());
        messageData.attempts = (messageData.attempts || 0) + 1;

        // Store message for later acknowledgment
        const messageId = msg.properties.messageId || messageData.id;
        this.pendingMessages.set(messageId, msg);

        result.push({
          id: messageId,
          data: messageData.data,
          timestamp: new Date(messageData.timestamp),
          attempts: messageData.attempts,
          maxAttempts: this.options.maxRetries || 3,
        });
      } catch (error) {
        console.error("Error parsing AMQP message:", error);
        // Reject malformed message
        channel.nack(msg, false, false);
      }
    }

    return result;
  }

  async delete(messageId: string): Promise<void> {
    const channel = this.getChannel();
    const msg = this.pendingMessages.get(messageId);

    if (msg) {
      channel.ack(msg);
      this.pendingMessages.delete(messageId);
    }
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    const channel = this.getChannel();
    const msg = this.pendingMessages.get(messageId);

    if (msg) {
      // Negative acknowledgment with requeue
      // RabbitMQ doesn't support changing visibility directly
      // We reject and requeue the message
      channel.nack(msg, false, true);
      this.pendingMessages.delete(messageId);
    }
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    const channel = this.getChannel();

    try {
      const queueInfo = await channel.checkQueue(this.config.queueName);

      return {
        approximate: queueInfo.messageCount,
        inFlight: queueInfo.consumerCount,
        delayed: 0, // Not tracked separately
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
    const channel = this.getChannel();
    await channel.purgeQueue(this.config.queueName);
    this.pendingMessages.clear();
  }
}
