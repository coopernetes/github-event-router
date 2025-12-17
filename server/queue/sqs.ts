/**
 * AWS SQS queue implementation
 */
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

export interface SQSQueueConfig {
  region: string;
  queueUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string; // For LocalStack or custom endpoints
}

export class SQSQueue implements IQueue {
  private client: SQSClient | null = null;
  private config: SQSQueueConfig;
  private options: QueueOptions;
  private connected = false;
  private receiptHandles: Map<string, string> = new Map();

  constructor(config: SQSQueueConfig, options: QueueOptions = {}) {
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

    const clientConfig: {
      region: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
      endpoint?: string;
    } = {
      region: this.config.region,
    };

    if (this.config.accessKeyId && this.config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      };
    }

    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
    }

    this.client = new SQSClient(clientConfig);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "sqs";
  }

  private getClient(): SQSClient {
    if (!this.client) {
      throw new Error("SQS queue not connected");
    }
    return this.client;
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const client = this.getClient();
    const messageId = randomUUID();

    const messageBody = JSON.stringify({
      id: messageId,
      data: message,
      timestamp: new Date().toISOString(),
      attempts: 0,
    });

    const command = new SendMessageCommand({
      QueueUrl: this.config.queueUrl,
      MessageBody: messageBody,
      DelaySeconds: options?.delayMs
        ? Math.floor(options.delayMs / 1000)
        : undefined,
      MessageAttributes: {
        MessageId: {
          DataType: "String",
          StringValue: messageId,
        },
      },
    });

    const response = await client.send(command);
    return response.MessageId || messageId;
  }

  async receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]> {
    const client = this.getClient();
    const maxMessages = Math.min(options?.maxMessages || 1, 10); // SQS max is 10
    const waitTimeSeconds = Math.floor((options?.waitTimeMs || 1000) / 1000);

    const command = new ReceiveMessageCommand({
      QueueUrl: this.config.queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      MessageAttributeNames: ["All"],
      VisibilityTimeout: Math.floor(
        (this.options.visibilityTimeout || 30000) / 1000
      ),
    });

    const response = await client.send(command);

    if (!response.Messages || response.Messages.length === 0) {
      return [];
    }

    const result: QueueMessage<T>[] = [];

    for (const msg of response.Messages) {
      if (!msg.Body || !msg.MessageId || !msg.ReceiptHandle) continue;

      try {
        const messageData = JSON.parse(msg.Body);
        messageData.attempts = (messageData.attempts || 0) + 1;

        // Store receipt handle for later deletion
        const messageId = msg.MessageId;
        this.receiptHandles.set(messageId, msg.ReceiptHandle);

        result.push({
          id: messageId,
          data: messageData.data,
          timestamp: new Date(messageData.timestamp),
          attempts: messageData.attempts,
          maxAttempts: this.options.maxRetries || 3,
        });
      } catch (error) {
        console.error("Error parsing SQS message:", error);
      }
    }

    return result;
  }

  async delete(messageId: string): Promise<void> {
    const client = this.getClient();
    const receiptHandle = this.receiptHandles.get(messageId);

    if (!receiptHandle) {
      console.warn(`Receipt handle not found for message ${messageId}`);
      return;
    }

    const command = new DeleteMessageCommand({
      QueueUrl: this.config.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await client.send(command);
    this.receiptHandles.delete(messageId);
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    const client = this.getClient();
    const receiptHandle = this.receiptHandles.get(messageId);

    if (!receiptHandle) {
      console.warn(`Receipt handle not found for message ${messageId}`);
      return;
    }

    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.config.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: Math.floor(visibilityTimeoutMs / 1000),
    });

    await client.send(command);
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    const client = this.getClient();

    const command = new GetQueueAttributesCommand({
      QueueUrl: this.config.queueUrl,
      AttributeNames: [
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed",
      ],
    });

    const response = await client.send(command);
    const attributes = response.Attributes || {};

    return {
      approximate: parseInt(attributes.ApproximateNumberOfMessages || "0"),
      inFlight: parseInt(
        attributes.ApproximateNumberOfMessagesNotVisible || "0"
      ),
      delayed: parseInt(attributes.ApproximateNumberOfMessagesDelayed || "0"),
    };
  }

  async purge(): Promise<void> {
    const client = this.getClient();

    const command = new PurgeQueueCommand({
      QueueUrl: this.config.queueUrl,
    });

    await client.send(command);
    this.receiptHandles.clear();
  }
}
