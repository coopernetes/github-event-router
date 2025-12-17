/**
 * AMQP (RabbitMQ) transport for delivering events to subscribers
 */
import * as amqplib from "amqplib";
import type { Config } from "../config.js";
import type {
  ITransport,
  GitHubEvent,
  DeliveryResult,
  AMQPTransportConfig,
  TransportConfig,
} from "./interface.js";

interface AMQPConnection {
  connection: amqplib.ChannelModel;
  channel: amqplib.Channel;
}

export class AMQPTransport implements ITransport {
  private config: Config;
  private connections: Map<string, AMQPConnection> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  getType(): string {
    return "amqp";
  }

  validateConfig(config: unknown): config is AMQPTransportConfig {
    if (!config || typeof config !== "object") return false;
    const amqpConfig = config as AMQPTransportConfig;
    return (
      typeof amqpConfig.url === "string" &&
      typeof amqpConfig.routingKey === "string"
    );
  }

  async deliver(
    event: GitHubEvent,
    transportConfig: TransportConfig
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const amqpConfig = transportConfig as AMQPTransportConfig;

    if (!this.validateConfig(amqpConfig)) {
      return {
        success: false,
        error: "Invalid AMQP transport configuration",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }

    try {
      // Get or create AMQP connection
      let conn = this.connections.get(amqpConfig.url);

      if (!conn) {
        const connection = await amqplib.connect(amqpConfig.url);
        const channel = await connection.createChannel();

        // If using exchange, assert it exists
        if (amqpConfig.exchange) {
          await channel.assertExchange(amqpConfig.exchange, "direct", {
            durable: amqpConfig.durable !== false,
          });
        }

        conn = { connection, channel };
        this.connections.set(amqpConfig.url, conn);
      }

      if (!conn) {
        throw new Error("Failed to create AMQP connection");
      }

      // Prepare message for AMQP
      const message = {
        event: event.type,
        payload: event.payload,
        headers: event.headers,
        deliveryId: event.id,
        timestamp: event.receivedAt.toISOString(),
      };

      const buffer = Buffer.from(JSON.stringify(message));

      // Publish to exchange or queue
      if (amqpConfig.exchange) {
        conn.channel.publish(
          amqpConfig.exchange,
          amqpConfig.routingKey,
          buffer,
          {
            persistent: true,
            contentType: "application/json",
            headers: {
              "x-github-event": event.type,
              "x-github-delivery": event.id,
            },
          }
        );
      } else {
        // Send directly to queue
        await conn.channel.assertQueue(amqpConfig.routingKey, {
          durable: amqpConfig.durable !== false,
        });
        conn.channel.sendToQueue(amqpConfig.routingKey, buffer, {
          persistent: true,
          contentType: "application/json",
        });
      }

      return {
        success: true,
        statusCode: 200,
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "AMQP delivery failed",
        durationMs: Date.now() - startTime,
        attempt: 1,
      };
    }
  }

  async close(): Promise<void> {
    // Close all AMQP connections
    for (const conn of this.connections.values()) {
      try {
        await conn.channel.close();
      } catch (e) {
        // Ignore close errors
      }
      try {
        await conn.connection.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.connections.clear();
  }
}
