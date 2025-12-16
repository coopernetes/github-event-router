/**
 * Redis pub/sub transport for delivering events to subscribers
 */
import { createClient, type RedisClientType } from "redis";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  RedisTransportConfig,
  TransportConfig,
} from "./interface.js";

export class RedisTransport implements ITransport {
  private config: Config;
  private client: RedisClientType | null = null;
  private clientsByUrl: Map<string, RedisClientType> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "redis";
  }

  validateConfig(config: unknown): config is RedisTransportConfig {
    if (!config || typeof config !== "object") return false;
    const redisConfig = config as RedisTransportConfig;
    return typeof redisConfig.url === "string";
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const redisConfig = transportConfig as RedisTransportConfig;

    if (!this.validateConfig(redisConfig)) {
      return {
        success: false,
        error: "Invalid Redis transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Get or create Redis client for this URL
      let client = this.clientsByUrl.get(redisConfig.url);

      if (!client) {
        client = createClient({
          url: redisConfig.url,
          password: redisConfig.password,
        });
        await client.connect();
        this.clientsByUrl.set(redisConfig.url, client);
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
      const channel =
        redisConfig.channel || `github-events:${event.type}`;
      const result = await client.publish(channel, JSON.stringify(message));

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

  async close(): Promise<void> {
    // Close all Redis clients
    for (const client of this.clientsByUrl.values()) {
      await client.disconnect();
    }
    this.clientsByUrl.clear();
  }
}
