/**
 * Queue abstraction layer for internal event processing
 * Enables horizontal scaling by using external message queues
 */

export interface QueueMessage<T = unknown> {
  id: string;
  data: T;
  timestamp: Date;
  attempts: number;
  maxAttempts?: number;
}

export interface QueueOptions {
  /**
   * Maximum number of retry attempts for failed messages
   */
  maxRetries?: number;

  /**
   * Visibility timeout in milliseconds (how long a message is hidden after being received)
   */
  visibilityTimeout?: number;

  /**
   * Message retention period in milliseconds
   */
  retentionPeriod?: number;

  /**
   * Dead letter queue configuration
   */
  deadLetterQueue?: {
    enabled: boolean;
    maxReceiveCount: number;
  };
}

export interface IQueue {
  /**
   * Initialize the queue connection
   */
  connect(): Promise<void>;

  /**
   * Close the queue connection
   */
  close(): Promise<void>;

  /**
   * Send a message to the queue
   */
  send<T>(message: T, options?: { delayMs?: number }): Promise<string>;

  /**
   * Receive messages from the queue
   */
  receive<T>(options?: {
    maxMessages?: number;
    waitTimeMs?: number;
  }): Promise<QueueMessage<T>[]>;

  /**
   * Delete a message from the queue (acknowledge)
   */
  delete(messageId: string): Promise<void>;

  /**
   * Change message visibility timeout (for retries)
   */
  changeVisibility(messageId: string, visibilityTimeoutMs: number): Promise<void>;

  /**
   * Get queue statistics
   */
  getStats(): Promise<{
    approximate: number;
    inFlight: number;
    delayed?: number;
  }>;

  /**
   * Purge all messages from the queue
   */
  purge(): Promise<void>;

  /**
   * Check if the queue is connected
   */
  isConnected(): boolean;

  /**
   * Get the queue type identifier
   */
  getType(): string;
}

/**
 * Event data for internal queue processing
 */
export interface EventQueueData {
  eventId: number;
  githubDeliveryId: string;
  eventType: string;
  payloadHash: string;
  payloadData: string;
  headersData: string;
  receivedAt: string;
  subscriberId: number;
  subscriberName: string;
  transportName: string;
  transportConfig: string;
  attemptNumber: number;
}
