/**
 * In-memory queue implementation for local development and testing
 */
import { randomUUID } from "crypto";
import type { IQueue, QueueMessage, QueueOptions } from "./interface.js";

interface InMemoryMessage<T> {
  id: string;
  data: T;
  timestamp: Date;
  attempts: number;
  visibleAt: Date;
  maxAttempts: number;
}

export class InMemoryQueue implements IQueue {
  private messages: Map<string, InMemoryMessage<unknown>> = new Map();
  private inFlight: Set<string> = new Set();
  private connected = false;
  private options: QueueOptions;

  constructor(options: QueueOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      visibilityTimeout: options.visibilityTimeout || 30000,
      retentionPeriod: options.retentionPeriod || 345600000, // 4 days
      deadLetterQueue: options.deadLetterQueue || {
        enabled: true,
        maxReceiveCount: 3,
      },
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.messages.clear();
    this.inFlight.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getType(): string {
    return "memory";
  }

  async send<T>(
    message: T,
    options?: { delayMs?: number }
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const visibleAt = options?.delayMs
      ? new Date(now.getTime() + options.delayMs)
      : now;

    const inMemoryMessage: InMemoryMessage<T> = {
      id,
      data: message,
      timestamp: now,
      attempts: 0,
      visibleAt,
      maxAttempts: this.options.maxRetries || 3,
    };

    this.messages.set(id, inMemoryMessage);

    // Clean up old messages
    this.cleanupExpiredMessages();

    return id;
  }

  async receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]> {
    const maxMessages = options?.maxMessages || 1;
    const now = new Date();
    const result: QueueMessage<T>[] = [];

    for (const [id, msg] of this.messages.entries()) {
      if (result.length >= maxMessages) break;

      // Check if message is visible and not in flight
      if (msg.visibleAt <= now && !this.inFlight.has(id)) {
        // Mark as in flight
        this.inFlight.add(id);

        // Update visibility timeout
        msg.visibleAt = new Date(
          now.getTime() + (this.options.visibilityTimeout || 30000)
        );
        msg.attempts++;

        result.push({
          id: msg.id,
          data: msg.data as T,
          timestamp: msg.timestamp,
          attempts: msg.attempts,
          maxAttempts: msg.maxAttempts,
        });
      }
    }

    return result;
  }

  async delete(messageId: string): Promise<void> {
    this.messages.delete(messageId);
    this.inFlight.delete(messageId);
  }

  async changeVisibility(
    messageId: string,
    visibilityTimeoutMs: number
  ): Promise<void> {
    const msg = this.messages.get(messageId);
    if (msg) {
      msg.visibleAt = new Date(Date.now() + visibilityTimeoutMs);
    }
  }

  async getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed: number;
  }> {
    const now = new Date();
    let delayed = 0;

    for (const msg of this.messages.values()) {
      if (msg.visibleAt > now) {
        delayed++;
      }
    }

    return {
      approximate: this.messages.size - this.inFlight.size,
      inFlight: this.inFlight.size,
      delayed,
    };
  }

  async purge(): Promise<void> {
    this.messages.clear();
    this.inFlight.clear();
  }

  private cleanupExpiredMessages(): void {
    const now = new Date();
    const retentionMs = this.options.retentionPeriod || 345600000;

    for (const [id, msg] of this.messages.entries()) {
      const age = now.getTime() - msg.timestamp.getTime();
      if (age > retentionMs) {
        this.messages.delete(id);
        this.inFlight.delete(id);
      }
    }
  }
}
