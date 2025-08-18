import { type Config } from "./config.js";
import {
  type HttpsTransportConfig,
  type RedisTransportConfig,
  type TransportConfig,
} from "./subscriber.js";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { createClient, type RedisClientType } from "redis";

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

export abstract class Transport {
  protected config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  abstract deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult>;
  abstract validateConfig(config: unknown): boolean;
  abstract getType(): string;
}

export class HttpsTransport extends Transport {
  getType(): string {
    return "https";
  }

  validateConfig(config: unknown): config is HttpsTransportConfig {
    if (!config || typeof config !== "object") return false;
    const httpConfig = config as HttpsTransportConfig;
    return (
      typeof httpConfig.url === "string" &&
      typeof httpConfig.webhook_secret === "string" &&
      httpConfig.url.startsWith("https://")
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const httpsConfig = transportConfig as HttpsTransportConfig;

    try {
      // Prepare payload
      const payloadString = JSON.stringify(event.payload);

      // Generate signature for subscriber
      const signature = this.generateSignature(
        payloadString,
        httpsConfig.webhook_secret
      );

      // Prepare headers
      const headers = {
        ...event.headers,
        "x-hub-signature-256": signature,
        "x-github-event-router": "true",
        "content-type": "application/json",
        "content-length": Buffer.from(payloadString).length.toString(),
      };

      // Make HTTP request
      const response = await axios.post(httpsConfig.url, payloadString, {
        headers,
        timeout: this.config.event_processing.timeouts.http_delivery_timeout_ms,
        transformRequest: [(data) => data], // Prevent axios from modifying payload
      });

      return {
        success: true,
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        return {
          success: false,
          statusCode: axiosError.response?.status ?? 0,
          error: axiosError.response?.statusText || axiosError.message,
          durationMs,
          attempt: 1,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs,
        attempt: 1,
      };
    }
  }

  private generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    return "sha256=" + hmac.update(payload).digest("hex");
  }
}

export class RedisTransport extends Transport {
  private client: RedisClientType | null = null;

  getType(): string {
    return "redis";
  }

  validateConfig(config: unknown): config is RedisTransportConfig {
    if (!config || typeof config !== "object") return false;
    const redisConfig = config as RedisTransportConfig;
    return (
      typeof redisConfig.url === "string" &&
      typeof redisConfig.password === "string"
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const redisConfig = transportConfig as RedisTransportConfig;

    try {
      // Initialize Redis client if needed
      if (!this.client) {
        this.client = createClient({
          url: redisConfig.url,
          password: redisConfig.password,
        });
        await this.client.connect();
      }

      // Prepare message for Redis
      const message = {
        event: event.type,
        payload: event.payload,
        headers: event.headers,
        deliveryId: event.id,
        timestamp: event.receivedAt.toISOString(),
      };

      // Publish to Redis channel
      const channel = `github-events:${event.type}`;
      const result = await this.client.publish(
        channel,
        JSON.stringify(message)
      );

      return {
        success: result > 0,
        statusCode: result > 0 ? 200 : 204,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Redis delivery failed",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}

export class TransportFactory {
  private static transports: Map<string, new (config: Config) => Transport> =
    new Map();

  static {
    this.transports.set("https", HttpsTransport);
    this.transports.set("redis", RedisTransport);
  }

  static create(type: string, config: Config): Transport {
    const TransportClass = this.transports.get(type);
    if (!TransportClass) {
      throw new Error(`Unknown transport type: ${type}`);
    }
    return new TransportClass(config);
  }

  static getSupportedTypes(): string[] {
    return Array.from(this.transports.keys());
  }
}
