/**
 * Transport layer interfaces for delivering events to subscribers
 */
import type { Config } from "../config.js";

export interface GitHubEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  receivedAt: Date;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
  attempt: number;
}

/**
 * Base transport interface that all transports must implement
 */
export interface ITransport {
  /**
   * Deliver an event to a subscriber
   */
  deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult>;

  /**
   * Validate transport configuration
   */
  validateConfig(config: unknown): boolean;

  /**
   * Get the transport type identifier
   */
  getType(): string;

  /**
   * Initialize the transport (optional, for connection pooling)
   */
  initialize?(): Promise<void>;

  /**
   * Close the transport (optional, for cleanup)
   */
  close?(): Promise<void>;
}

/**
 * Base transport configuration types
 */
export interface HttpsTransportConfig {
  url: string;
  webhook_secret: string;
}

export interface RedisTransportConfig {
  url: string;
  password: string;
  channel?: string;
}

export interface KafkaTransportConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  ssl?: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
}

export interface SQSTransportConfig {
  region: string;
  queueUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface AzureEventHubTransportConfig {
  connectionString: string;
  eventHubName: string;
}

export interface AMQPTransportConfig {
  url: string;
  exchange?: string;
  routingKey: string;
  durable?: boolean;
}

export type TransportConfig =
  | HttpsTransportConfig
  | RedisTransportConfig
  | KafkaTransportConfig
  | SQSTransportConfig
  | AzureEventHubTransportConfig
  | AMQPTransportConfig;

export type TransportName =
  | "https"
  | "redis"
  | "kafka"
  | "sqs"
  | "azure-eventhub"
  | "amqp";
